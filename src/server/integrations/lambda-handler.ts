import { buildToolRegistry } from './index';
import { loadRemoteCredentials } from './credential-store';
import { primePlacesKey } from './google-places/client';
import {
  runTool,
  type ActionProposal,
  type IntegrationId,
  type ToolRegistry,
} from './tool-registry';
import { logger } from '../logging';

/**
 * The integration tools, hosted behind AgentCore Gateway for engine B.
 *
 * ## Why this exists
 *
 * Engine A reaches these tools through `runToolLoop` — a hand-written loop that
 * describes each tool to Bedrock, matches the model's `toolUse` blocks by name and
 * runs them in-process. Engine B is supposed to be the same agent with AgentCore
 * owning the parts Valentin hand-rolls, and until now it was simply weaker: three
 * profile tools and none of the fourteen real ones. This Lambda is the tool host
 * behind a second Gateway target, so engine B reaches the *same* code through one
 * MCP endpoint with the schemas declared once and the JWT handled for it.
 *
 * ## Why it lives in `src/server/` and not `infra/lambda/`
 *
 * `infra/lambda/profile-tools/index.mjs` is a plain asset: it re-implements the
 * key layout from `persistence/keys.ts` because the server's TypeScript never
 * reaches the Lambda runtime, and it carries a comment demanding both copies
 * change in the same commit. Re-implementing *fourteen integrations* that way
 * would be a second Ontopo client, a second Amadeus token cache and a second set
 * of proposal rules — and the first time one drifted, engine B would answer
 * differently from engine A for a reason that had nothing to do with AgentCore,
 * which is the one failure this comparison cannot absorb. So this file sits with
 * the code it wraps and `NodejsFunction` bundles it at synth time.
 *
 * Running the registry outside Express is cheap: the only non-local imports are
 * `config.ts` (a `process.env` literal), `logging.ts` (`node:async_hooks`) and
 * `@hebcal/core`. `browser/session.ts` imports Playwright through a *variable*
 * specifier, so esbuild leaves it alone and the browser probe simply reports
 * false here — the same graceful degradation as a Fargate task with no Chromium.
 *
 * ## The contract, mirrored from the profile target
 *
 * The tool name arrives in the client context rather than the event, prefixed
 * with the target name and a triple underscore
 * (`valentin-integrations___check_shabbat`); the event body is the tool's input
 * and nothing else. Errors are *returned*, never thrown, so the agent reads a
 * message it can act on instead of an opaque Gateway 500 it can only retry.
 *
 * ## On `user_id` being an input rather than a claim
 *
 * Same trust boundary as the profile target, stated in the same plain terms: the
 * Gateway JWT belongs to a machine client and carries no end-user identity, so
 * the caller names the user. What makes that safe is that nothing
 * browser-reachable can call this — the proxy authenticates the Cognito user and
 * derives the storage id itself, invokes the Runtime with SigV4, and only the
 * Runtime holds a Gateway token.
 */

/** What Gateway hands a Lambda target besides the event. */
interface GatewayContext {
  clientContext?: { custom?: Record<string, unknown> };
}

/** The safe projection of a proposal. Deliberately not `Omit<…, 'payload'>`. */
interface ProposalView {
  id: string;
  service: IntegrationId;
  title: string;
  summary: string;
  url?: string;
  expiresAt: string;
}

/** What every invocation answers with. Never carries a credential or a payload. */
export interface GatewayToolResponse {
  ok: boolean;
  summary?: string;
  data?: unknown;
  proposal?: ProposalView;
  error?: string;
}

/**
 * Built once per container, then reused.
 *
 * A module-level promise rather than a flag: two concurrent invocations of a warm
 * container would otherwise both start a Secrets Manager read, and the second
 * would run its tool against a registry the first had already cleared —
 * `buildToolRegistry` refills the live map in place.
 */
let ready: Promise<ToolRegistry> | null = null;

function registry(): Promise<ToolRegistry> {
  ready ??= (async () => {
    // Awaited here, unlike in `createServer`, and for the opposite reason: a
    // Lambda has no health check to keep answering and no `.env` to fall back
    // on, so a tool call that ran before its credential arrived would report the
    // service as simply absent — which reads as "not connected" in the panel
    // while the panel says it is.
    // Two independent reads, run together because neither depends on the other
    // and a cold start pays for both serially otherwise. The Maps key lives in
    // its own secret with its own ARN, so it is not something `credential-store`
    // can pick up; without this line engine B would silently lack place search
    // while engine A had it, which reads as AgentCore losing a tool.
    await Promise.all([loadRemoteCredentials(), primePlacesKey()]);
    return buildToolRegistry();
  })().catch((err: unknown) => {
    // Forget a failed build, so the *next* invocation tries again. Caching the
    // rejection would turn one Secrets Manager blip into a container that answers
    // nothing for its whole lifetime — and a warm Lambda lives for hours.
    ready = null;
    throw err;
  });
  return ready;
}

