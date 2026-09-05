import type { BedrockClient } from './bedrock-client';
import type { ChatMessage } from '../../shared/interfaces/message';
import { AppError } from '../../shared/errors/base-error';

/**
 * Does this process have a working model call, and if not, why?
 *
 * The failure this exists to prevent is a specific and embarrassing one. When
 * `bedrock:InvokeModel` is denied — the default for a plain IAM user, and what a
 * local `npx tsx src/server/dev-server.ts` without `AWS_PROFILE` gets — the
 * orchestrator catches the error and answers "I'm sorry, I'm having a little
 * trouble right now." That sentence is indistinguishable from a transient blip,
 * so a misconfigured process looks like a working one that is having a bad
 * minute. It gets discovered by typing into the app, which during a demo means
 * it gets discovered in front of an audience.
 *
 * So we ask the question once, at boot, in a place where the answer can be
 * printed in full: a denial is a *configuration* fault and should read like one.
 *
 * This is deliberately not a gate. It never throws and never prevents the server
 * from listening — the health check backs the ALB target group, and refusing to
 * boot on a Bedrock hiccup would turn a degraded chat into an outage that also
 * takes down the share links, the dossier and the login page. It reports.
 */

export type BedrockReadiness =
  | { ok: true }
  | { ok: false; kind: PreflightFailure; detail: string; hint: string };

/**
 * Why the call failed, at the granularity that changes what you'd *do* about it.
 * `denied` and `no-model-access` both surface as AccessDenied but are fixed in
 * different consoles, which is the whole reason they are separate.
 */
export type PreflightFailure =
  | 'denied'
  | 'no-credentials'
  | 'no-model-access'
  | 'throttled'
  | 'unreachable'
  | 'unknown';

/** Cheapest possible real Converse call: one token in, one token out. */
const PROBE_MESSAGE: ChatMessage = {
  id: 'preflight',
  sessionId: 'preflight',
  sender: 'user',
  content: 'hi',
  timestamp: new Date(0).toISOString(),
};

const PROBE_PROMPT = 'Reply with the single word: ok';

/**
 * Flatten an error into the one string worth matching against.
 *
 * `AwsBedrockClient` does not let the SDK's error out: it wraps every failure in
 * an `LlmError('Bedrock generateResponse failed')` and files the real reason
 * under `context.cause`. Reading only `err.message` therefore classifies every
 * single fault as `unknown`, which was the first version of this and was worse
 * than useless — it produced a loud banner that named no cause. So the context
 * values come along too.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (!(err instanceof AppError)) return err.message;

  const extras = Object.entries(err.context)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => `${k}=${String(v)}`);
  return extras.length ? `${err.message} (${extras.join(', ')})` : err.message;
}

function classify(message: string): { kind: PreflightFailure; hint: string } {
  const m = message.toLowerCase();

  if (m.includes('could not load credentials') || m.includes('credential')) {
    return {
      kind: 'no-credentials',
      hint:
        'This process has no usable AWS credentials. Locally, start it with ' +
        'AWS_PROFILE=dev-devops-agent. In ECS, check the task role.',
    };
  }
  if (m.includes('not authorized to perform: bedrock:invokemodel')) {
    return {
      kind: 'denied',
      hint:
        'The caller identity lacks bedrock:InvokeModel. Locally this is the ' +
        'default for the plain IAM user — start the server with ' +
        'AWS_PROFILE=dev-devops-agent AWS_REGION=us-east-1. Every chat turn ' +
        'will otherwise answer with the "having a little trouble" fallback.',
    };
  }
  if (m.includes("don't have access to the model") || m.includes('model access')) {
    return {
      kind: 'no-model-access',
      hint:
        'The credentials are valid but this account has not been granted access ' +
        'to the model in this region. Check the region — the inference profile ' +
        'is enabled in us-east-1; a stray AWS_REGION=us-west-2 lands here.',
    };
  }
  if (m.includes('throttl') || m.includes('too many requests')) {
    return {
      kind: 'throttled',
      hint:
        'Bedrock is throttling this account right now. Chat will retry with ' +
        'backoff, but expect slow turns until the quota frees up.',
    };
  }
  if (
    m.includes('enotfound') ||
    m.includes('econnrefused') ||
    m.includes('etimedout') ||
    m.includes('timeout') ||
    m.includes('getaddrinfo')
  ) {
    return {
      kind: 'unreachable',
      hint:
        'Bedrock could not be reached at all — check egress from this subnet ' +
        '(NAT gateway or VPC endpoint) and the configured region.',
    };
  }
  return {
    kind: 'unknown',
    hint: 'Unrecognised Bedrock failure — the detail below is the whole error.',
  };
}

/**
 * Invoke the model once and report what happened.
 *
 * Bounded by its own timeout: a call that hangs must not hold up `listen()`, or
 * the container health check fails and ECS rolls the task before it ever serves.
 */
export async function checkBedrockReadiness(
  client: Pick<BedrockClient, 'generateResponse'>,
  timeoutMs = 10_000,
): Promise<BedrockReadiness> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probe = client.generateResponse([PROBE_MESSAGE], PROBE_PROMPT);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Bedrock preflight timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    await Promise.race([probe, timeout]);
    return { ok: true };
  } catch (err) {
    const detail = describeError(err);
    const { kind, hint } = classify(detail);
    return { ok: false, kind, detail, hint };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The banner. Multi-line and loud on failure, one quiet line on success —
 * a boot log nobody reads is worth nothing, and one that shouts on every start
 * teaches you to ignore it.
 */
export function describeReadiness(
  readiness: BedrockReadiness,
  modelId: string,
  region: string,
): string {
  if (readiness.ok) {
    return `[preflight] Bedrock reachable — ${modelId} in ${region}`;
  }
  return [
    '',
    '  ┌─ BEDROCK IS NOT USABLE BY THIS PROCESS ─────────────────────────',
    `  │ Every chat turn will answer with the "having a little trouble"`,
    '  │ fallback until this is fixed. Chat is the demo.',
    `  │`,
    `  │ cause  : ${readiness.kind}`,
    `  │ model  : ${modelId}`,
    `  │ region : ${region}`,
    `  │ error  : ${readiness.detail}`,
    `  │`,
    `  │ fix    : ${readiness.hint}`,
    '  └──────────────────────────────────────────────────────────────────',
    '',
  ].join('\n');
}
