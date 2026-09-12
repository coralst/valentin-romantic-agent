import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The arithmetic behind `public/engine-comparison.html`.
 *
 * Every rate below is quoted from a vendor pricing page and every quantity is counted from this
 * repo — the two ASSUMPTION-marked constants are the exceptions and are labelled as such on the
 * page too. This file exists so the page's numbers can be re-derived rather than trusted: run
 * `node scripts/cost-model.mjs` and every figure on the page should fall out.
 *
 * It is deliberately not a unit test. It is the audit trail for a slide.
 *
 *   node scripts/cost-model.mjs                     the analytic model (unchanged output)
 *   node scripts/cost-model.mjs --from-measured runs/
 *                                                   substitutes measured quantities and writes
 *                                                   runs/results.json for build-results-slide.py
 *
 * Four numbers here were wrong until 2026-09-12, each in engine B's favour. They are kept
 * beside their corrections rather than overwritten, because the published page quotes the old
 * ones and the before/after delta is itself a finding:
 *
 *   - engine B's always-on proxy Fargate task was uncounted entirely (B_PROXY_TASKS)
 *   - TOOLS_INDEXED was 3; the Gateway has 29 registered
 *   - SEC_PER_TURN = 3 was a guess; the meter bills on session wall clock, 182-1,449 s observed
 *   - Lambda, NAT, interface endpoints and Logs had no line items at all
 */

// ---- Sourced unit rates -----------------------------------------------------------------
// AWS Fargate pricing page, from its own per-second worked example ($0.000011244/vCPU-s).
const FARGATE_VCPU_HR = 0.04048;
const FARGATE_GB_HR = 0.004446;

// Bedrock AgentCore pricing page, microVM compute type. Billed per second, 1s minimum.
const AC_VCPU_HR = 0.0895;
const AC_GB_HR = 0.00945;

// Bedrock AgentCore pricing page, AgentCore Memory.
const AC_EVENT = 0.25 / 1000; // per new event
const AC_RETRIEVAL = 0.5 / 1000; // per retrieval — see the sensitivity note at the bottom
const AC_RECORD_MO = 0.75 / 1000; // per long-term record per month, built-in strategy

// Bedrock AgentCore pricing page, AgentCore Gateway.
const AC_GATEWAY_INVOKE = 0.005 / 1000; // per API invocation (ListTools, InvokeTool, Ping)
const AC_TOOL_INDEX_MO = 0.02 / 100; // per tool indexed per month

// DynamoDB on-demand pricing page, us-east-1 standard table class.
const DDB_WRU = 0.625 / 1e6; // 1 WRU per 1 KB
const DDB_RRU = 0.125 / 1e6; // 0.5 RRU per 4 KB, eventually consistent

// ASSUMPTION — Bedrock's Anthropic table is JS-rendered and did not load. Every dependent
// figure scales linearly with these two numbers.
const SONNET_IN = 3 / 1e6;
const SONNET_OUT = 15 / 1e6;

// ---- Line items the model used to omit -------------------------------------------------
// These were admitted as missing and always understated engine B. Named and priced now, so
// the exclusion list on the slide is a choice rather than an oversight.

// AWS Lambda pricing page, us-east-1, x86. Behind engine B's Gateway only.
const LAMBDA_REQUEST = 0.2 / 1e6;
const LAMBDA_GB_SEC = 0.0000166667;
// infra/lib/agentcore-stack.ts:160 / :254
const LAMBDA_MB = { 'valentin-profile-tools-dev': 256, 'valentin-integration-tools-dev': 512 };

// VPC pricing page. Charged to BOTH engines and identical for both — the VPC is shared, so
// this cancels in any A-vs-B comparison and only matters to the absolute total.
const NAT_HR = 0.045;
const NAT_GB = 0.045;
const NAT_GATEWAYS = 1; // infra/lib/network-stack.ts:22 — dev is 1, prod would be 2
// network-stack.ts:47-55: BEDROCK_RUNTIME + CLOUDWATCH_LOGS interface endpoints, maxAzs 2.
// The S3 and DynamoDB endpoints are Gateway type and cost nothing.
const ENDPOINT_ENI_HR = 0.01;
const ENDPOINT_ENIS = 2 * 2; // 2 endpoints x 2 AZs
const ENDPOINT_GB = 0.01;

// CloudWatch Logs pricing page, standard class.
const LOGS_INGEST_GB = 0.5;
const LOGS_STORE_GB_MO = 0.03;

