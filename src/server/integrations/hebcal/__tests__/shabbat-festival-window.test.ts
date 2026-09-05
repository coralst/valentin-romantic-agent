/**
 * The Shabbat window when a festival lands next to it.
 *
 * `shabbatWindow` anchors on Havdalah and then takes the candle lighting that
 * precedes it. Its docblock explains why, and the reasoning is sound: it fixed a
 * real bug where next Friday's candle lighting was paired with tonight's Havdalah,
 * producing a window that closed six days before it opened.
 *
 * But the anchor assumes one candle lighting per Havdalah. When Shabbat runs
 * straight into a yom tov there is no Saturday-night Havdalah — it is deferred to
 * the end of the festival — so the first Havdalah at or after `from` belongs to the
 * *festival*, and "the candle lighting before it" is the festival's, not Friday's.
 * The Friday the user asked about is skipped entirely.
 *
 * Found by a live probe, not by reading the code: asked for a table "next Friday",
 * the agent consulted `check_shabbat` with 2026-09-11 — a Friday — was told
 * "Shabbat begins 2026-09-12", and passed that on as "next Friday is September
 * 12th". September 12th is a Saturday. That is the user-visible half of the bug.
 */
import { describe, expect, it } from 'vitest';

import { shabbatWindow } from '../client';

/**
 * 2026-09-11 is a Friday. 2026-09-12 is Shabbat and also Erev Rosh Hashanah, so
 * hebcal emits candle lighting on both days and no Havdalah until 2026-09-13.
 */
const FRIDAY_BEFORE_ROSH_HASHANAH = new Date('2026-09-11T09:00:00+03:00');

describe('a Shabbat that runs into a festival', () => {
  it('reports the candle lighting of the Friday it was asked about', () => {
    const window = shabbatWindow(FRIDAY_BEFORE_ROSH_HASHANAH, 'Tel Aviv');

    // Per hebcal directly: candles 2026-09-11T18:32+03:00, then a second lighting
    // at 2026-09-12T19:28 for the festival, then Havdalah 2026-09-13T19:26.
    expect(
      window.candleLighting?.localDate,
      'asked on Friday morning, the window opens on a later day than the Friday itself',
    ).toBe('2026-09-11');
  });

  it('never opens the window after the day it was asked about', () => {
    const window = shabbatWindow(FRIDAY_BEFORE_ROSH_HASHANAH, 'Tel Aviv');

    // The weaker, more general form of the same rule: whatever pairing is chosen,
    // a user asking on Friday morning must not be told Shabbat starts tomorrow.
    // This is the assertion that keeps holding if the fix changes the pairing.
    expect(window.candleLighting?.localDate).not.toBe('2026-09-12');
  });

  it('still closes after it opens', () => {
    const window = shabbatWindow(FRIDAY_BEFORE_ROSH_HASHANAH, 'Tel Aviv');

    // The invariant the Havdalah anchor was introduced to protect. It must survive
    // whatever fixes the case above.
    if (window.candleLighting && window.havdalah) {
      expect(window.havdalah.at >= window.candleLighting.at).toBe(true);
    }
  });
});
