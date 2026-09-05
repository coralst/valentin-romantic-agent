/**
 * Write the findings somewhere a person can read them.
 *
 * FAIL first, then UNPROVEN, then PASS — a report that buries the failures under
 * forty passes is a report nobody reads to the end. Each finding carries the
 * arguments that were actually passed, because "it picked the wrong date" is only
 * actionable with the date attached.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Finding } from './assertions';

const ORDER: Record<string, number> = { FAIL: 0, UNPROVEN: 1, PASS: 2 };

function transcriptFor(finding: Finding): string {
  const calls = finding.calls
    .map(
      (call, index) =>
        `### ${index + 1}. \`${call.name}\`${call.stubbed ? ' _(stubbed by the harness)_' : ''}\n\n` +
        `- service: \`${call.service}\`\n` +
        `- ok: \`${call.ok}\` · ${call.ms}ms\n` +
        `- **args:** \`${JSON.stringify(call.args)}\`\n` +
        `- summary: ${call.summary}\n`,
    )
    .join('\n');

  return (
    `# ${finding.id} — ${finding.status}\n\n` +
    `**Why this case exists.** ${finding.why}\n\n` +
    (finding.detail ? `**What went wrong.** ${finding.detail}\n\n` : '') +
    `## Tool calls (${finding.calls.length})\n\n${calls || '_none_\n'}\n` +
    `## Final reply\n\n> ${finding.reply.replace(/\n/g, '\n> ') || '_empty_'}\n`
  );
}

export function writeReport(findings: readonly Finding[], sha: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const dir = join(process.cwd(), 'docs', 'bug-hunt', `${day}-${sha}`);
  mkdirSync(join(dir, 'transcripts'), { recursive: true });

  const sorted = [...findings].sort(
    (a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || a.id.localeCompare(b.id),
  );

  writeFileSync(join(dir, 'findings.json'), `${JSON.stringify(sorted, null, 2)}\n`);

  for (const finding of sorted) {
    writeFileSync(join(dir, 'transcripts', `${finding.id}.md`), transcriptFor(finding));
  }

  const counts = { FAIL: 0, UNPROVEN: 0, PASS: 0 } as Record<string, number>;
  for (const finding of sorted) counts[finding.status] = (counts[finding.status] ?? 0) + 1;

  const rows = sorted
    .map(
      (finding) =>
        `| ${finding.status} | ${finding.id} | ${finding.group} | ${finding.severity} | ${
          finding.detail.replace(/\|/g, '\\|').slice(0, 200) || '—'
        } |`,
    )
    .join('\n');

  const latency = ['case,group,ms,tool_calls']
    .concat(sorted.map((f) => `${f.id},${f.group},${f.ms},${f.calls.length}`))
    .join('\n');
  writeFileSync(join(dir, 'latency.csv'), `${latency}\n`);

  const md =
    `# Bug hunt — ${day} (${sha})\n\n` +
    `${counts.FAIL} FAIL · ${counts.UNPROVEN} UNPROVEN · ${counts.PASS} PASS\n\n` +
    `UNPROVEN means the case could not be decided — a provider was unreachable or a\n` +
    `credential was missing. It is never counted as a pass.\n\n` +
    `| Status | Case | Group | Severity | Detail |\n|---|---|---|---|---|\n${rows}\n\n` +
    `## Failures in detail\n\n` +
    sorted
      .filter((finding) => finding.status === 'FAIL')
      .map(
        (finding) =>
          `### ${finding.id} (${finding.severity}) — ${finding.group}\n\n` +
          `${finding.why}\n\n**Observed.** ${finding.detail}\n\n` +
          `Tools called: ${
            finding.calls.map((call) => `\`${call.name}(${JSON.stringify(call.args)})\``).join(', ') ||
            '_none_'
          }\n\n` +
          `Repro: \`npx tsx eval/run.mts --case ${finding.id}\` · transcript: \`transcripts/${finding.id}.md\`\n`,
      )
      .join('\n') +
    '\n';

  writeFileSync(join(dir, 'findings.md'), md);
  return dir;
}