// ---- Counted quantities -----------------------------------------------------------------
const VCPU = 0.5; // infra/config/environments.ts: dev cpu 512
const GIB = 1; //                                    memoryLimitMiB 1024
const HOURS = 730; // a month of an always-on task
/**
 * ASSUMPTION, and a badly wrong one. Superseded by `--from-measured`.
 *
 * The AgentCore Runtime meters memory-hours on **session wall clock**, not on time spent
 * computing — `runtimeSessionIdFor()` passes the app session UUID straight through, so the
 * microVM stays billable for the whole conversation including the user's think time. Observed
 * 182-1,449 billed seconds per invoke against the 3 s guessed here, up to ~480x.
 *
 * Kept so the unmeasured model still runs and the delta is visible on one screen.
 */
const SEC_PER_TURN = 3;

// dynamodb-store.ts, typical turn: 6 Query + 1 GetItem reads; 2 Put + 1 BatchWrite + 3 Update
// writes, of which 3 replicate into the ALL-projected sparse GSI1.
const DDB_READS = 7;
const DDB_WRITE_UNITS = 9;

// bedrock-client.ts:594 — the extraction call sends the full untrimmed history plus a
// 7,519-char tool schema and sets no maxTokens at all.
const EXTRACT_IN_TOKENS = 2940;
const EXTRACT_OUT_TOKENS = 300;

const PROFILE_RECORDS = 26; // the 26 profile fields in PROFILE_FIELD_IDS
const MAX_MEMORY_RECORDS = 100; // agentcore-adapter.ts:138

// agentcore/agent.py:190 calls gateway.list_tools_sync() once per invoke, then the model chooses
// how many tools to call. Two Gateway API invocations per turn is the conservative floor: one
// ListTools plus one InvokeTool.
const GATEWAY_INVOKES_PER_TURN = 2;

// CORRECTED 2026-09-12. The published page says 3 — the three profile tools — but the Gateway
// meters every tool it has *indexed*, and `aws bedrock-agentcore-control list-gateway-targets`
// returns 29: 3 profile tools plus 26 integration tools. ~10x the claim.
const TOOLS_INDEXED_AS_PUBLISHED = 3;
const TOOLS_INDEXED = 29;

// CORRECTED 2026-09-12. Engine B does not replace the Fargate task, it ADDS one: the
// `valentin-ac-proxy-dev` service terminates the WebSocket, holds the session and calls
// InvokeAgentRuntime, and it is always-on at the same 512/1024 sizing as engine A's task
// (compute-stack.ts:720-721). The model previously counted zero Fargate for engine B, which
// is the single largest error in it — at one user this line is ~86% of the bill.
const B_PROXY_TASKS = 1;

// ---- Layer 1: compute -------------------------------------------------------------------
export const fargatePerHour = VCPU * FARGATE_VCPU_HR + GIB * FARGATE_GB_HR;
export const fargatePerMonth = fargatePerHour * HOURS;

export const runtimePerSecond = VCPU * (AC_VCPU_HR / 3600) + GIB * (AC_GB_HR / 3600);
export const runtimePerHour = runtimePerSecond * 3600;
export const runtimePerTurn = runtimePerSecond * SEC_PER_TURN;
export const unitPriceRatio = runtimePerHour / fargatePerHour;

// ---- Layer 2: memory store --------------------------------------------------------------
export const dynamoPerTurn = DDB_READS * 0.5 * DDB_RRU + DDB_WRITE_UNITS * DDB_WRU;
export const memoryPerTurn = AC_EVENT + AC_RETRIEVAL;
export const memoryStoragePerMonth = PROFILE_RECORDS * AC_RECORD_MO;

// ---- Layer 3: Bedrock, the part that differs --------------------------------------------
// Engine A pays for a second forced-tool Converse on every turn. Engine B's equivalent work
// happens inside Memory's built-in strategy rate (ASSUMPTION 4 on the page).
export const extractionPerTurn = EXTRACT_IN_TOKENS * SONNET_IN + EXTRACT_OUT_TOKENS * SONNET_OUT;

// ---- Layer 4: tool execution -------------------------------------------------------------
// Engine A runs tools in-process inside the Fargate task already paid for above, so its
// marginal cost here is zero. Engine B routes them through AgentCore Gateway to a Lambda.
export const gatewayPerTurn = GATEWAY_INVOKES_PER_TURN * AC_GATEWAY_INVOKE;
export const toolIndexPerMonth = TOOLS_INDEXED * AC_TOOL_INDEX_MO;
// NOT COUNTED, and it counts against engine B: the Lambda behind the Gateway bills requests and
// GB-seconds of its own. Left out because Lambda's rates were not sourced for this model, so it
// is an understatement of engine B's cost rather than an overstatement of its advantage.

