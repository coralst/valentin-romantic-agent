#!/usr/bin/env node
/**
 * Collects the CloudWatch side of the engine A vs engine B experiment.
 *
 *   node scripts/experiment/collect.mjs --run runs/engine-a.jsonl --out runs/engine-a-metrics.json
 *   node scripts/experiment/collect.mjs --run runs/engine-b.jsonl --out runs/engine-b-metrics.json
 *
 * The run window is read from the `run_start` / `run_summary` records the driver
 * wrote, so the two halves of the measurement cannot drift apart.
 *
 * Everything here is READ-ONLY. It shells out through `uvx --quiet --from awscli aws`
 * because the system CLI is 2.17.14 and lacks several of the subcommands, and it needs
 * AWS_PROFILE=dev-devops-agent because the default identity is denied.
 *
 * Three things worth knowing about the queries:
 *
 *   1. Engine A's token cost comes from `bedrock.converse` lines, NOT from `agent.turn`.
 *      The forced `extract-preferences` Converse is fire-and-forget
 *      (src/server/agent/agent-orchestrator.ts:321-327) and resolves after `agent.turn`
 *      has already been serialised, so the turn frame is a floor, not a total.
 *   2. Engine B's tokens come from GenAI Observability spans if they are there, and
 *      otherwise from an account-level `AWS/Bedrock` window subtraction. That fallback
 *      is only valid because the arms run sequentially in disjoint windows.
 *   3. `agent.turn` has two unrelated producers — the Node proxy and agent.py — so
 *      every query is scoped by log group. Never query it account-wide.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const REGION = 'us-east-1';
const ACCOUNT = '684394110906';

const RUNTIME_ARN =
  `arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT}:runtime/valentin_agent_dev-Yn2GsXHG69`;
const GATEWAY_ARN =
  `arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT}:gateway/valentin-gateway-dev-uv3esftjfc`;

const LOG_GROUPS = {
  engineA: '/valentin/dev/service',
  engineBProxy: '/valentin/dev/agentcore',
  runtime: '/valentin/agentcore/dev',
  spans: 'aws/spans',
};

const TABLE = 'ValentinTable-dev';
const LAMBDAS = ['valentin-profile-tools-dev', 'valentin-integration-tools-dev'];

/**
 * The Runtime's counters need the FULL dimension set, not just `Resource`.
 *
 * `get-metric-statistics` matches a dimension set exactly — a subset returns zero
 * datapoints, which is indistinguishable from "no traffic" unless you have already
 * confirmed the traffic happened. Verified against `list-metrics`: every Runtime
 * `Invocations`/`Errors`/`Throttles`/`Sessions` series carries
 * `Resource` + `Operation` + `Name`, and querying `Resource` alone was why the smoke
 * run reported the Runtime as entirely idle while the Gateway showed its two calls.
 */
const RUNTIME_NAME = 'valentin_agent_dev::DEFAULT';
const RUNTIME_DIMS = [
  ['Resource', RUNTIME_ARN],
  ['Operation', 'InvokeAgentRuntime'],
  ['Name', RUNTIME_NAME],
];

/**
 * The vCPU/GB-hour meters, in descending order of specificity.
 *
 * These are BILLING meters and they publish on their own schedule: on 2026-09-12 the
 * only `MemoryUsed-GBHours` datapoint in the trailing four days was stamped
 * 2026-09-08, with nothing for traffic minutes old, and it existed only under the
 * `Service`-only dimension set. So they cannot price a one-hour experiment window on
 * the day it runs. `runtimeComputeMeters()` reports whichever set answers and marks
 * the result `lagging` when none does; the authoritative figure comes from re-running
 * the collector days later, and the run-day number comes from measured session
 * wall-clock instead (see `sessionWallClock()`).
 */
const COMPUTE_METER_DIMS = [
  [['Resource', RUNTIME_ARN], ['Service', 'AgentCore.Runtime'], ['Name', RUNTIME_NAME]],
  [['Resource', RUNTIME_ARN], ['Service', 'AgentCore.Runtime']],
  [['Service', 'AgentCore.Runtime']],
];

