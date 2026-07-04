/**
 * GitHub API Wrapper Tests — comment posting safety
 *
 * Verifies the two defects called out in the workflow review are fixed:
 *   #6 Multi-line comment bodies were posted with literal "\n" (double-quoted
 *      shell interpolation). They must now be preserved verbatim.
 *   #7 The `approvePR`/`requestChanges` self-approve footguns are removed.
 *
 * The wrapper shells out to `gh`. To keep this deterministic and offline we put
 * a fake `gh` executable on PATH that records its argv and stdin to a temp file,
 * then assert on what the wrapper actually sent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// @ts-expect-error - JS skill module without type declarations
import wrapper from '../../../skills/pr-monitoring/github-api-wrapper-skill.js';

let tmpDir: string;
let captureFile: string;
let originalPath: string | undefined;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-fake-'));
  captureFile = path.join(tmpDir, 'capture.json');
  // Fake gh: capture argv + stdin, emit a stub JSON payload on stdout.
  const fakeGh = [
    '#!/usr/bin/env node',
    'const fs = require("fs");',
    'const argv = process.argv.slice(2);',
    'let stdin = "";',
    'try { stdin = fs.readFileSync(0, "utf-8"); } catch { stdin = ""; }',
    `fs.writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({ argv, stdin }));`,
    'process.stdout.write("{}");',
    '',
  ].join('\n');
  const ghPath = path.join(tmpDir, 'gh');
  fs.writeFileSync(ghPath, fakeGh, { mode: 0o755 });
  originalPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${originalPath ?? ''}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function lastCapture(): { argv: string[]; stdin: string } {
  return JSON.parse(fs.readFileSync(captureFile, 'utf-8'));
}

describe('postPRComment preserves multi-line bodies', () => {
  it('sends the body via --body-file - on stdin, with newlines intact', () => {
    const body = [
      '**👔 Master Agent** — Review Complete',
      '',
      '✅ CI green',
      '❌ Fix the thing',
      '',
      'APPROVED-BY-MASTER-AGENT 🟢 — merging.',
    ].join('\n');

    const ok = wrapper.postPRComment('coralst', 'valentin-romantic-agent', 42, body);
    expect(ok).toBe(true);

    const cap = lastCapture();
    // Body is streamed on stdin, not interpolated into argv.
    expect(cap.argv).toContain('--body-file');
    expect(cap.argv).toContain('-');
    expect(cap.argv).not.toContain('--body');
    // Real newlines preserved — not literal backslash-n.
    expect(cap.stdin).toBe(body);
    expect(cap.stdin).toContain('\n');
    expect(cap.stdin).not.toContain('\\n');
  });

  it('does not shell-interpret injection metacharacters in the body', () => {
    const body = 'harmless `$(touch /tmp/should-not-run)` "quoted" text';
    wrapper.postPRComment('coralst', 'valentin-romantic-agent', 7, body);
    const cap = lastCapture();
    // The body arrives verbatim on stdin — no shell expansion, no escaping.
    expect(cap.stdin).toBe(body);
  });
});

describe('self-approve footguns are removed', () => {
  it('does not export approvePR or requestChanges', () => {
    expect(wrapper.approvePR).toBeUndefined();
    expect(wrapper.requestChanges).toBeUndefined();
  });

  it('still exports the safe read/post helpers', () => {
    for (const fn of [
      'fetchPRReviews',
      'fetchPRComments',
      'postPRComment',
      'getPRStatus',
      'getPRDetails',
      'listOpenPRs',
    ]) {
      expect(typeof wrapper[fn]).toBe('function');
    }
  });
});
