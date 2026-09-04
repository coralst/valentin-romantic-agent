import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The proxy's own way in to the Gateway — the call that actually spends money.
 *
 * Everything below the MCP transport is stubbed, because what is worth pinning is
 * not that the SDK speaks the protocol but the four decisions wrapped around it:
 * the secret comes from Cognito and never from config, the token is cached but not
 * past its life, a tool that ran and failed is a value while an unreachable Gateway
 * is a throw, and the confirm log carries the session id the drawer needs.
 */

const mcpState = vi.hoisted(() => ({
  /** What `callTool` should answer, or throw if it is an Error. */
  reply: {} as unknown,
  calls: [] as { name: string; arguments: Record<string, unknown> }[],
  connects: 0,
  closes: 0,
  /** Headers the transport was constructed with, so the bearer can be inspected. */
  headers: [] as Record<string, string>[],
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    async connect() {
      mcpState.connects += 1;
    }
    async callTool(request: { name: string; arguments: Record<string, unknown> }) {
      mcpState.calls.push(request);
      if (mcpState.reply instanceof Error) throw mcpState.reply;
      return mcpState.reply;
    }
    async close() {
      mcpState.closes += 1;
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, opts?: { requestInit?: { headers?: Record<string, string> } }) {
      mcpState.headers.push(opts?.requestInit?.headers ?? {});
    }
  },
}));

const configState = vi.hoisted(() => ({
  agentCore: { gatewayUrl: undefined as string | undefined },
  cognito: { userPoolId: undefined as string | undefined },
}));

vi.mock('../../config', () => ({ config: configState }));

const { GatewayToolClient, gatewayClientConfigFromEnv } = await import('../gateway-client');
const { logger } = await import('../../logging');

const CFG = {
  gatewayUrl: 'https://valentin-gateway-dev.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp',
  clientId: 'proxy-client-id',
  tokenUrl: 'https://valentin-dev.auth.us-east-1.amazoncognito.com/oauth2/token',
  scope: 'valentin-tools/invoke',
  userPoolId: 'us-east-1_pool',
};

/**
 * A Cognito stub that hands back a secret and counts how often it was asked.
 *
 * `null` rather than `undefined` for "there is no secret", because passing
 * `undefined` explicitly would take the default parameter and hand back a secret
 * after all — which is how the no-secret test first passed for the wrong reason.
 */
function fakeIdp(secret: string | null = 'shhh') {
  const send = vi.fn(async () => ({
    UserPoolClient: { ClientSecret: secret ?? undefined },
  }));
  return { idp: { send } as never, send };
}

/** A token endpoint stub. */
function fakeToken(json: unknown = { access_token: 'tok-1', expires_in: 3600 }, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => json,
  })) as unknown as typeof fetch;
}

/** The Lambda's answer, as MCP wraps it. */
function textResult(body: unknown, isError = false) {
  return { isError, content: [{ type: 'text', text: JSON.stringify(body) }] };
}

beforeEach(() => {
  mcpState.reply = textResult({ ok: true, summary: 'Booked' });
  mcpState.calls = [];
  mcpState.connects = 0;
  mcpState.closes = 0;
  mcpState.headers = [];
  configState.agentCore.gatewayUrl = CFG.gatewayUrl;
  configState.cognito.userPoolId = CFG.userPoolId;
  process.env.GATEWAY_CLIENT_ID = CFG.clientId;
  process.env.GATEWAY_TOKEN_URL = CFG.tokenUrl;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GATEWAY_CLIENT_ID;
  delete process.env.GATEWAY_TOKEN_URL;
  delete process.env.GATEWAY_SCOPE;
});