// ---------------------------------------------------------------------- plumbing

function aws(service, command, args) {
  const argv = [
    '--quiet', '--from', 'awscli', 'aws', service, command,
    '--region', REGION, '--output', 'json', ...args,
  ];
  try {
    const stdout = execFileSync('uvx', argv, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE ?? 'dev-devops-agent' },
    });
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch (error) {
    const detail = (error.stderr ?? error.message ?? '').toString().trim();
    return { __error: detail.slice(0, 400) };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sum/aggregate a get-metric-statistics response.
 *
 * A `null` here means "no datapoints", which is NOT the same as zero — when every
 * metric came back null in an earlier pass the cause was wrong dimension names, not
 * absent traffic. Keep the distinction visible in the output.
 */
function statistic(response, key, how = 'sum') {
  if (!response || response.__error) return null;
  const values = (response.Datapoints ?? [])
    .map((point) => (key in point ? point[key] : point.ExtendedStatistics?.[key]))
    .filter((value) => typeof value === 'number');
  if (values.length === 0) return null;
  if (how === 'sum') return values.reduce((a, b) => a + b, 0);
  if (how === 'max') return Math.max(...values);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function metric(namespace, name, dimensions, { stats = ['Sum'], extended, period = 300,
  start, end }) {
  const args = [
    '--namespace', namespace, '--metric-name', name,
    '--start-time', start, '--end-time', end,
    '--period', String(period),
  ];
  if (dimensions.length) {
    args.push('--dimensions',
      ...dimensions.map(([key, value]) => `Name=${key},Value=${value}`));
  }
  if (stats?.length) args.push('--statistics', ...stats);
  if (extended?.length) args.push('--extended-statistics', ...extended);
  return aws('cloudwatch', 'get-metric-statistics', args);
}

/** Starts a Logs Insights query and polls until it completes. */
async function insights(logGroups, query, { start, end }) {
  const startedAt = Math.floor(new Date(start).getTime() / 1000);
  const endedAt = Math.ceil(new Date(end).getTime() / 1000);
  const started = aws('logs', 'start-query', [
    '--log-group-names', ...logGroups,
    '--start-time', String(startedAt),
    '--end-time', String(endedAt),
    '--query-string', query,
    '--limit', '10000',
  ]);
  if (!started || started.__error) return { __error: started?.__error ?? 'start failed' };

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(1500);
    const result = aws('logs', 'get-query-results', ['--query-id', started.queryId]);
    if (!result || result.__error) return { __error: result?.__error ?? 'poll failed' };
    if (result.status === 'Complete') {
      // Flatten [{field,value}] rows into plain objects.
      return (result.results ?? []).map((row) =>
        Object.fromEntries(row.map(({ field, value }) => [field, value])));
    }
    if (result.status === 'Failed' || result.status === 'Cancelled') {
      return { __error: `query ${result.status}` };
    }
  }
  return { __error: 'query timed out after 90s' };
}

// ------------------------------------------------------------------- the run file

function readRun(path) {
  const records = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const start = records.find((record) => record.kind === 'run_start');
  const summary = records.find((record) => record.kind === 'run_summary');
  if (!start || !summary) {
    throw new Error(`${path} has no run_start/run_summary — was the arm aborted early?`);
  }
  const turns = records.filter((record) => record.kind === 'turn').map((r) => r.data);

  /**
   * Session wall-clock per conversation, from the driver's own envelope timestamps.
   *
   * This is what the Runtime's memory-hour meter actually bills on — one conversation
   * is one `runtimeSessionId` and therefore one long-lived microVM — and it is the
   * measured replacement for the old `SEC_PER_TURN = 3` guess in cost-model.mjs. It is
   * available on the day of the run, which the GB-hour meter is not.
   *
   * First-to-last frame slightly under-counts: it misses the handshake before the
   * first frame and any teardown after the last. A floor is the right error direction
   * for a bill.
   */
  const spans = new Map();
  for (const record of records) {
    const id = record.data?.conversationId;
    if (!id) continue;
    const at = new Date(record.at).getTime();
    const span = spans.get(id) ?? { first: at, last: at };
    spans.set(id, { first: Math.min(span.first, at), last: Math.max(span.last, at) });
  }
  const sessions = [...spans.entries()].map(([conversationId, span]) => ({
    conversationId,
    wallClockSec: (span.last - span.first) / 1000,
  }));

  return {
    sessions,
    sessionWallClockSec: sessions.reduce((sum, s) => sum + s.wallClockSec, 0),
    arm: start.data.arm,
    expectedEngine: start.data.expectedEngine,
    // A partial run has the same file shape as a real one. Carried through so the collector
    // can refuse to let a smoke test be priced as a month.
    smoke: start.data.smoke === true,
    // Pad the window: CloudWatch buckets on period boundaries, and engine B's Memory
    // extraction is asynchronous and lands minutes after the last turn.
    window: {
      start: new Date(new Date(start.data.startedAt).getTime() - 60_000).toISOString(),
      end: new Date(new Date(summary.data.endedAt).getTime() + 600_000).toISOString(),
    },
    tight: { start: start.data.startedAt, end: summary.data.endedAt },
    turns,
    summary: summary.data,
  };
}

// --------------------------------------------------------------------- collectors

/** Engine A's real token cost. `agent.turn` under-counts it; this does not. */
async function engineATokens(window) {
  // The aliases must NOT be named `inputTokens`/`outputTokens`. Logs Insights discovers
  // those names from the JSON payload, and `sum(inputTokens) as inputTokens` shadows the
  // source field with the aggregate — the column then comes back null and is dropped from
  // the row entirely, which reads exactly like "the log carries no token fields". It does
  // carry them; this cost one run's analysis to find.
  const query = `
    fields @timestamp
    | filter event = "bedrock.converse"
    | stats count() as calls,
            sum(inputTokens) as inTokens,
            sum(outputTokens) as outTokens,
            max(inputTokens) as maxInTokens,
            avg(durationMs) as avgDurationMs,
            sum(ok = 0) as failures
      by operation
    | sort calls desc`;
  return insights([LOG_GROUPS.engineA], query, window);
}

/** Contamination check. More than the expected turn count means someone else was on. */
async function turnCount(logGroup, window) {
  const query = `
    fields @timestamp
    | filter event = "agent.turn" and ispresent(replyLatencyMs)
    | stats count() as turns by engine`;
  return insights([logGroup], query, window);
}

async function toolLoopTruncations(window) {
  const query = `
    fields @timestamp
    | filter event = "agent.tool_loop_truncated"
    | stats count() as truncated`;
  return insights([LOG_GROUPS.engineA], query, window);
}

/** Engine A's per-tool work. Engine B deliberately logs no per-tool duration. */
async function engineATools(window) {
  const query = `
    fields @timestamp
    | filter event like /^integration\\./ and ispresent(durationMs)
    | stats count() as calls, avg(durationMs) as avgMs, max(durationMs) as maxMs
      by integration
    | sort calls desc`;
  return insights([LOG_GROUPS.engineA], query, window);
}

/**
 * Engine B's tokens, primary path: GenAI Observability spans.
 *
 * Requires CloudWatch Transaction Search, enabled in this account on 2026-09-12 at
 * 100% sampling. Attribute names follow the OTel gen_ai semantic conventions, but
 * ADOT has moved them between releases, so several spellings are tried and the one
 * that returns rows wins. An empty result triggers the fallback rather than being
 * silently reported as zero tokens.
 */
async function engineBTokensFromSpans(window) {
  const attempts = [
    ['gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens'],
    ['gen_ai.usage.prompt_tokens', 'gen_ai.usage.completion_tokens'],
    ['attributes.gen_ai.usage.input_tokens', 'attributes.gen_ai.usage.output_tokens'],
  ];
  for (const [inputField, outputField] of attempts) {
    const query = `
      fields @timestamp
      | filter ispresent(\`${inputField}\`)
      | stats count() as llmSpans,
              sum(\`${inputField}\`) as inputTokens,
              sum(\`${outputField}\`) as outputTokens`;
    const rows = await insights([LOG_GROUPS.spans], query, window);
    if (!rows.__error && rows.length > 0 && Number(rows[0].llmSpans ?? 0) > 0) {
      return { source: 'spans', attribute: inputField, ...rows[0] };
    }
  }
  return { source: 'spans', llmSpans: 0, note: 'no LLM spans matched — use fallback' };
}

/**
 * Engine B's tokens, fallback: account-level AWS/Bedrock over this arm's window.
 *
 * Valid only because the arms are sequential and disjoint, and only if the quiet
 * windows really were quiet — which `turnCount` above is what audits.
 */
function engineBTokensFromAccountMetrics(window) {
  const options = { stats: ['Sum'], period: 300, ...window };
  return {
    source: 'account-metrics',
    caveat:
      'account-wide AWS/Bedrock counters for this window. Attributable to arm B only ' +
      'because the arms ran in disjoint windows with verified-quiet gaps.',
    invocations: statistic(metric('AWS/Bedrock', 'Invocations', [], options), 'Sum'),
    inputTokens: statistic(metric('AWS/Bedrock', 'InputTokenCount', [], options), 'Sum'),
    outputTokens: statistic(metric('AWS/Bedrock', 'OutputTokenCount', [], options), 'Sum'),
  };
}

/**
 * Tries each dimension set until one answers, so a lagging meter is reported as
 * lagging rather than as zero burn.
 */
function runtimeComputeMeters(window) {
  const sum = { stats: ['Sum'], period: 3600, ...window };
  const out = { vcpuHours: null, gbHours: null, dimensions: null, lagging: true };
  for (const dimensions of COMPUTE_METER_DIMS) {
    const vcpuHours = statistic(
      metric('AWS/Bedrock-AgentCore', 'CPUUsed-vCPUHours', dimensions, sum), 'Sum');
    const gbHours = statistic(
      metric('AWS/Bedrock-AgentCore', 'MemoryUsed-GBHours', dimensions, sum), 'Sum');
    if (vcpuHours !== null || gbHours !== null) {
      return {
        vcpuHours,
        gbHours,
        dimensions: dimensions.map(([key, value]) => `${key}=${value}`),
        lagging: false,
      };
    }
  }
  out.note =
    'no datapoints under any dimension set. These are billing meters that publish days ' +
    'late (2026-09-12: newest MemoryUsed-GBHours datapoint was 2026-09-08). Re-run this ' +
    'collector against the same window in a few days for the authoritative figure; until ' +
    'then use sessionWallClock, which is measured.';
  return out;
}

function agentCoreMetrics(window) {
  const sum = { stats: ['Sum'], period: 300, ...window };
  const avg = { stats: ['Average', 'Maximum', 'SampleCount'], period: 300, ...window };

  const runtime = {
    invocations: statistic(
      metric('AWS/Bedrock-AgentCore', 'Invocations', RUNTIME_DIMS, sum), 'Sum'),
    // One billable microVM session per conversation, straight from the meter's own
    // count rather than inferred from the driver.
    sessions: statistic(
      metric('AWS/Bedrock-AgentCore', 'Sessions', RUNTIME_DIMS, sum), 'Sum'),
    errors: statistic(metric('AWS/Bedrock-AgentCore', 'Errors', RUNTIME_DIMS, sum), 'Sum'),
    throttles: statistic(
      metric('AWS/Bedrock-AgentCore', 'Throttles', RUNTIME_DIMS, sum), 'Sum'),
    avgLatencyMs: statistic(
      metric('AWS/Bedrock-AgentCore', 'Latency', RUNTIME_DIMS, avg), 'Average', 'avg'),
    compute: runtimeComputeMeters(window),
  };

  const memory = {};
  for (const operation of ['CreateEvent', 'ListEvents', 'RetrieveMemoryRecords',
    'ListMemoryRecords', 'Extraction', 'Consolidation']) {
    const dimensions = [['Operation', operation]];
    memory[operation] = {
      invocations: statistic(
        metric('AWS/Bedrock-AgentCore', 'Invocations', dimensions, sum), 'Sum'),
      errors: statistic(
        metric('AWS/Bedrock-AgentCore', 'Errors', dimensions, sum), 'Sum'),
      // `Latency`, not `Duration`: list-metrics shows no Duration series dimensioned
      // by Operation alone, so the old query could only ever return null here.
      avgDurationMs: statistic(
        metric('AWS/Bedrock-AgentCore', 'Latency', dimensions, avg), 'Average', 'avg'),
    };
    if (operation === 'Extraction' || operation === 'Consolidation') {
      memory[operation].inputTokens = statistic(
        metric('AWS/Bedrock-AgentCore', 'InputTokenUsage', dimensions, sum), 'Sum');
      memory[operation].outputTokens = statistic(
        metric('AWS/Bedrock-AgentCore', 'OutputTokenUsage', dimensions, sum), 'Sum');
    }
  }
  for (const itemType of ['Event', 'MemoryRecordsExtracted']) {
    memory[`created_${itemType}`] = statistic(
      metric('AWS/Bedrock-AgentCore', 'CreationCount', [['ItemType', itemType]], sum),
      'Sum');
  }

  const gateway = { byMethod: {} };
  for (const method of ['initialize', 'notifications/initialized', 'tools/list',
    'tools/call']) {
    const dimensions = [['Operation', 'InvokeGateway'], ['Method', method],
      ['Protocol', 'MCP']];
    gateway.byMethod[method] = {
      calls: statistic(metric('AWS/Bedrock-AgentCore', 'Invocations', dimensions, sum),
        'Sum'),
      avgDurationMs: statistic(
        metric('AWS/Bedrock-AgentCore', 'Duration', dimensions, avg), 'Average', 'avg'),
    };
  }
  gateway.inboundAuthOk = statistic(
    metric('AWS/Bedrock-AgentCore', 'InboundAuthorizationSuccess',
      [['ResourceId', GATEWAY_ARN]], sum), 'Sum');
  gateway.inboundAuthFail = statistic(
    metric('AWS/Bedrock-AgentCore', 'InboundAuthorizationFailure',
      [['ResourceId', GATEWAY_ARN]], sum), 'Sum');

  return { runtime, memory, gateway };
}

/**
 * DynamoDB consumed capacity. This is what settles the deck's "9 writes per turn".
 *
 * Reported as capacity units, which is the billed unit — and since the table averages
 * 544 B per item (604,471 B / 1,111 items), one write is ~1 WCU, so WCU and write
 * count are directly comparable here. The GSI's writes are included in the table
 * total, which is correct for cost and worth stating on the slide.
 */
function dynamoMetrics(window) {
  const options = { stats: ['Sum'], period: 60, ...window };
  return {
    writeCapacityUnits: statistic(
      metric('AWS/DynamoDB', 'ConsumedWriteCapacityUnits', [['TableName', TABLE]],
        options), 'Sum'),
    readCapacityUnits: statistic(
      metric('AWS/DynamoDB', 'ConsumedReadCapacityUnits', [['TableName', TABLE]],
        options), 'Sum'),
    throttles: statistic(
      metric('AWS/DynamoDB', 'ThrottledRequests', [['TableName', TABLE]], options),
      'Sum'),
  };
}

function lambdaMetrics(window) {
  const sum = { stats: ['Sum'], period: 300, ...window };
  const out = {};
  for (const name of LAMBDAS) {
    out[name] = {
      invocations: statistic(
        metric('AWS/Lambda', 'Invocations', [['FunctionName', name]], sum), 'Sum'),
      errors: statistic(
        metric('AWS/Lambda', 'Errors', [['FunctionName', name]], sum), 'Sum'),
      totalDurationMs: statistic(
        metric('AWS/Lambda', 'Duration', [['FunctionName', name]], sum), 'Sum'),
    };
  }
  return out;
}

// -------------------------------------------------------------------------- main

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  const flags = new Map();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1], match[2] ?? 'true');
  }
  const runPath = flags.get('run');
  const outPath = flags.get('out');
  if (!runPath || !outPath) {
    process.stderr.write('usage: collect.mjs --run runs/engine-a.jsonl --out runs/engine-a-metrics.json\n');
    process.exit(2);
  }

  const run = readRun(runPath);
  const window = run.window;
  process.stdout.write(
    `arm ${run.arm} (${run.expectedEngine})\n` +
    `window ${window.start} .. ${window.end}\n` +
    `${run.turns.length} turns recorded${run.smoke ? '  (SMOKE — not a measurement)' : ''}\n\n`);

  // Latency straight from the driver's frames — no CloudWatch needed.
  const latencies = run.turns
    .map((turn) => turn.replyLatencyMs ?? turn.wallMs)
    .filter((value) => Number.isFinite(value));
  const wall = run.turns.map((turn) => turn.wallMs).filter(Number.isFinite);

  const collected = {
    arm: run.arm,
    engine: run.expectedEngine,
    smoke: run.smoke,
    window,
    tightWindow: run.tight,
    turns: run.turns.length,
    // Billable session shape. Engine A ignores this; engine B's memory-hours are
    // charged on it, which is why it is collected for both arms and compared.
    sessions: run.sessions,
    sessionWallClockSec: run.sessionWallClockSec,
    latencyMs: {
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : null,
      // The driver's own clock. A large gap against replyLatencyMs would mean
      // transport or CloudFront overhead the server never sees.
      wallP50: percentile(wall, 50),
      wallP90: percentile(wall, 90),
    },
    storeReadsPerTurn:
      run.turns.reduce((sum, turn) => sum + (turn.storeReads ?? 0), 0) /
      (run.turns.length || 1),
    failedTurns: run.turns.filter((turn) => turn.ok === false).length,
  };

  process.stdout.write('logs insights: turn counts (contamination check)\n');
  collected.turnCounts = {
    proxy: await turnCount(
      run.arm === 'a' ? LOG_GROUPS.engineA : LOG_GROUPS.engineBProxy, window),
  };

  if (run.arm === 'a') {
    process.stdout.write('logs insights: bedrock.converse by operation\n');
    collected.bedrockConverse = await engineATokens(window);
    process.stdout.write('logs insights: tool loop truncations\n');
    collected.toolLoopTruncated = await toolLoopTruncations(window);
    process.stdout.write('logs insights: per-integration durations\n');
    collected.integrations = await engineATools(window);
  } else {
    process.stdout.write('logs insights: gen_ai token spans\n');
    const spans = await engineBTokensFromSpans(window);
    collected.tokens = spans;
    if (!spans.llmSpans || Number(spans.llmSpans) === 0) {
      process.stdout.write('  no spans matched — falling back to account metrics\n');
      collected.tokensFallback = engineBTokensFromAccountMetrics(window);
    }
    process.stdout.write('cloudwatch: AgentCore runtime / memory / gateway\n');
    Object.assign(collected, agentCoreMetrics(window));
    process.stdout.write('cloudwatch: tool lambdas\n');
    collected.lambdas = lambdaMetrics(window);
  }

  process.stdout.write('cloudwatch: dynamodb consumed capacity\n');
  collected.dynamodb = dynamoMetrics(window);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(collected, null, 2)}\n`);
  process.stdout.write(`\nwrote ${outPath}\n`);

  // A collector that returns null everywhere has wrong dimension names, not zero
  // traffic. Say so loudly rather than letting it look like a clean result.
  const nulls = JSON.stringify(collected).match(/:null/g)?.length ?? 0;
  if (nulls > 12) {
    process.stdout.write(
      `\nWARNING: ${nulls} null values. Check dimension names and the window before ` +
      'trusting this — an all-null result is the known signature of wrong dimensions.\n');
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
