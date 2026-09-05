/**
 * Run the live bug-hunt corpus.
 *
 *   AWS_PROFILE=dev-devops-agent npx tsx eval/run.mts --group dates
 *   AWS_PROFILE=dev-devops-agent npx tsx eval/run.mts --case DATE-03 --verbose
 *
 * Default write mode is `proposal`: `propose_*` tools build their card and the
 * confirm step is stubbed, so nothing is booked, ordered, emailed or sent. Storage
 * is in-memory, so no reminder row is filed and no mail is armed.
 *
 * Cases run one at a time on purpose. Bedrock throttles, and a corpus that trips
 * throttling reports timeouts that belong to the harness rather than the agent.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Before anything imports `config`, which freezes its values at first import.
// `.env` is gitignored, so a worktree does not have one — fall back to the main
// checkout's, or the run silently proceeds with half the registry gated off and
// reports "no tool was called" as if the agent had chosen not to.
import { loadEnvFile } from '../src/server/load-env';
import type { EvalCase, Finding } from './harness/assertions';
import type { WriteMode } from './harness/recording-registry';

const ENV_CANDIDATES = [
  join(process.cwd(), '.env'),
  join(process.cwd(), '..', '..', '..', '.env'),
];
const envFile = ENV_CANDIDATES.find((path) => existsSync(path));
if (envFile) loadEnvFile(envFile);
else console.warn('⚠️  no .env found; credential-gated tools will be absent from the registry.');

// Value imports are dynamic and below `loadEnvFile` on purpose: a static import
// would be hoisted above it, `config` would freeze uncredentialed, and every
// gated tool would vanish from the registry.
const { check } = await import('./harness/assertions');
const { driveTurns } = await import('./harness/live-agent');
const { israelLocalDate } = await import('./harness/oracles');
const { writeReport } = await import('./harness/report');
const { allCases } = await import('./cases');

interface Args {
  group?: string;
  case?: string;
  budgetTurns: number;
  writes: WriteMode;
  verbose: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { budgetTurns: 40, writes: 'proposal', verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split('=');
    const value = inline ?? argv[index + 1];
    const consume = (): string => {
      if (inline === undefined) index += 1;
      return value;
    };
    if (flag === '--group') args.group = consume();
    else if (flag === '--case') args.case = consume();
    else if (flag === '--budget-turns') args.budgetTurns = Number(consume());
    else if (flag === '--allow-writes') args.writes = consume() as WriteMode;
    else if (flag === '--verbose') args.verbose = true;
  }
  return args;
}

function select(args: Args): EvalCase[] {
  if (args.case) {
    const ids = new Set(args.case.split(',').map((id) => id.trim().toUpperCase()));
    return allCases.filter((testCase) => ids.has(testCase.id));
  }
  if (args.group && args.group !== 'all') {
    const groups = new Set(args.group.split(',').map((group) => group.trim()));
    return allCases.filter((testCase) => groups.has(testCase.group));
  }
  return [...allCases];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cases = select(args);

  if (cases.length === 0) {
    console.error('No cases matched. Groups:', [...new Set(allCases.map((c) => c.group))].join(', '));
    process.exit(2);
  }

  // Prod runs on a UTC container. Several date bugs are invisible on an
  // Asia/Jerusalem laptop — DATE-03 passes locally and fails under TZ=UTC — so a
  // run in local time is auditing a machine no user ever talks to.
  const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz !== 'UTC') {
    console.warn(
      `⚠️  process timezone is ${tz}, but prod is UTC. Re-run with TZ=UTC to see the date bugs prod has.`,
    );
  }

  if (args.writes === 'confirm') {
    // Confirming reaches the outside world. It is never the unattended default and
    // saying so out loud is cheaper than discovering it from a restaurant.
    console.warn('⚠️  --allow-writes=confirm: playlists and calendar entries will be created.');
  }

  const sha = (() => {
    try {
      return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'nogit';
    }
  })();

  const findings: Finding[] = [];
  let turnsSpent = 0;

  for (const testCase of cases) {
    if (turnsSpent + testCase.turns.length > args.budgetTurns) {
      console.log(`\n⏹  budget of ${args.budgetTurns} turns reached; ${testCase.id} onward skipped.`);
      break;
    }

    const real = new Date();
    const now = testCase.at ? testCase.at(real) : real;
    const ctx = { now, nowLocalDate: israelLocalDate(now) };

    process.stdout.write(`${testCase.id.padEnd(10)} `);

    let finding: Finding;
    try {
      const outcome = await driveTurns(testCase.turns, {
        facts: testCase.facts,
        now,
        writes: args.writes,
      });
      turnsSpent += testCase.turns.length;

      const verdict = await check(testCase, outcome, ctx);
      finding = {
        id: testCase.id,
        group: testCase.group,
        severity: testCase.severity,
        status: verdict.status,
        why: testCase.why,
        detail: verdict.detail,
        reply: outcome.reply,
        calls: outcome.calls,
        ms: outcome.ms,
      };
    } catch (err) {
      // A harness or Bedrock failure is not evidence about the agent.
      finding = {
        id: testCase.id,
        group: testCase.group,
        severity: testCase.severity,
        status: 'UNPROVEN',
        why: testCase.why,
        detail: `the run itself failed: ${err instanceof Error ? err.message : String(err)}`,
        reply: '',
        calls: [],
        ms: 0,
      };
    }

    findings.push(finding);
    const mark = { PASS: '✅', FAIL: '❌', UNPROVEN: '⚠️ ' }[finding.status];
    console.log(`${mark} ${finding.status.padEnd(9)} ${finding.ms}ms  ${finding.detail}`);
    if (args.verbose && finding.reply) console.log(`   reply: ${finding.reply.slice(0, 400)}\n`);
  }

  const dir = writeReport(findings, sha);
  const fails = findings.filter((finding) => finding.status === 'FAIL').length;
  const unproven = findings.filter((finding) => finding.status === 'UNPROVEN').length;

  console.log(
    `\n${fails} FAIL · ${unproven} UNPROVEN · ${
      findings.length - fails - unproven
    } PASS  (${turnsSpent} turns)\n→ ${dir}/findings.md`,
  );

  // Exit 0 even with failures: this reports bugs, it does not gate a merge.
  process.exit(0);
}

await main();