/** Forget the cached registry, so the next call re-reads. For tests only. */
export function resetHandlerCacheForTests(): void {
  ready = null;
}

/**
 * Read the tool name out of the Gateway client context.
 *
 * Splitting on the delimiter and taking the last segment rather than stripping a
 * known prefix, so renaming the target in the stack does not break this file —
 * the same reasoning, and the same code, as the profile target.
 */
function toolNameFrom(context: GatewayContext | undefined): string {
  const raw = context?.clientContext?.custom?.bedrockAgentCoreToolName;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      'No bedrockAgentCoreToolName in clientContext — this Lambda is only callable through AgentCore Gateway',
    );
  }
  return raw.split('___').pop() as string;
}

/**
 * The two identity arguments every tool schema carries, and no tool wants.
 *
 * They are injected by `agentcore/agent.py` rather than named by the model, and
 * stripped here before `execute` sees the input — an integration tool's schema
 * knows nothing about users or sessions, and passing them through would look like
 * a stray argument to every one of the fourteen.
 */
const IDENTITY_ARGS = ['user_id', 'session_id'] as const;

function requireIdentity(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new Error(`${name} must be a non-empty string of at most 128 characters`);
  }
  return value;
}

/**
 * Strip a proposal down to what may leave this process.
 *
 * Field by field rather than a rest-spread of `payload`, matching `onProposal` in
 * `src/server/index.ts` and for the same reason: `ActionProposal.payload` holds
 * whatever the owning tool needs at confirm time — an Ontopo area id, the prose
 * of a proposed message — and a spread would put a later addition on the wire the
 * day someone adds one. The model must not see it either, since the model is not
 * the thing that confirms.
 */
function proposalView(proposal: ActionProposal): ProposalView {
  return {
    id: proposal.id,
    service: proposal.service,
    title: proposal.title,
    summary: proposal.summary,
    ...(proposal.url ? { url: proposal.url } : {}),
    expiresAt: proposal.expiresAt,
  };
}

export async function handler(
  event: Record<string, unknown> | undefined,
  context: GatewayContext | undefined,
): Promise<GatewayToolResponse> {
  let name = '<unknown>';
  try {
    name = toolNameFrom(context);
    const input = { ...(event ?? {}) };

    // Validated even though the read-only tools ignore both: `session_id` is the
    // key `runTool` logs every span under, and getting a turn's worth of
    // integration calls filed under `undefined` is the kind of thing nobody
    // notices until they need the trace.
    const userId = requireIdentity(input, 'user_id');
    const sessionId = requireIdentity(input, 'session_id');
    for (const key of IDENTITY_ARGS) delete input[key];

    const tool = (await registry()).get(name);
    if (!tool) {
      /*
       * Two very different causes, one answer.
       *
       * Either the model invented a name — in which case telling it what exists
       * is the most useful thing that can happen — or the tool is real but its
       * integration has no credential in this Lambda, since `buildToolRegistry`
       * gates registration on readiness. The second is the likelier one here and
       * the reason this is not a thrown error: "I can't book tables yet" is a
       * sentence Valentin can say, where a Gateway 500 is one he can only retry.
       */
      const known = [...(await registry()).keys()].sort().join(', ');
      logger.warn('gateway.tool-unknown', { tool: name, registered: known.length });
      return {
        ok: false,
        error: `No tool "${name}" is available in this deployment. Available: ${known || 'none'}`,
      };
    }

    // `runTool`, not `tool.execute`: it is the wrapper that never throws and that
    // logs exactly one `integration.<service>` line with a measured duration,
    // which is what `span-bridge.ts` turns into a span. Calling `execute`
    // directly would make engine B's tool calls invisible in the Inspector while
    // engine A's were visible — a difference in the instrument, not the subject.
    //
    // `userId` is passed because a tool may need to *name* the owner — a share
    // link carries both the conversation and whose it is — not to authorise
    // anything. It is the id the proxy supplied, stripped from `input` above so
    // the model cannot substitute another one.
    const result = await runTool(tool, input, { sessionId, userId });

    logger.info('gateway.tool-invoked', {
      sessionId,
      tool: name,
      integration: tool.service,
      ok: result.ok,
      // Logged so a proposal that never becomes a card can be told apart from one
      // that was never raised. Not the id — that is Step 6's row key, and this
      // line goes to CloudWatch.
      proposed: Boolean(result.proposal),
      // The one place `user_id` appears, and only as a length: it is a Cognito
      // sub, and a log line is not the place for it.
      userIdLength: userId.length,
    });

    return {
      ok: result.ok,
      summary: result.summary,
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.proposal ? { proposal: proposalView(result.proposal) } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('gateway.tool-failed', { tool: name, cause: message });
    return { ok: false, error: message };
  }
}
