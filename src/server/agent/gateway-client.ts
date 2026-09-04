import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from '../config';
import { logger } from '../logging';

/**
 * The proxy's own way in to AgentCore Gateway.
 *
 * ## Why the application calls the Gateway at all
 *
 * A `propose_*` tool only asks. Something has to carry the proposal out once a
 * human has pressed Confirm, and on engine B that something must not be the
 * model: a language model deciding when to spend someone's money is the exact
 * thing propose→confirm exists to prevent, so the `confirm_*` tools are filtered
 * out of the list `agent.py` shows Bedrock and are called from here instead.
 *
 * Three alternatives were considered. A Gateway tool the *model* calls puts the
 * model back in the authority path. A direct `lambda:InvokeFunction` from the
 * proxy works, but routes the confirm *around* the Gateway — the thing being
 * demonstrated — and would need a second copy of the tool-name mapping.
 * Re-invoking the Runtime re-enters the model. Calling the Gateway directly is
 * also the strongest thing to be able to say out loud: one MCP endpoint,
 * JWT-scoped, reached by both the agent and the application, with each tool
 * schema declared once.
 *
 * ## Why a second Cognito client
 *
 * `agent.py` holds one machine client for the Runtime. This is a *different*
 * caller with a different lifetime, so it gets `valentin-proxy-gateway-<env>`
 * rather than sharing credentials — a rotation or a revocation should be able to
 * stop one without stopping the other. Both are in the Gateway's
 * `allowedClients`, and neither secret is ever in the template: it is read at
 * runtime with `DescribeUserPoolClient`, exactly as `agent.py` does.
 *
 * ## Why the MCP SDK and not fetch
 *
 * `initialize` → `notifications/initialized` → `tools/call`, with the
 * `Mcp-Session-Id` header threaded through and SSE framing on the way back, is
 * about 150 lines of protocol that drifts the moment the spec revises. The SDK is
 * the same one the repo's own MCP servers use.
 */

/** Seconds before expiry at which a cached token is considered spent. */
const TOKEN_SKEW_SECONDS = 60;

/** How long to wait for a confirm before giving up on it. */
const CALL_TIMEOUT_MS = 20_000;

/** What a Gateway tool call answered. Shaped like `lambda-handler`'s reply. */
export interface GatewayCallResult {
  ok: boolean;
  summary?: string;
  data?: unknown;
  booking?: {
    venueSlug?: string | null;
    venueName: string;
    city?: string | null;
    occursOn?: string | null;
  };
  error?: string;
}

/** What the proxy needs to reach the Gateway. Absent ⇒ engine B cannot confirm. */
export interface GatewayClientConfig {
  gatewayUrl: string;
  clientId: string;
  tokenUrl: string;
  scope: string;
  userPoolId: string;
}

/**
 * Read the Gateway wiring out of the environment, or say why it is not there.
 *
 * Returns null rather than throwing, because a proxy with no Gateway wiring is
 * the normal state locally and in `npm test`. The caller turns that into "engine B
 * cannot confirm here", which is a sentence, not an outage.
 */
export function gatewayClientConfigFromEnv(): GatewayClientConfig | null {
  const gatewayUrl = config.agentCore.gatewayUrl;
  const clientId = process.env.GATEWAY_CLIENT_ID;
  const tokenUrl = process.env.GATEWAY_TOKEN_URL;
  const userPoolId = config.cognito.userPoolId;
  const scope = process.env.GATEWAY_SCOPE ?? 'valentin-tools/invoke';

  if (!gatewayUrl || !clientId || !tokenUrl || !userPoolId) return null;
  return { gatewayUrl, clientId, tokenUrl, scope, userPoolId };
}

/**
 * Calls one tool on the Gateway, holding a token and a secret for as long as they
 * are good for.
 *
 * One MCP session per call, deliberately. A confirm happens once per proposal —
 * minutes apart at best — so a long-lived session would spend most of its life
 * idle and its first use after an idle period is exactly when a stale
 * `Mcp-Session-Id` fails. The token and the client secret *are* cached, since
 * those are the expensive parts: a Cognito describe plus a token exchange on
 * every confirm would add two round trips to the one click the user is watching.
 */
