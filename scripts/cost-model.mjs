/**
 * The arithmetic behind `public/engine-comparison.html`.
 *
 * Every rate below is quoted from a vendor pricing page and every quantity is counted from this
 * repo — the two ASSUMPTION-marked constants are the exceptions and are labelled as such on the
 * page too. This file exists so the page's numbers can be re-derived rather than trusted: run
 * `node scripts/cost-model.mjs` and every figure on the page should fall out.
 *
 * It is deliberately not a unit test. It is the audit trail for a slide.
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

// ---- Counted quantities -----------------------------------------------------------------
const VCPU = 0.5; // infra/config/environments.ts: dev cpu 512
const GIB = 1; //                                    memoryLimitMiB 1024
const HOURS = 730; // a month of an always-on task
const SEC_PER_TURN = 3; // ASSUMPTION — no measurement exists; all repo durations are authored

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
const TOOLS_INDEXED = 3; // get_partner_profile, save_preference, list_preferences

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
export const B_FIXED = memoryStoragePerMonth + toolIndexPerMonth;
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

main();

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
export const fixedB = toolIndexPerMonth;

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

usageReport();

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
export const scaledB = (users) => fixedB + users * (perUserB + TPU * perTurnB);

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

scaleReport();
