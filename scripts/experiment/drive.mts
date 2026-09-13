/**
 * Replays the frozen 120-turn corpus against one engine and records every frame.
 *
 * Usage:
 *   npx tsx scripts/experiment/drive.mts --engine=a --out=runs/engine-a.jsonl
 *   npx tsx scripts/experiment/drive.mts --engine=b --out=runs/engine-b.jsonl
 *   npx tsx scripts/experiment/drive.mts --engine=b --limit=2 --out=/tmp/smoke-b.jsonl
 *
 * Flags:
 *   --engine=a|b     which arm. `a` -> /ws, `b` -> /ws/agentcore. REQUIRED.
 *   --out=PATH       JSONL destination. REQUIRED.
 *   --base=URL       origin. Defaults to the deployed CloudFront distribution.
 *   --limit=N        only the first N conversations (smoke tests).
 *   --only=ID        a single conversation by corpus id, e.g. `c11-chatter-short`. Overrides
 *                    --limit. Added for the cold-start probe, which needs to choose a
 *                    stimulus by its tool-call behaviour rather than by corpus position;
 *                    like --limit it marks the run `smoke`, so it can never be priced.
 *   --turns=N        only the first N turns of each conversation. Smoke tests ONLY — it
 *                    breaks the 120-turn usage assumption and the ordering contracts the
 *                    corpus documents, so a run using it is not a measurement.
 *   --think=SECONDS  inter-turn pause. Default 4. Same on both arms, deliberately.
 *   --to=EMAIL       substituted for {{TO}} in the corpus.
 *   --timeout=SECONDS per-turn ceiling before the arm aborts. Default 120.
 *
 * Why a raw socket rather than one of the existing drivers: every other driver in
 * this repo (`rehearsal.mjs`, `scripts/demo-drive.mts`, `scripts/drive-chat.ts`, the
 * e2e specs) goes through Chromium. That adds browser scheduling to a latency
 * measurement and forces the reply to be read off the DOM, when the server is
 * already sending a `turn_metrics` frame with the numbers in it. `ws` is a
 * production dependency, so this costs nothing to add.
 *
 * Three things this script is strict about, each of which would silently corrupt the
 * experiment if it were lenient:
 *
 *   1. It asserts `turn_metrics.engine` on EVERY turn and aborts the arm on the first
 *      mismatch. `resolveEngine()` (src/server/agent/engine.ts:35) downgrades engine B
 *      to engine A when the AgentCore env is incomplete, so a run labelled by the URL
 *      it dialled can quite happily be engine A twice. The URL is a request; the frame
 *      is the fact.
 *   2. It runs strictly serially — one conversation, one socket, one turn at a time.
 *      No log line in this system carries a turn id (`withTurn` passes only
 *      `sessionId`, src/server/telemetry/turn-metrics.ts:34-38), so attributing a
 *      `bedrock.converse` line to a turn is timestamp-windowed. Concurrency would
 *      destroy the only attribution mechanism available.
 *   3. It records raw frames verbatim, not a summary. Analysis is re-derivable from
 *      the JSONL without paying for another run.
 */

import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import WebSocket from 'ws';

import {
  DEFAULT_NOTIFY_EMAIL,
  EXPERIMENT_CONVERSATIONS,
  conversationTurns,
  type ExperimentConversation,
} from './conversations.js';

const DEFAULT_BASE = 'https://d26dwovftfq9oe.cloudfront.net';

/**
 * Load-bearing. A WebSocket handshake carrying no `User-Agent` is answered `403` before it
 * reaches the ALB — verified against the deployed distribution: identical requests succeed with
 * a UA and fail without one, with or without an `Origin`. `ws` sends none by default, which is
 * why a browser can open the same socket that this driver could not.
 */
const USER_AGENT = 'valentin-experiment-driver/1.0 (+scripts/experiment/drive.mts)';

/** Engine A serves `/ws`; the ALB routes `/ws/agentcore` to the engine-B proxy. */
const WS_PATH = { a: '/ws', b: '/ws/agentcore' } as const;

/** What `turn_metrics.engine` must read for each arm. See EngineId. */
const EXPECTED_ENGINE = { a: 'valentin', b: 'agentcore' } as const;

type Arm = keyof typeof WS_PATH;