// ---- Totals ------------------------------------------------------------------------------
export const A_FIXED = fargatePerMonth;
export const A_VAR = dynamoPerTurn + extractionPerTurn;
// B_PROXY_TASKS * fargatePerMonth is the correction: engine B's proxy is a whole extra
// always-on task, not a rounding error.
export const B_FIXED =
  memoryStoragePerMonth + toolIndexPerMonth + B_PROXY_TASKS * fargatePerMonth;
export const B_VAR = runtimePerTurn + memoryPerTurn + gatewayPerTurn;

export const totalA = (n) => A_FIXED + n * A_VAR;
export const totalB = (n) => B_FIXED + n * B_VAR;

export const TRAFFIC = [500, 5000, 50000, 500000];
export const utilisationPct = ((500 * SEC_PER_TURN) / 3600 / HOURS) * 100;

// ---- Sensitivity: what if a "retrieval" meters per record, not per call? -----------------
export const memoryPerTurnPerRecord = AC_EVENT + MAX_MEMORY_RECORDS * AC_RETRIEVAL;
export const B_VAR_PER_RECORD = runtimePerTurn + memoryPerTurnPerRecord;

function main() {
  const usd = (v, dp = 2) => '$' + v.toFixed(dp);
  console.log('LAYER 1  compute');
  console.log('  Fargate   ', usd(fargatePerHour, 6), '/hr  →', usd(fargatePerMonth), '/mo  FIXED');
  console.log('  Runtime   ', runtimePerSecond.toExponential(4), '/s  →', usd(runtimePerHour, 5), '/hr');
  console.log('  unit price ratio', unitPriceRatio.toFixed(2) + '×  (AgentCore is DEARER per hour)');
  console.log('  Runtime /turn @' + SEC_PER_TURN + 's', usd(runtimePerTurn, 7));

  console.log('LAYER 2  memory store');
  console.log('  DynamoDB  /turn', usd(dynamoPerTurn, 8));
  console.log('  AC Memory /turn', usd(memoryPerTurn, 6), ' storage', usd(memoryStoragePerMonth, 4), '/mo');
  console.log('  ratio', (memoryPerTurn / dynamoPerTurn).toFixed(0) + '×  (DynamoDB is CHEAPER)');

  console.log('LAYER 3  Bedrock delta  (→ AgentCore Memory)');
  console.log('  A extraction /turn', usd(extractionPerTurn, 6));
  console.log('  B extraction /turn  $0 (inside the AgentCore Memory rate)');

  console.log('LAYER 4  tool execution  (→ AgentCore Gateway)');
  console.log('  A in-process /turn  $0 (inside the Fargate task above)');
  console.log('  B Gateway /turn', usd(gatewayPerTurn, 7),
    ' tool indexing', usd(toolIndexPerMonth, 4), '/mo');

  console.log('\nA =', usd(A_FIXED), '+ n ×', usd(A_VAR, 6));
  console.log('B =', usd(B_FIXED, 4), '+ n ×', usd(B_VAR, 7));
  console.log('asymptotic ratio', (A_VAR / B_VAR).toFixed(1) + '×');

  console.log('\n turns/mo    engine A    engine B   ratio');
  for (const n of TRAFFIC) {
    const a = totalA(n);
    const b = totalB(n);
    console.log(
      String(n).padStart(8),
      usd(a).padStart(11),
      usd(b).padStart(11),
      (a / b).toFixed(1) + '×',
    );
  }

  console.log('\nutilisation @500 turns:', utilisationPct.toFixed(3) + '%');
  console.log('SENSITIVITY  retrieval per record (' + MAX_MEMORY_RECORDS + '):');
  console.log('  B /turn', usd(B_VAR_PER_RECORD, 5), 'vs A /turn', usd(A_VAR, 5),
    '→', (B_VAR_PER_RECORD / A_VAR).toFixed(1) + '× WORSE');
  console.log('  B @500 turns', usd(B_FIXED + 500 * B_VAR_PER_RECORD));
}


// ============================================================================================
// Usage model, stated explicitly because every figure above depends on it.
//
// The point of writing these down rather than picking a round number: "500 turns/month" reads
// like a deployment-wide figure, but the 26-record storage line is ONE partner profile. Mixing
// per-deployment, per-turn and per-user quantities in one column is how a cost model quietly
// becomes wrong.
// ============================================================================================

