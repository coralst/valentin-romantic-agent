/**
 * `check_shabbat` names the weekday, and says when Havdalah is deferred.
 *
 * The window arithmetic was already fixed (see `shabbat-festival-window.test.ts`),
 * and production then returned the *right* times with the wrong weekday attached:
 * asked what time Shabbat starts next Friday, the deployed agent answered "Candles
 * next Friday are 18:32, Havdalah Saturday night at 19:26". Both numbers are
 * hebcal's. But that Havdalah is 2026-09-13, a **Sunday** — deferred because
 * Shabbat runs straight into Rosh Hashanah — and the model asserted Saturday
 * because nothing in the tool result contradicted the ordinary case.
 *
 * So the tool spells the weekday out and flags the deferral explicitly. Asserted on
 * the summary rather than on prose, because the summary is the only part of this the
 * model cannot overrule.
 */
import { describe, expect, it } from 'vitest';

import { checkShabbatTool } from '../tools';

/** 2026-09-11 is a Friday; 2026-09-12 is Shabbat *and* Erev Rosh Hashanah. */
const FRIDAY_BEFORE_ROSH_HASHANAH = '2026-09-11';

/** An ordinary Friday three weeks earlier, with a normal Saturday-night Havdalah. */
const ORDINARY_FRIDAY = '2026-08-21';

const ctx = { sessionId: 'weekday-test', userId: 'u1' } as never;

describe('check_shabbat prose', () => {
  it('names the weekday of the candle lighting it reports', async () => {
    const result = await checkShabbatTool.execute({ city: 'Tel Aviv', when: ORDINARY_FRIDAY }, ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Friday 2026-08-21');
  });

  it('names Sunday for a Havdalah deferred past Saturday night', async () => {
    const result = await checkShabbatTool.execute(
      { city: 'Tel Aviv', when: FRIDAY_BEFORE_ROSH_HASHANAH },
      ctx,
    );

    expect(result.ok).toBe(true);
    // The live wrong answer called this Saturday night. The date is 2026-09-13.
    expect(result.summary).toContain('Sunday 2026-09-13');
  });

  it('says the rest period does not break on Saturday evening', async () => {
    const result = await checkShabbatTool.execute(
      { city: 'Tel Aviv', when: FRIDAY_BEFORE_ROSH_HASHANAH },
      ctx,
    );

    expect(result.summary).toMatch(/runs straight into a festival/);
    expect(result.summary).toMatch(/not the next night/);
  });

  it('says nothing about a deferral on an ordinary week', async () => {
    const result = await checkShabbatTool.execute({ city: 'Tel Aviv', when: ORDINARY_FRIDAY }, ctx);

    // The note must be the exception, or the model learns to ignore it.
    expect(result.summary).not.toMatch(/festival/);
    expect(result.summary).toContain('Saturday 2026-08-22');
  });
});
