/**
 * Does the prompt tell the model the truth about the system it is driving?
 *
 * `prompts.test.ts` already pins the prompt *text* — that GOAL 1 is still named,
 * that the old interview order is gone. It cannot catch the prompt agreeing with
 * itself while disagreeing with the code, which is a different and worse failure:
 * the model repeats a promise to the user that the server will not keep, and
 * nothing anywhere goes red.
 *
 * These assertions therefore all compare prompt prose against a constant or a
 * registry, never against another string in the same file.
 */
import { describe, expect, it } from 'vitest';

import { REMINDER_SEND_TIME_LOCAL } from '../../../shared/interfaces/reminder';
import { fullRegistry } from '../../integrations/__tests__/full-registry';
import { TOOL_GUIDANCE, VALENTIN_SYSTEM_PROMPT, nowBlock } from '../prompts';

describe('TOOL_GUIDANCE against the code it describes', () => {
  /**
   * The reminder dispatcher sends at REMINDER_SEND_TIME_LOCAL (08:30). The
   * guidance tells the model "that morning at 9am", and the model repeats it —
   * so the user is told a time no reminder ever arrives at, and is told it in
   * the one flow the prompt lets the agent claim as already done.
   */
  it('names the send time the dispatcher actually uses', () => {
    const [hour, minute] = REMINDER_SEND_TIME_LOCAL.split(':').map(Number);

    // Any clock time in the guidance must be the real one. Matches "9am",
    // "9 am", "08:30", "8:30am".
    const clockTimes = TOOL_GUIDANCE.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi) ?? [];
    const timeLike = clockTimes.filter((t) => /am|pm|:/i.test(t));

    const normalised = timeLike.map((t) => {
      const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t.trim());
      if (!m) return t;
      let h = Number(m[1]);
      const mins = m[2] ? Number(m[2]) : 0;
      if (/pm/i.test(m[3] ?? '') && h !== 12) h += 12;
      if (/am/i.test(m[3] ?? '') && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    });

    const expected = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    for (const time of normalised) {
      expect(
        time,
        `TOOL_GUIDANCE promises mail at ${time} but REMINDER_SEND_TIME_LOCAL is ${expected}`,
      ).toBe(expected);
    }
  });

  it('names only tools that exist in a fully configured registry', async () => {
    const registry = await fullRegistry();
    const known = new Set(registry.keys());

    // Tool names in the prose are snake_case identifiers. Only check the ones
    // shaped like a tool name, so ordinary prose is not mistaken for one.
    const mentioned = new Set(TOOL_GUIDANCE.match(/\b[a-z]+(?:_[a-z]+){1,3}\b/g) ?? []);
    const claimedTools = [...mentioned].filter(
      (word) => known.has(word) || /^(propose|find|check|search|set|get|read|create)_/.test(word),
    );

    for (const name of claimedTools) {
      expect(known.has(name), `TOOL_GUIDANCE names "${name}", which no tool provides`).toBe(true);
    }
  });
});

describe('nowBlock is a function of the instant, not of the container', () => {
  /**
   * The container runs UTC and a laptop in Israel does not, which is exactly how
   * a date bug survives review: it is invisible where it is written.
   */
  it('renders one instant identically under every process timezone', () => {
    const instant = new Date('2026-09-05T22:00:00Z'); // 01:00 Israel, next civil day
    const original = process.env.TZ;
    const rendered: Record<string, string> = {};

    try {
      for (const tz of ['UTC', 'Asia/Jerusalem', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        rendered[tz] = nowBlock(instant);
      }
    } finally {
      process.env.TZ = original;
    }

    const values = [...new Set(Object.values(rendered))];
    expect(
      values.length,
      `nowBlock differs by process timezone:\n${Object.entries(rendered)
        .map(([tz, text]) => `  ${tz}: ${text.split('\n')[0]}`)
        .join('\n')}`,
    ).toBe(1);
  });

  it('tells the model to pass tools absolute dates', () => {
    expect(nowBlock(new Date('2026-09-06T09:00:00Z'))).toMatch(/YYYY-MM-DD/);
  });
});

describe('the persona prompt makes no capability claim', () => {
  /**
   * Tool talk belongs in TOOL_GUIDANCE, which is appended only when the registry
   * is non-empty. A capability promised in the persona prompt is promised even in
   * a deployment with no credentials for it.
   */
  it('names no tool', () => {
    expect(VALENTIN_SYSTEM_PROMPT).not.toMatch(
      /\b(propose|find|check|search|set|get|read|create)_[a-z_]+\b/,
    );
  });
});