/** What one engaged user of a romantic assistant plausibly does. */
export const USAGE = {
  sessionsPerUserPerWeek: 3, // opens the app about every other evening
  turnsPerSession: 8, // a real conversation about a partner, not a one-shot query
  get turnsPerUserPerMonth() {
    return Math.round((this.sessionsPerUserPerWeek * 52 / 12) * this.turnsPerSession);
  },
  /** Share of turns falling in the 19:00–23:00 window. It is a date-planning assistant. */
  eveningShare: 0.7,
  peakHoursPerDay: 4,
  /** Turns that actually reach for a tool (a restaurant search, a calendar check). */
  toolCallShare: 0.4,
  /** AgentCore Gateway also does one ListTools per invoke, so this is 1 + toolCallShare. */
  get gatewayInvokesPerTurn() {
    return 1 + this.toolCallShare;
  },
  /** One AgentCore Memory record per profile field. */
  memoryRecordsPerUser: 26,
  /** Rough DynamoDB footprint of one user's messages + preferences. */
  dynamoGbPerUser: 0.00005,
};

const TPU = USAGE.turnsPerUserPerMonth;

// Per-turn, both engines (the reply Converse is identical and excluded from both).
export const perTurnA = dynamoPerTurn + extractionPerTurn;
export const perTurnB =
  runtimePerTurn + memoryPerTurn + USAGE.gatewayInvokesPerTurn * AC_GATEWAY_INVOKE;

// Per-user-per-month, independent of how much they talk.
export const perUserA = USAGE.dynamoGbPerUser * (0.25 + 0.2); // storage + PITR
export const perUserB = USAGE.memoryRecordsPerUser * AC_RECORD_MO;

// Fixed: paid at zero usage, shared by every user.
export const fixedA = fargatePerMonth;
// Engine B pays engine A's rent PLUS the tool index: the proxy task is always-on.
export const fixedB = toolIndexPerMonth + B_PROXY_TASKS * fargatePerMonth;

export const monthlyA = (users) => fixedA + users * (perUserA + TPU * perTurnA);
export const monthlyB = (users) => fixedB + users * (perUserB + TPU * perTurnB);

function usageReport() {
  const usd = (v, dp = 2) => '$' + v.toFixed(dp);
  console.log('\n════ USAGE MODEL ════');
  console.log('  turns/user/month', TPU, `(${USAGE.sessionsPerUserPerWeek}/wk × ${USAGE.turnsPerSession})`);
  console.log('  Gateway invokes/turn', USAGE.gatewayInvokesPerTurn.toFixed(1));
  console.log('\n  FIXED (zero usage)   A', usd(fixedA), '  B', usd(fixedB, 4));
  console.log('  PER USER / month     A', usd(perUserA, 6), '  B', usd(perUserB, 4));
  console.log('  PER TURN             A', usd(perTurnA, 6), '  B', usd(perTurnB, 7),
    ' →', (perTurnA / perTurnB).toFixed(1) + '× gap');

  console.log('\n users        glue    agentcore   ratio      saved/mo');
  for (const u of [1, 10, 100, 1000, 10000]) {
    const a = monthlyA(u);
    const b = monthlyB(u);
    console.log(
      String(u).padStart(6),
      usd(a).padStart(11),
      usd(b).padStart(11),
      ((a / b).toFixed(1) + '×').padStart(7),
      usd(a - b).padStart(12),
    );
  }
  const bigA = monthlyA(1e6);
  const bigB = monthlyB(1e6);
  console.log('  asymptotic ratio', (bigA / bigB).toFixed(1) + '×');
}


// ============================================================================================
// Scale: at 100k and 1M users, one Fargate task is no longer enough.
//
// Below ~10k users the concurrency fits in a single 0.5 vCPU task, so engine A's compute stays
// flat at $18.02 and simply amortises. Above that it has to step, and each step is another whole
// task — whereas AgentCore Runtime has no steps at all. Modelling this matters: leaving Fargate
// at one task for a million users would understate engine A.
// ============================================================================================

/** Concurrent WebSocket sessions one task is assumed to carry. ASSUMPTION. */
export const SESSIONS_PER_TASK = 500;
/** Wall-clock length of a session: 8 turns of conversation. ASSUMPTION. */
export const SESSION_MINUTES = 12;

const SESSIONS_PER_USER_MONTH = (USAGE.sessionsPerUserPerWeek * 52) / 12;
const PEAK_HOURS_PER_MONTH = USAGE.peakHoursPerDay * 30;

/** Peak concurrent sessions at a given user count. */
export function peakConcurrency(users) {
  const sessionsPerPeakHour =
    (USAGE.eveningShare * users * SESSIONS_PER_USER_MONTH) / PEAK_HOURS_PER_MONTH;
  return sessionsPerPeakHour * (SESSION_MINUTES / 60);
}

/** Fargate tasks needed to carry that peak — the step function engine A pays in. */
export function fargateTasks(users) {
  return Math.max(1, Math.ceil(peakConcurrency(users) / SESSIONS_PER_TASK));
}

export const scaledA = (users) =>
  fargateTasks(users) * fargatePerMonth + users * (perUserA + TPU * perTurnA);