interface Options {
  arm: Arm;
  out: string;
  base: string;
  limit: number;
  only: string | null;
  turnLimit: number;
  thinkMs: number;
  notifyEmail: string;
  turnTimeoutMs: number;
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    flags.set(match[1], match[2] ?? 'true');
  }

  const arm = flags.get('engine');
  if (arm !== 'a' && arm !== 'b') {
    throw new Error('--engine=a or --engine=b is required');
  }
  const out = flags.get('out');
  if (!out) throw new Error('--out=PATH is required');

  return {
    arm,
    out,
    base: (flags.get('base') ?? DEFAULT_BASE).replace(/\/+$/, ''),
    limit: Number(flags.get('limit') ?? EXPERIMENT_CONVERSATIONS.length),
    only: flags.get('only') ?? null,
    turnLimit: Number(flags.get('turns') ?? Number.POSITIVE_INFINITY),
    thinkMs: Number(flags.get('think') ?? 4) * 1000,
    notifyEmail: flags.get('to') ?? DEFAULT_NOTIFY_EMAIL,
    turnTimeoutMs: Number(flags.get('timeout') ?? 120) * 1000,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** ISO-8601, matching what the server puts on its own envelopes. */
const now = () => new Date().toISOString();

interface DemoSession {
  accessToken: string;
  visitorId: string;
}

/**
 * One demo login per arm, not one per conversation.
 *
 * `POST /api/demo/login` is rate limited to 10 per 60s per task
 * (src/server/auth/demo-login.ts:27), and every demo visitor shares one Cognito
 * subject — `storageUserId()` appends the visitorId to partition storage as
 * `USER#<sub>#<visitorId>`. Holding one visitor identity for the whole arm is
 * therefore both cheaper and the only way HTTP and WebSocket agree about which
 * sessions exist.
 */
async function demoLogin(base: string): Promise<DemoSession> {
  const response = await fetch(`${base}/api/demo/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({ persona: 'fresh' }),
  });
  if (!response.ok) {
    throw new Error(
      `demo login failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    accessToken?: string;
    visitorId?: string;
  };
  if (!body.accessToken || !body.visitorId) {
    throw new Error('demo login returned no accessToken/visitorId');
  }
  return { accessToken: body.accessToken, visitorId: body.visitorId };
}

/**
 * A fresh session per conversation, minted over HTTP rather than by re-logging in.
 *
 * One conversation == one session == one long-lived AgentCore Runtime microVM:
 * `runtimeSessionIdFor()` (src/server/agent/agentcore-adapter.ts:417) passes the app
 * session UUID straight through as `runtimeSessionId`. That is what makes the 12
 * conversations into 12 billable Runtime sessions, which is the shape the GB-hour
 * meter actually charges on.
 */
async function createSession(
  base: string,
  demo: DemoSession,
  arm: Arm,
): Promise<string> {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${demo.accessToken}`,
      'X-Demo-Visitor': demo.visitorId,
      'user-agent': USER_AGENT,
      // Routes the HTTP half of the run to the same task the socket will hit.
      // The ALB forwards on this header (compute-stack.ts:873-879); the
      // /api/agentcore/* path rule matches no Express route and 404s.
      ...(arm === 'b' ? { 'X-Valentin-Engine': 'agentcore' } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `create session failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { sessionId?: string };
  if (!body.sessionId) throw new Error('create session returned no sessionId');
  return body.sessionId;
}

/** Reports what the deployment thinks it is serving, before any turn is measured. */
async function reportedEngine(base: string, arm: Arm): Promise<string> {
  const response = await fetch(`${base}/api/config`, {
    headers: {
      'user-agent': USER_AGENT,
      ...(arm === 'b' ? { 'X-Valentin-Engine': 'agentcore' } : {}),
    },
  });
  const body = (await response.json()) as { engine?: string };
  return body.engine ?? 'unknown';
}

interface TurnRecord {
  conversationId: string;
  turnIndex: number;
  /** Driver-observed wall clock, send -> agent_message. Independent of the server. */
  wallMs: number;
  /** The server's own measurement. Excludes engine A's deferred extraction call. */
  replyLatencyMs?: number;
  engine?: string;
  modelCalls?: number;
  storeReads?: number;
  storeBackend?: string;
  inputTokens?: number;
  outputTokens?: number;
  ok?: boolean;
}

class Recorder {
  private readonly stream: WriteStream;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { flags: 'w' });
  }

  write(kind: string, data: unknown): void {
    this.stream.write(`${JSON.stringify({ at: now(), kind, data })}\n`);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}