describe('gatewayClientConfigFromEnv', () => {
  it('reads the wiring the stack threads through', () => {
    expect(gatewayClientConfigFromEnv()).toEqual(CFG);
  });

  it('defaults the scope, since only one exists', () => {
    delete process.env.GATEWAY_SCOPE;
    expect(gatewayClientConfigFromEnv()?.scope).toBe('valentin-tools/invoke');
  });

  it('returns null rather than throwing when a piece is missing', () => {
    // The normal state locally and under `npm test`. The caller turns this into
    // "engine B cannot confirm here", which is a sentence rather than an outage —
    // a throw would take the whole server down at boot on a laptop.
    for (const missing of ['GATEWAY_CLIENT_ID', 'GATEWAY_TOKEN_URL'] as const) {
      const kept = process.env[missing];
      delete process.env[missing];
      expect(gatewayClientConfigFromEnv(), missing).toBeNull();
      process.env[missing] = kept;
    }

    configState.cognito.userPoolId = undefined;
    expect(gatewayClientConfigFromEnv()).toBeNull();
    configState.cognito.userPoolId = CFG.userPoolId;

    configState.agentCore.gatewayUrl = undefined;
    expect(gatewayClientConfigFromEnv()).toBeNull();
  });
});

describe('GatewayToolClient.callTool', () => {
  it('calls the tool by its full MCP name and returns the Lambda’s own answer', async () => {
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());

    const result = await client.callTool('valentin-integrations___confirm_reservation', {
      user_id: 'her-sub',
      session_id: 'sess-1',
      proposal_id: 'prop-1',
    });

    expect(result).toEqual({ ok: true, summary: 'Booked' });
    expect(mcpState.calls[0].name).toBe('valentin-integrations___confirm_reservation');
    expect(mcpState.calls[0].arguments.proposal_id).toBe('prop-1');
  });

  it('presents the token as a bearer, and never the client secret', async () => {
    const { idp } = fakeIdp('the-real-secret');
    const client = new GatewayToolClient(CFG, idp, fakeToken());

    await client.callTool('valentin-integrations___confirm_email', { session_id: 's' });

    const auth = mcpState.headers[0].Authorization;
    expect(auth).toBe('Bearer tok-1');
    expect(auth).not.toContain('the-real-secret');
  });

  it('sends the secret to Cognito as basic auth, not in the body', async () => {
    // A token endpoint's error body can echo the request, and request bodies get
    // logged in more places than headers do.
    const { idp } = fakeIdp('the-real-secret');
    const fetchImpl = fakeToken();
    const client = new GatewayToolClient(CFG, idp, fetchImpl);

    await client.callTool('valentin-integrations___confirm_gift', { session_id: 's' });

    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(`${CFG.clientId}:the-real-secret`).toString('base64')}`,
    );
    expect(String(init.body)).not.toContain('the-real-secret');
  });

  it('caches the token and the secret across calls', async () => {
    // Two round trips added to the one click a user is watching, otherwise.
    const { idp, send } = fakeIdp();
    const fetchImpl = fakeToken();
    const client = new GatewayToolClient(CFG, idp, fetchImpl);

    await client.callTool('valentin-integrations___confirm_reservation', { session_id: 's' });
    await client.callTool('valentin-integrations___confirm_gift', { session_id: 's' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-exchanges a token that is inside the expiry skew', async () => {
    // A token good for 30 s is already spent, because the skew is 60 s: using it
    // would put the expiry inside the call itself.
    const { idp } = fakeIdp();
    const fetchImpl = fakeToken({ access_token: 'tok-short', expires_in: 30 });
    const client = new GatewayToolClient(CFG, idp, fetchImpl);

    await client.callTool('valentin-integrations___confirm_reservation', { session_id: 's' });
    await client.callTool('valentin-integrations___confirm_gift', { session_id: 's' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('opens one MCP session per call and closes it even when the call fails', async () => {
    // An abandoned transport holds an open HTTP response; a proxy that leaks one
    // per failed confirm eventually cannot make any.
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());
    mcpState.reply = new Error('socket hang up');

    await expect(
      client.callTool('valentin-integrations___confirm_reservation', { session_id: 's' }),
    ).rejects.toThrow(/socket hang up/);
    expect(mcpState.closes).toBe(1);
  });

  it('throws on a refused token exchange, reporting the status and not the body', async () => {
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken({ error: 'invalid_client' }, false));

    await expect(
      client.callTool('valentin-integrations___confirm_reservation', { session_id: 's' }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('throws when the machine client has no secret, naming the client', async () => {
    const { idp } = fakeIdp(null);
    const client = new GatewayToolClient(CFG, idp, fakeToken());

    await expect(
      client.callTool('valentin-integrations___confirm_reservation', { session_id: 's' }),
    ).rejects.toThrow(/proxy-client-id has no secret/);
  });

  it('logs the confirm with the session id from the arguments, so the span is not dropped', async () => {
    // A span with no session is dropped by `resolveBroadcastSessionId`, which would
    // make every confirm invisible in the drawer — the one beat the demo is about.
    const info = vi.spyOn(logger, 'info');
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());

    await client.callTool('valentin-integrations___confirm_reservation', {
      user_id: 'her-sub',
      session_id: 'sess-42',
      proposal_id: 'prop-1',
    });

    const record = info.mock.calls.find(([event]) => event === 'agentcore.gateway.confirm');
    expect(record).toBeDefined();
    const fields = record![1] as Record<string, unknown>;
    expect(fields.sessionId).toBe('sess-42');
    expect(fields.tool).toBe('valentin-integrations___confirm_reservation');
    expect(fields.ok).toBe(true);
    expect(typeof fields.durationMs).toBe('number');
    // The proxy measured this one itself, unlike the agent's own tool calls.
    expect(fields.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs a refused tool as ok:false without throwing', async () => {
    // A booking that failed is something to tell the user; only an unreachable
    // Gateway is something to page about.
    const info = vi.spyOn(logger, 'info');
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());
    mcpState.reply = textResult({ ok: false, error: 'That hold has expired.' }, true);

    const result = await client.callTool('valentin-integrations___confirm_reservation', {
      session_id: 'sess-1',
    });

    expect(result).toEqual({ ok: false, error: 'That hold has expired.' });
    const fields = info.mock.calls.find(([e]) => e === 'agentcore.gateway.confirm')![1] as Record<
      string,
      unknown
    >;
    expect(fields.ok).toBe(false);
  });

  it('never logs the tool arguments, which carry a proposal id and a user', async () => {
    const info = vi.spyOn(logger, 'info');
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());

    await client.callTool('valentin-integrations___confirm_email', {
      session_id: 'sess-1',
      user_id: 'her-sub',
      proposal_id: 'prop-1',
    });

    const fields = info.mock.calls.find(([e]) => e === 'agentcore.gateway.confirm')![1];
    expect(Object.keys(fields as object).sort()).toEqual([
      'durationMs',
      'ok',
      'sessionId',
      'tool',
    ]);
  });
});

describe('reading the Lambda’s answer back', () => {
  it('prefers structured content, where there is nothing to parse', async () => {
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());
    mcpState.reply = { structuredContent: { ok: true, summary: 'Sent' }, content: [] };

    await expect(
      client.callTool('valentin-integrations___confirm_email', { session_id: 's' }),
    ).resolves.toEqual({ ok: true, summary: 'Sent' });
  });

  it('keeps unparseable text as a summary rather than throwing on a click that may have booked', async () => {
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());
    mcpState.reply = { isError: false, content: [{ type: 'text', text: 'not json at all' }] };

    await expect(
      client.callTool('valentin-integrations___confirm_gift', { session_id: 's' }),
    ).resolves.toEqual({ ok: true, summary: 'not json at all' });
  });

  it('treats JSON without an ok field as the tool’s prose, carrying isError as the verdict', async () => {
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());
    mcpState.reply = { isError: true, content: [{ type: 'text', text: '{"detail":"nope"}' }] };

    const result = await client.callTool('valentin-integrations___confirm_gift', {
      session_id: 's',
    });
    expect(result.ok).toBe(false);
  });

  it('says so plainly when there is no readable result at all', async () => {
    const { idp } = fakeIdp();
    const client = new GatewayToolClient(CFG, idp, fakeToken());
    mcpState.reply = { isError: false, content: [] };

    await expect(
      client.callTool('valentin-integrations___confirm_gift', { session_id: 's' }),
    ).resolves.toEqual({ ok: false, error: 'The Gateway returned no readable result.' });
  });
});