/**
 * Engine B steps on the SAME curve as engine A, not on a flat line.
 *
 * The old model had engine B's compute independent of user count, which is where its
 * asymptotic advantage came from. But the proxy terminates the WebSocket and holds the session
 * for the whole conversation exactly as engine A's task does, so it needs the same number of
 * tasks for the same peak concurrency. What engine B actually buys is not "no containers" —
 * it is "the same containers, plus a Runtime bill, minus the model call".
 */
export const scaledB = (users) =>
  toolIndexPerMonth +
  B_PROXY_TASKS * fargateTasks(users) * fargatePerMonth +
  users * (perUserB + TPU * perTurnB);

function scaleReport() {
  const usd = (v) =>
    '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log('\n════ SCALE (Fargate steps with peak concurrency) ════');
  console.log('   users  tasks   peak    glue code       agentcore     ratio       saved/mo');
  for (const u of [1, 10, 100, 1000, 10000, 100000, 1000000]) {
    const a = scaledA(u);
    const b = scaledB(u);
    console.log(
      String(u).padStart(8),
      String(fargateTasks(u)).padStart(5),
      peakConcurrency(u).toFixed(0).padStart(7),
      usd(a).padStart(15),
      usd(b).padStart(14),
      ((a / b).toFixed(1) + '×').padStart(8),
      usd(a - b).padStart(15),
    );
  }
  console.log('  1M users, per year saved:', usd((scaledA(1e6) - scaledB(1e6)) * 12));
}

// ============================================================================================
// MEASURED MODE — `--from-measured runs/`
//
// Substitutes the quantities `scripts/experiment/collect.mjs` measured for the ones counted
// from code above, and writes `runs/results.json` in the exact shape
// `scripts/build-results-slide.py --from` consumes. The rate table is untouched: only the
// quantities change, which is what makes the before/after delta attributable to measurement
// rather than to a repricing.
//
// The usage-billed / time-billed split is enforced here and is the whole point:
//   - usage-billed items are taken from the 120-turn run with NO extrapolation
//   - time-billed items (Fargate, NAT, endpoints) are analytic at 730 h/month, because they
//     cost the same at 1 turn as at 120 and scaling them from a ~40-minute window would be
//     arithmetic dressed up as measurement
// ============================================================================================

/**
 * Fargate tasks attributed to each engine.
 *
 * Engine B is 2 because, as deployed, it is an ADDITION to engine A rather than a replacement:
 * the ALB routes `/api/*` to `valentin-service-dev` and only `/ws/agentcore` to
 * `valentin-ac-proxy-dev`, so both tasks are always-on for engine B to answer a turn. A
 * standalone engine-B deployment would serve HTTP from the proxy image and need 1 — that
 * variant is printed alongside, because which number is fair depends on a claim about the
 * architecture and the reader should see both.
 */
const FARGATE_TASKS = { a: 1, b: 2 };
const FARGATE_TASKS_B_STANDALONE = 1;

/**
 * Charged to both engines identically, so it cancels in the comparison. Named, not hidden.
 *
 * Only the hourly rent is priced. The per-GB legs (NAT $0.045/GB, endpoint $0.01/GB, Logs
 * $0.50/GB ingested) need a byte count nobody measured — `dataTransferPerMonth` prices them
 * from a GB figure, and is left at zero rather than guessed, because at this traffic the rent
 * dominates the transfer by orders of magnitude and a made-up GB number would be the only
 * unsourced input in the file.
 */
export const sharedNetworkPerMonth =
  NAT_GATEWAYS * NAT_HR * HOURS + ENDPOINT_ENIS * ENDPOINT_ENI_HR * HOURS;

/** Prices the per-GB legs once someone measures the bytes. Not called by default. */
export const dataTransferPerMonth = ({ natGb = 0, endpointGb = 0, logsGb = 0 }) =>
  natGb * NAT_GB +
  endpointGb * ENDPOINT_GB +
  logsGb * LOGS_INGEST_GB +
  logsGb * LOGS_STORE_GB_MO;

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Logs Insights returns every field as a string. */
const field = (rows, name, fallback = 0) => {
  if (!Array.isArray(rows)) return fallback;
  const total = rows.reduce((sum, row) => sum + Number(row[name] ?? 0), 0);
  return Number.isFinite(total) ? total : fallback;
};

