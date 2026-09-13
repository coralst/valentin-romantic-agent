/**
 * Re-derives the cold-start table from the recorded probe samples.
 *
 * Usage:
 *   node scripts/experiment/cold-start-report.mjs runs/cold-start
 *
 * Each probe file is one `drive.mts --turns=1` run: a fresh session, a single turn, the
 * same stimulus. Which sample is cold and which is warm is recorded in the FILE NAME
 * (`cold-*` / `warm-*`) because idle time is a property of the platform, not of any frame
 * the app receives — nothing in the JSONL can tell you the microVM's age.
 *
 * The metric reported is the `InvokeAgentRuntime` span's `durationMs`, not the turn's
 * `replyLatencyMs`. The span starts inside the engine-B proxy, so it excludes CloudFront,
 * the ALB and the socket, which is exactly what a cold-start claim must exclude — those
 * layers are warm in every sample and would only add noise.
 *
 * Tool-call count is printed for every sample and is load-bearing: engine B's latency is
 * dominated by how many tool-loop iterations the model chooses, so a cold/warm comparison
 * is only valid between samples that made the SAME number of tool calls. A run where the
 * counts diverge is not a measurement of warmth.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'runs/cold-start';

/** Pull the single InvokeAgentRuntime span out of one probe file. */
function readProbe(path) {
  let runtimeMs = null;
  let toolCalls = null;
  let replyMs = null;
  let startedAt = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.kind === 'run_start') startedAt = record.data.startedAt;
    if (record.kind === 'turn') replyMs = record.data.replyLatencyMs;
    if (record.kind !== 'frame') continue;
    const payload = record.data.payload ?? {};
    if (record.data.type === 'aws_span' && payload.operation === 'InvokeAgentRuntime') {
      runtimeMs = payload.durationMs;
      const detail = payload.detail ?? '';
      toolCalls = /^(\d+) tool/.exec(detail) ? Number(/^(\d+) tool/.exec(detail)[1]) : 0;
    }
  }
  return { runtimeMs, toolCalls, replyMs, startedAt };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const probes = readdirSync(dir)
  .filter((name) => name.endsWith('.jsonl'))
  .sort()
  .map((name) => ({ name, ...readProbe(join(dir, name)) }));

if (probes.length === 0) throw new Error(`no *.jsonl probe files under ${dir}`);

process.stdout.write('sample            runtime   reply  tools  startedAt\n');
for (const probe of probes) {
  process.stdout.write(
    `${probe.name.replace('.jsonl', '').padEnd(16)} ${String(probe.runtimeMs).padStart(7)} ` +
      `${String(probe.replyMs).padStart(7)} ${String(probe.toolCalls).padStart(6)}  ${probe.startedAt}\n`,
  );
}

const counts = new Set(probes.map((probe) => probe.toolCalls));
for (const toolCalls of [...counts].sort((a, b) => a - b)) {
  const bucket = probes.filter((probe) => probe.toolCalls === toolCalls);
  const cold = bucket.filter((probe) => probe.name.startsWith('cold')).map((p) => p.runtimeMs);
  const warm = bucket.filter((probe) => probe.name.startsWith('warm')).map((p) => p.runtimeMs);
  process.stdout.write(`\n${toolCalls} tool call(s):\n`);
  process.stdout.write(`  cold n=${cold.length} ${cold.join(', ')}\n`);
  process.stdout.write(`  warm n=${warm.length} ${warm.join(', ')}\n`);
  if (cold.length && warm.length) {
    process.stdout.write(
      `  median cold ${median(cold)} ms - median warm ${median(warm)} ms ` +
        `= ${median(cold) - median(warm) >= 0 ? '+' : ''}${median(cold) - median(warm)} ms\n`,
    );
  }
}