export class GatewayToolClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private clientSecret: string | null = null;

  constructor(
    private readonly cfg: GatewayClientConfig,
    private readonly idp = new CognitoIdentityProviderClient({}),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Call a Gateway tool by its full MCP name, e.g.
   * `valentin-integrations___confirm_reservation`.
   *
   * Never throws for a tool that ran and failed — that arrives as `{ok:false}`
   * from the Lambda. It *does* throw when the Gateway itself could not be
   * reached, because the caller needs to tell those apart: a failed booking is
   * something to tell the user about, an unreachable Gateway is something to page
   * about.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<GatewayCallResult> {
    const started = Date.now();
    const transport = new StreamableHTTPClientTransport(new URL(this.cfg.gatewayUrl), {
      requestInit: { headers: { Authorization: `Bearer ${await this.accessToken()}` } },
    });
    const client = new Client({ name: 'valentin-proxy', version: '1.0.0' });

    try {
      await client.connect(transport);
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: CALL_TIMEOUT_MS,
      });

      // One line per call, with a real duration — unlike the read-path spans,
      // which the proxy only ever learns about as names. `span-bridge.ts` turns
      // this into the confirm span in the drawer.
      logger.info('agentcore.gateway.confirm', {
        // From the arguments rather than a parameter: every Gateway tool takes
        // `session_id`, and a span with no session is dropped by
        // `resolveBroadcastSessionId` — so reading it from the one place it is
        // guaranteed to be keeps the drawer beat from depending on a call site
        // remembering to pass it twice.
        sessionId: typeof args.session_id === 'string' ? args.session_id : undefined,
        tool: name,
        durationMs: Date.now() - started,
        ok: !result.isError,
      });

      return readToolResult(result);
    } finally {
      // Closed even on failure: an abandoned transport holds an open HTTP
      // response, and a proxy that leaks one per failed confirm eventually stops
      // being able to make any.
      await client.close().catch(() => undefined);
    }
  }

  /** A client-credentials token, cached until shortly before it expires. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - TOKEN_SKEW_SECONDS * 1000) {
      return this.token;
    }

    const secret = await this.secret();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.clientId,
      scope: this.cfg.scope,
    });

    const response = await this.fetchImpl(this.cfg.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Basic auth rather than the secret in the body: the same form `agent.py`
        // uses, and it keeps the secret out of anything that logs a request body.
        Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${secret}`).toString('base64')}`,
      },
      body,
    });

    if (!response.ok) {
      // The status, never the body — a token endpoint's error body can echo the
      // request.
      throw new Error(`Cognito refused the Gateway token exchange: HTTP ${response.status}`);
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('Cognito returned no access_token');

    this.token = json.access_token;
    this.tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return this.token;
  }

  /**
   * The machine client's secret, read from Cognito rather than from the template.
   *
   * A `ClientSecret` in CloudFormation is a secret in an artefact anyone with
   * `DescribeStacks` can read, and a regression test asserts the template holds
   * none. Cached for the life of the process, since Cognito does not rotate it
   * behind our back.
   */
  private async secret(): Promise<string> {
    if (this.clientSecret) return this.clientSecret;

    const described = await this.idp.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: this.cfg.userPoolId,
        ClientId: this.cfg.clientId,
      }),
    );
    const secret = described.UserPoolClient?.ClientSecret;
    if (!secret) {
      throw new Error(
        `Cognito client ${this.cfg.clientId} has no secret — it must be a confidential client`,
      );
    }
    this.clientSecret = secret;
    return secret;
  }
}

/**
 * Read the Lambda's JSON answer back out of an MCP tool result.
 *
 * MCP wraps a tool's return value in content blocks, so what the Lambda returned
 * as an object arrives as a JSON string in `content[0].text`. Anything this cannot
 * read becomes `{ok:false}` with the text as the error, which is what the user
 * ends up being told — better than a thrown parse error on a click that may well
 * have booked a table.
 */
function readToolResult(result: unknown): GatewayCallResult {
  const record = (result ?? {}) as {
    isError?: boolean;
    content?: unknown;
    structuredContent?: unknown;
  };

  // Preferred when present: the SDK gives back the tool's own object, so there is
  // nothing to parse and nothing to get wrong.
  if (record.structuredContent && typeof record.structuredContent === 'object') {
    return record.structuredContent as GatewayCallResult;
  }

  const first = Array.isArray(record.content) ? record.content[0] : undefined;
  const text =
    first && typeof first === 'object' && typeof (first as { text?: unknown }).text === 'string'
      ? ((first as { text: string }).text)
      : undefined;

  if (!text) {
    return { ok: false, error: 'The Gateway returned no readable result.' };
  }

  try {
    const parsed = JSON.parse(text) as GatewayCallResult;
    if (typeof parsed?.ok === 'boolean') return parsed;
    return { ok: !record.isError, summary: text };
  } catch {
    return { ok: !record.isError, summary: text };
  }
}