function measuredEngineA(metrics, gaps) {
  const rows = Array.isArray(metrics.bedrockConverse) ? metrics.bedrockConverse : [];
  if (rows.length === 0) gaps.push('engine A: no bedrock.converse rows — token cost is $0');

  // `inTokens`/`outTokens` are the collector's aliases; the un-prefixed names would shadow
  // the source JSON fields in the Logs Insights `stats` and come back null. The old names
  // are still read so metrics files collected before 2026-09-12 still price.
  const inputTokens = field(rows, 'inTokens') || field(rows, 'inputTokens');
  const outputTokens = field(rows, 'outTokens') || field(rows, 'outputTokens');
  const calls = field(rows, 'calls');
  if (rows.length > 0 && inputTokens === 0) {
    gaps.push(
      'engine A: bedrock.converse rows carry no token columns — the stats aliases are ' +
        'shadowing the source fields again. Do not report this as a zero token bill.',
    );
  }

  const wcu = num(metrics.dynamodb?.writeCapacityUnits);
  const rcu = num(metrics.dynamodb?.readCapacityUnits);
  if (wcu === null || rcu === null) gaps.push('engine A: DynamoDB capacity metrics missing');

  return {
    cost: {
      'Bedrock tokens': inputTokens * SONNET_IN + outputTokens * SONNET_OUT,
      DynamoDB: (wcu ?? 0) * DDB_WRU + (rcu ?? 0) * DDB_RRU,
      [`Fargate (${FARGATE_TASKS.a} task, ${HOURS} h)`]: FARGATE_TASKS.a * fargatePerMonth,
    },
    tokens: { in: inputTokens, out: outputTokens, calls_per_turn: calls / metrics.turns },
    // Per-operation split, so the slide can price the extract-preferences call the deck
    // guessed at 2,940 in / 300 out.
    byOperation: rows.map((row) => {
      const rowIn = Number(row.inTokens ?? row.inputTokens ?? 0);
      const rowOut = Number(row.outTokens ?? row.outputTokens ?? 0);
      const rowCalls = Math.max(1, Number(row.calls ?? 0));
      return {
        operation: row.operation,
        calls: Number(row.calls ?? 0),
        inputTokens: rowIn,
        outputTokens: rowOut,
        inputPerCall: rowIn / rowCalls,
        outputPerCall: rowOut / rowCalls,
        // The tail is the finding: engine A's loop is capped at 5, engine B's is not.
        maxInputTokens: num(row.maxInTokens),
      };
    }),
    truncations: field(metrics.toolLoopTruncated, 'truncated'),
  };
}