class EngineMismatchError extends Error {
  constructor(expected: string, actual: string, where: string) {
    super(
      `engine mismatch at ${where}: expected "${expected}", server served "${actual}". ` +
        'The deployment downgraded — check the agent.engine {requested, resolved} boot ' +
        'line in the proxy log group. Aborting rather than recording engine A twice.',
    );
    this.name = 'EngineMismatchError';
  }
}

/**
 * Drives one conversation over one socket, serially, and returns its turn records.
 */
async function runConversation(
  options: Options,
  demo: DemoSession,
  conversation: ExperimentConversation,
  recorder: Recorder,
): Promise<TurnRecord[]> {
  const sessionId = await createSession(options.base, demo, options.arm);
  const wsBase = options.base.replace(/^http/, 'ws');
  const socket = new WebSocket(`${wsBase}${WS_PATH[options.arm]}`, {
    headers: { 'user-agent': USER_AGENT },
    origin: options.base,
  });

  const expected = EXPECTED_ENGINE[options.arm];
  const records: TurnRecord[] = [];

  /** Frames that arrived since the last await. Drained by waitFor(). */
  const inbox: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let socketError: Error | undefined;
  let closed = false;

  socket.on('message', (raw) => {
    let frame: { type: string; payload: Record<string, unknown> };
    try {
      frame = JSON.parse(String(raw));
    } catch {
      recorder.write('unparsed', { raw: String(raw).slice(0, 2000) });
      return;
    }
    // Every frame verbatim. The JSONL is the audit trail; nothing is summarised
    // away here, because a second run costs real Bedrock money.
    recorder.write('frame', { conversationId: conversation.id, ...frame });
    inbox.push(frame);
  });
  socket.on('error', (error) => {
    socketError = error instanceof Error ? error : new Error(String(error));
  });
  socket.on('close', (code, reason) => {
    closed = true;
    recorder.write('close', {
      conversationId: conversation.id,
      code,
      reason: String(reason),
    });
  });

  const waitFor = async (
    predicate: (frame: { type: string; payload: Record<string, unknown> }) => boolean,
    timeoutMs: number,
    what: string,
  ) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (socketError) throw socketError;
      const index = inbox.findIndex(predicate);
      if (index >= 0) return inbox.splice(index, 1)[0];
      if (closed) throw new Error(`socket closed while waiting for ${what}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(50);
    }
  };

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  // The auth frame must be first and must land within 5s or the server closes 4408
  // (src/server/api/ws-gateway.ts). visitorId is load-bearing on a demo token.
  socket.send(
    JSON.stringify({
      type: 'auth',
      payload: {
        token: demo.accessToken,
        sessionId,
        visitorId: demo.visitorId,
      },
      timestamp: now(),
    }),
  );
  await waitFor((frame) => frame.type === 'auth_ok', 15_000, 'auth_ok');

  const turns = conversationTurns(conversation, options.notifyEmail).slice(
    0,
    options.turnLimit,
  );

  for (const [turnIndex, content] of turns.entries()) {
    // Drain anything unsolicited (typing_stop, preference_update, a late span) so
    // this turn's agent_message cannot be satisfied by the previous turn's tail.
    inbox.length = 0;

    const startedAt = Date.now();
    socket.send(
      JSON.stringify({
        type: 'send_message',
        payload: { sessionId, content, messageId: randomUUID() },
        timestamp: now(),
      }),
    );

    // agent_message is the turn-complete signal. turn_metrics may land either side
    // of it, so it is looked for separately rather than assumed to arrive first.
    await waitFor(
      (frame) => frame.type === 'agent_message' || frame.type === 'error',
      options.turnTimeoutMs,
      `agent_message for ${conversation.id}#${turnIndex + 1}`,
    );
    const wallMs = Date.now() - startedAt;

    let metrics: Record<string, unknown> = {};
    try {
      const frame = await waitFor(
        (candidate) => candidate.type === 'turn_metrics',
        10_000,
        'turn_metrics',
      );
      metrics = frame.payload;
    } catch {
      // A missing turn_metrics is a data gap, not a reason to abandon the arm; the
      // wall clock still stands and the gap is visible in the record.
      recorder.write('missing_turn_metrics', {
        conversationId: conversation.id,
        turnIndex,
      });
    }

    const servedBy = metrics.engine as string | undefined;
    if (servedBy && servedBy !== expected) {
      throw new EngineMismatchError(
        expected,
        servedBy,
        `${conversation.id}#${turnIndex + 1}`,
      );
    }

    const record: TurnRecord = {
      conversationId: conversation.id,
      turnIndex,
      wallMs,
      replyLatencyMs: metrics.replyLatencyMs as number | undefined,
      engine: servedBy,
      modelCalls: metrics.modelCalls as number | undefined,
      storeReads: metrics.storeReads as number | undefined,
      storeBackend: metrics.storeBackend as string | undefined,
      inputTokens: metrics.inputTokens as number | undefined,
      outputTokens: metrics.outputTokens as number | undefined,
      ok: metrics.ok as boolean | undefined,
    };
    records.push(record);
    recorder.write('turn', record);

    const latency = record.replyLatencyMs ?? wallMs;
    process.stdout.write(
      `  ${conversation.id} turn ${String(turnIndex + 1).padStart(2)}/${turns.length}  ` +
        `${String(latency).padStart(6)} ms  ` +
        `calls=${record.modelCalls ?? '-'} reads=${record.storeReads ?? '-'}\n`,
    );

    // The think time is a real experimental variable, not cosmetics: engine B's
    // Runtime GB-hours are billed on session wall clock, so this idle gap is on
    // the bill. Identical on both arms.
    if (turnIndex < turns.length - 1) await sleep(options.thinkMs);
  }

  socket.close();
  return records;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const conversations = options.only
    ? EXPERIMENT_CONVERSATIONS.filter((conversation) => conversation.id === options.only)
    : EXPERIMENT_CONVERSATIONS.slice(0, options.limit);
  if (options.only && conversations.length === 0) {
    throw new Error(`--only=${options.only} matches no conversation in the corpus`);
  }
  const recorder = new Recorder(options.out);

  const startedAt = now();
  const configEngine = await reportedEngine(options.base, options.arm);
  process.stdout.write(
    `arm ${options.arm} -> ${options.base}${WS_PATH[options.arm]}\n` +
      `/api/config reports engine: ${configEngine} ` +
      `(expecting ${EXPECTED_ENGINE[options.arm]})\n` +
      `${conversations.length} conversations x 10 turns, ` +
      `${options.thinkMs / 1000}s think time\n\n`,
  );

  // `smoke` is load-bearing metadata, not a nicety: a partial run has the same file shape as
  // a real one, and the collector would happily price it as a month.
  const smoke =
    conversations.length !== EXPERIMENT_CONVERSATIONS.length ||
    Number.isFinite(options.turnLimit);

  recorder.write('run_start', {
    arm: options.arm,
    expectedEngine: EXPECTED_ENGINE[options.arm],
    configEngine,
    base: options.base,
    conversations: conversations.map((conversation) => conversation.id),
    thinkMs: options.thinkMs,
    turnLimit: Number.isFinite(options.turnLimit) ? options.turnLimit : null,
    smoke,
    startedAt,
  });

  const demo = await demoLogin(options.base);
  const all: TurnRecord[] = [];
  let failure: Error | undefined;

  try {
    for (const conversation of conversations) {
      all.push(...(await runConversation(options, demo, conversation, recorder)));
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    recorder.write('run_error', { message: failure.message });
  }

  const latencies = all
    .map((record) => record.replyLatencyMs ?? record.wallMs)
    .filter((value) => Number.isFinite(value));

  const summary = {
    arm: options.arm,
    smoke,
    startedAt,
    endedAt: now(),
    turns: all.length,
    // The window marks the collector needs. Everything CloudWatch-side is scoped
    // to [startedAt, endedAt]; that is what makes the account-level Bedrock token
    // subtraction attributable to this arm and not the other.
    latency: {
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : Number.NaN,
    },
    // Engine A only, and a FLOOR even there: the forced extract-preferences
    // Converse is fire-and-forget (agent-orchestrator.ts:321-327) and resolves
    // after agent.turn is already serialised, so its tokens are in neither of
    // these sums. Take the real figure from bedrock.converse in Logs Insights.
    tokensFromFrames: {
      input: all.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0),
      output: all.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0),
      turnsReporting: all.filter((record) => record.inputTokens !== undefined).length,
    },
    failedTurns: all.filter((record) => record.ok === false).length,
    aborted: failure?.message,
  };

  recorder.write('run_summary', summary);
  await recorder.close();

  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`\nframes -> ${options.out}\n`);
  if (failure) {
    process.stdout.write(`\nARM ABORTED: ${failure.message}\n`);
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
