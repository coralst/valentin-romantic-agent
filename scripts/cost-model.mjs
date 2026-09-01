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

// Bedrock AgentCore pricing page, Memory.
const AC_EVENT = 0.25 / 1000; // per new event
const AC_RETRIEVAL = 0.5 / 1000; // per retrieval — see the sensitivity note at the bottom
const AC_RECORD_MO = 0.75 / 1000; // per long-term record per month, built-in strategy

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

// ---- Totals ------------------------------------------------------------------------------
export const A_FIXED = fargatePerMonth;
export const A_VAR = dynamoPerTurn + extractionPerTurn;
export const B_FIXED = memoryStoragePerMonth;
export const B_VAR = runtimePerTurn + memoryPerTurn;

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

  console.log('LAYER 3  Bedrock delta');
  console.log('  A extraction /turn', usd(extractionPerTurn, 6));
  console.log('  B extraction /turn  $0 (inside Memory rate)');

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