function measuredEngineB(metrics, gaps) {
  // Spans first, window subtraction second — the fallback the run was designed to allow.
  const spans = metrics.tokens ?? {};
  const fallback = metrics.tokensFallback;
  let inputTokens = Number(spans.inputTokens ?? 0);
  let outputTokens = Number(spans.outputTokens ?? 0);
  let tokenSource = 'GenAI Observability spans';

  if (!(inputTokens > 0) && fallback) {
    inputTokens = num(fallback.inputTokens) ?? 0;
    outputTokens = num(fallback.outputTokens) ?? 0;
    tokenSource = 'account-level AWS/Bedrock, disjoint-window subtraction';
    gaps.push(
      'engine B: no LLM spans — tokens come from the account-level window subtraction, ' +
        'valid only because the arms ran sequentially in verified-quiet windows',
    );
  }
  if (!(inputTokens > 0)) gaps.push('engine B: NO token measurement from either path');

  const memory = metrics.memory ?? {};
  const events = num(memory.CreateEvent?.invocations) ?? 0;
  const retrievals =
    (num(memory.RetrieveMemoryRecords?.invocations) ?? 0) +
    (num(memory.ListMemoryRecords?.invocations) ?? 0);
  const records = num(memory.created_MemoryRecordsExtracted) ?? 0;
  // Memory's own extraction tokens are billed inside the per-event rate, so they are reported
  // for the fair comparison against engine A's extraction Converse, not added to the bill.
  const extractionTokens = {
    in:
      (num(memory.Extraction?.inputTokens) ?? 0) + (num(memory.Consolidation?.inputTokens) ?? 0),
    out:
      (num(memory.Extraction?.outputTokens) ?? 0) +
      (num(memory.Consolidation?.outputTokens) ?? 0),
  };

  // collect.mjs now nests these under `compute` and tries three dimension sets; the flat
  // keys are the pre-2026-09-12 shape and are still read so old metrics files still price.
  const compute = metrics.runtime?.compute ?? {};
  const vcpuHours = num(compute.vcpuHours) ?? num(metrics.runtime?.vcpuHours);
  let gbHours = num(compute.gbHours) ?? num(metrics.runtime?.gbHours);
  const sessions = num(metrics.runtime?.sessions) ?? (metrics.sessions?.length ?? null);
  let gbHoursSource = 'meter';

  if (gbHours === null) {
    // Not a dimension bug — verified on 2026-09-12 that these billing meters publish days
    // late (newest datapoint then was 2026-09-08, for traffic minutes old). So the run-day
    // figure uses the rate the meter itself published on the one day it did report:
    // 1.5702 GB-h across 2 Sessions = 0.785 GB-h per conversation. Labelled a proxy, and
    // superseded by re-running collect.mjs over the same window once the meter catches up.
    gbHoursSource = 'proxy: 0.785 GB-h/session, observed 2026-09-08 (1.5702 GB-h / 2 sessions)';
    gbHours = sessions === null ? null : sessions * 0.785;
    gaps.push(
      'engine B: Runtime GB-hour meter had not published for this window — priced at the ' +
        '0.785 GB-h/session rate the meter reported on 2026-09-08. Re-run collect.mjs in a ' +
        'few days and re-price for the authoritative number.',
    );
  }
  if (vcpuHours === null) {
    gaps.push(
      'engine B: Runtime vCPU-hour meter had not published for this window; its share of ' +
        'the bill is counted as 0 and is therefore a floor.',
    );
  }

  const gatewayCalls = Object.values(metrics.gateway?.byMethod ?? {}).reduce(
    (sum, entry) => sum + (num(entry.calls) ?? 0),
    0,
  );

  let lambdaCost = 0;
  for (const [name, entry] of Object.entries(metrics.lambdas ?? {})) {
    const gbSeconds =
      ((num(entry.totalDurationMs) ?? 0) / 1000) * ((LAMBDA_MB[name] ?? 512) / 1024);
    lambdaCost += (num(entry.invocations) ?? 0) * LAMBDA_REQUEST + gbSeconds * LAMBDA_GB_SEC;
  }

  const wcu = num(metrics.dynamodb?.writeCapacityUnits);
  const rcu = num(metrics.dynamodb?.readCapacityUnits);

  return {
    cost: {
      'Bedrock tokens': inputTokens * SONNET_IN + outputTokens * SONNET_OUT,
      'AgentCore Memory': events * AC_EVENT + retrievals * AC_RETRIEVAL + records * AC_RECORD_MO,
      'AgentCore Runtime': (vcpuHours ?? 0) * AC_VCPU_HR + (gbHours ?? 0) * AC_GB_HR,
      'AgentCore Gateway': gatewayCalls * AC_GATEWAY_INVOKE + TOOLS_INDEXED * AC_TOOL_INDEX_MO,
      'Tool Lambdas': lambdaCost,
      DynamoDB: (wcu ?? 0) * DDB_WRU + (rcu ?? 0) * DDB_RRU,
      [`Fargate (${FARGATE_TASKS.b} tasks, ${HOURS} h)`]: FARGATE_TASKS.b * fargatePerMonth,
    },
    tokens: {
      in: inputTokens,
      out: outputTokens,
      // Structurally 0 in the logs (`recordModelCall` is never reached on engine B), so this
      // is the span count or nothing. Never report the log figure here.
      calls_per_turn: Number(spans.llmSpans ?? 0) / metrics.turns || null,
    },
    tokenSource,
    memory: { events, retrievals, records, extractionTokens },
    runtime: {
      invocations: num(metrics.runtime?.invocations),
      sessions,
      vcpuHours,
      gbHours,
      gbHoursSource,
      // Per CONVERSATION, not per turn: the meter bills memory on session wall clock, and
      // one conversation is one runtimeSessionId is one microVM.
      gbHoursPerConversation:
        gbHours === null || !sessions ? null : gbHours / sessions,
      sessionWallClockSec: num(metrics.sessionWallClockSec),
    },
    gatewayCalls,
    gatewayPerTurnMs: num(metrics.gateway?.byMethod?.['tools/call']?.avgDurationMs),
  };
}

function buildCorrections(a, b, metricsA, metricsB) {
  const wcuPerTurn = (num(metricsA.dynamodb?.writeCapacityUnits) ?? 0) / metricsA.turns;
  const gbPerConversation = b.runtime.gbHoursPerConversation;
  const secPerConversation = gbPerConversation === null ? null : gbPerConversation * 3600;

  const fmt = (value, unit, dp = 0) =>
    value === null || value === undefined ? 'not measured' : `${value.toFixed(dp)}${unit}`;

  return [
    // [label, what slide 6 claimed, what we measured, was slide 6 right]
    [
      'Turn latency A / B',
      '~2.1 s / ~2.4 s',
      `${(metricsA.latencyMs.p50 / 1000).toFixed(1)} s / ` +
        `${(metricsB.latencyMs.p50 / 1000).toFixed(1)} s`,
      false,
    ],
    ['Always-on tasks (B)', 'none', `${FARGATE_TASKS.b} Fargate tasks`, false],
    ['Tools indexed', String(TOOLS_INDEXED_AS_PUBLISHED), String(TOOLS_INDEXED), false],
    [
      'Runtime per conversation',
      `${SEC_PER_TURN} s/turn assumed`,
      fmt(secPerConversation, ' s billed'),
      false,
    ],
    ['Writes per turn', String(DDB_WRITE_UNITS), `${wcuPerTurn.toFixed(1)} WCU`, false],
    ['Gateway overhead', '~300 ms', fmt(b.gatewayPerTurnMs, ' ms'), true],
  ];
}

function fromMeasured(directory) {
  const read = (name) => JSON.parse(readFileSync(`${directory}/${name}`, 'utf8'));
  const metricsA = read('engine-a-metrics.json');
  const metricsB = read('engine-b-metrics.json');

  const gaps = [];
  const a = measuredEngineA(metricsA, gaps);
  const b = measuredEngineB(metricsB, gaps);

  // A smoke file is shaped exactly like a real one. Refuse rather than warn: the failure mode
  // is a slide that reads as a month's bill and is actually four turns.
  if (metricsA.smoke || metricsB.smoke) {
    console.error(
      'refusing to price a smoke run as a month — rerun the full 12x10 corpus.\n' +
        `  engine A smoke: ${Boolean(metricsA.smoke)} (${metricsA.turns} turns)\n` +
        `  engine B smoke: ${Boolean(metricsB.smoke)} (${metricsB.turns} turns)`,
    );
    process.exit(3);
  }

  if (metricsA.turns !== metricsB.turns) {
    gaps.push(
      `arms are not comparable: ${metricsA.turns} turns on A vs ${metricsB.turns} on B`,
    );
  }

  const corrections = buildCorrections(a, b, metricsA, metricsB);
  const results = {
    dummy: false,
    generatedAt: new Date().toISOString(),
    turns: metricsA.turns,
    conversations: 12,
    windows: { a: metricsA.tightWindow, b: metricsB.tightWindow },
    cost: { a: a.cost, b: b.cost },
    latency: { a: metricsA.latencyMs, b: metricsB.latencyMs },
    tokens: { a: a.tokens, b: b.tokens },
    corrections,
    detail: {
      engineATokensByOperation: a.byOperation,
      engineAToolLoopTruncations: a.truncations,
      engineBTokenSource: b.tokenSource,
      engineBMemory: b.memory,
      engineBRuntime: b.runtime,
      engineBGatewayCalls: b.gatewayCalls,
      storeReadsPerTurn: { a: metricsA.storeReadsPerTurn, b: metricsB.storeReadsPerTurn },
      failedTurns: { a: metricsA.failedTurns, b: metricsB.failedTurns },
    },
    excluded: {
      note:
        'Charged to both engines identically, so it cancels in the comparison — stated rather ' +
        'than silently dropped.',
      sharedNetworkPerMonth,
      alsoExcluded: ['ALB', 'CloudFront', 'S3', 'Secrets Manager', 'CloudWatch Logs ingestion'],
      fargateTasksBStandalone: FARGATE_TASKS_B_STANDALONE * fargatePerMonth,
    },
    gaps,
  };

  writeFileSync(`${directory}/results.json`, `${JSON.stringify(results, null, 2)}\n`);

  const usd = (v, dp = 4) => '$' + v.toFixed(dp);
  const totalA = Object.values(a.cost).reduce((sum, v) => sum + v, 0);
  const totalB = Object.values(b.cost).reduce((sum, v) => sum + v, 0);
  console.log('\n════ MEASURED (120 turns/user/month, no extrapolation) ════');
  for (const [label, value] of Object.entries(a.cost)) {
    console.log('  A', label.padEnd(26), usd(value));
  }
  console.log('  A', 'TOTAL'.padEnd(26), usd(totalA, 2));
  for (const [label, value] of Object.entries(b.cost)) {
    console.log('  B', label.padEnd(26), usd(value));
  }
  console.log('  B', 'TOTAL'.padEnd(26), usd(totalB, 2));
  console.log('\n  wrote', `${directory}/results.json`);
  if (gaps.length) {
    console.log('\n  GAPS — every one of these must be stated on the slide:');
    for (const gap of gaps) console.log('   -', gap);
  }
}

// The three analytic reports print on a bare invocation and are suppressed in measured mode,
// so `--from-measured` output is machine-readable rather than buried under three tables.
const measuredArg = process.argv.indexOf('--from-measured');
if (measuredArg >= 0) {
  const directory = process.argv[measuredArg + 1];
  if (!directory) {
    console.error('usage: node scripts/cost-model.mjs --from-measured runs/');
    process.exit(2);
  }
  fromMeasured(directory.replace(/\/+$/, ''));
} else {
  main();
  usageReport();
  scaleReport();
}
