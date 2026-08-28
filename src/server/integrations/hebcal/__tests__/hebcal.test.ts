import { describe, it, expect } from 'vitest';
import {
  hebrewAnniversaries,
  hebrewDateOf,
  isDuringShabbat,
  resolveCity,
  shabbatWindow,
  upcomingHolidays,
} from '../client';
import { checkShabbatTool, hebrewOccasionsTool } from '../tools';

const CTX = { sessionId: 'sess-1' };

/**
 * Every assertion here is against a fixed date, because the whole value of this
 * integration is that the answers are not guesses. The reference case is
 * Valentine's Day 2026, which falls on Shabbat — the exact trap the integration
 * exists to stop Valentin walking into.
 */
const VALENTINES_2026 = new Date('2026-02-14T12:00:00+02:00');

describe('resolveCity', () => {
  it('finds a named Israeli city', () => {
    const { name, fellBack } = resolveCity('Jerusalem');
    expect(name).toContain('Jerusalem');
    expect(fellBack).toBe(false);
  });

  it('falls back to Tel Aviv rather than failing, and admits it', () => {
    const { name, fellBack } = resolveCity('Nowhereville-on-Sea');
    expect(name).toContain('Tel Aviv');
    // The flag is what lets the tool say which city it actually answered about;
    // silently answering about somewhere else would be worse than an error.
    expect(fellBack).toBe(true);
  });

  it('uses the default when given nothing, without calling that a fallback', () => {
    const { name, fellBack } = resolveCity(undefined);
    expect(name).toContain('Tel Aviv');
    expect(fellBack).toBe(false);
  });
});

describe('shabbatWindow', () => {
  it('gives Tel Aviv candle lighting and Havdalah for Valentine week 2026', () => {
    const window = shabbatWindow(new Date('2026-02-12T09:00:00+02:00'));

    expect(window.city).toContain('Tel Aviv');
    expect(window.candleLighting?.localDate).toBe('2026-02-13');
    expect(window.candleLighting?.localTime).toBe('17:05');
    expect(window.havdalah?.localDate).toBe('2026-02-14');
    expect(window.havdalah?.localTime).toBe('18:03');
    expect(window.parsha).toContain('Mishpatim');
  });

  it('still finds this evening\'s Havdalah when asked on Saturday afternoon', () => {
    const window = shabbatWindow(new Date('2026-02-14T14:00:00+02:00'));

    // Not next week's: someone asking mid-Shabbat wants tonight.
    expect(window.havdalah?.localDate).toBe('2026-02-14');
  });

  it('reports times in the city\'s own timezone across the DST boundary', () => {
    // Late June — Israel is on IDT, so a naive fixed offset would be an hour out.
    const window = shabbatWindow(new Date('2026-06-24T09:00:00+03:00'));
    expect(window.candleLighting?.localTime.startsWith('19')).toBe(true);
  });
});

describe('isDuringShabbat', () => {
  it('says yes to Friday 20:00 on Valentine weekend', () => {
    expect(isDuringShabbat(new Date('2026-02-13T20:00:00+02:00'))).toBe(true);
  });

  it('says no to Saturday 21:00, after Havdalah', () => {
    // מוצ״ש is the good night, and this is the assertion that proves Valentin
    // can tell it apart from Friday.
    expect(isDuringShabbat(new Date('2026-02-14T21:00:00+02:00'))).toBe(false);
  });

  it('says yes to Saturday 17:00, before Havdalah', () => {
    expect(isDuringShabbat(new Date('2026-02-14T17:00:00+02:00'))).toBe(true);
  });

  it('says no to Friday 16:00, before candle lighting', () => {
    expect(isDuringShabbat(new Date('2026-02-13T16:00:00+02:00'))).toBe(false);
  });

  it('says no on a Wednesday', () => {
    expect(isDuringShabbat(new Date('2026-02-11T20:00:00+02:00'))).toBe(false);
  });
});

describe('hebrewAnniversaries', () => {
  it('projects a Hebrew date forward rather than repeating the civil one', () => {
    // 2024-05-20 is 12 Iyyar 5784. The 2026 occurrence is 29 April — three weeks
    // off the civil date, which is exactly the mistake this prevents.
    const [next] = hebrewAnniversaries(
      new Date('2024-05-20T12:00:00+03:00'),
      new Date('2026-01-01T12:00:00+02:00'),
      'their wedding anniversary',
    );

    expect(next.hebrewDate).toContain('Iyyar');
    expect(next.date).toBe('2026-04-29');
    expect(next.date).not.toBe('2026-05-20');
    expect(next.kind).toBe('anniversary');
  });

  it('returns consecutive years, and they differ from each other', () => {
    const found = hebrewAnniversaries(
      new Date('2024-05-20T12:00:00+03:00'),
      new Date('2026-01-01T12:00:00+02:00'),
      'anniversary',
    );

    expect(found).toHaveLength(2);
    expect(found[0].date).not.toBe(found[1].date);
    expect(found[0].inDays).toBeLessThan(found[1].inDays);
  });

  it('never returns a date in the past', () => {
    const found = hebrewAnniversaries(
      new Date('2024-05-20T12:00:00+03:00'),
      // Asking in June, after this year's occurrence has gone.
      new Date('2026-06-01T12:00:00+03:00'),
      'anniversary',
    );

    expect(found.every((o) => o.inDays >= 0)).toBe(true);
  });

  it('skips a Hebrew year in which the day does not exist', () => {
    // 30 Kislev exists only when Kislev is long. Whatever the given year does,
    // the function must return real dates rather than a rolled-over 1 Tevet.
    const found = hebrewAnniversaries(
      new Date('2021-12-04T12:00:00+02:00'),
      new Date('2026-01-01T12:00:00+02:00'),
      'anniversary',
      3,
    );

    for (const occasion of found) {
      expect(occasion.hebrewDate).toContain(hebrewDateOf(new Date('2021-12-04T12:00:00+02:00')).split(' ')[1]);
    }
  });
});

describe('upcomingHolidays', () => {
  it('finds Purim in the window after Valentine 2026', () => {
    const holidays = upcomingHolidays(VALENTINES_2026, 60);
    expect(holidays.some((h) => h.title.includes('Purim'))).toBe(true);
  });

  it('leaves out Rosh Chodesh, which nobody plans a dinner around', () => {
    const holidays = upcomingHolidays(VALENTINES_2026, 120);
    expect(holidays.some((h) => h.title.includes('Rosh Chodesh'))).toBe(false);
  });

  it('never looks backwards', () => {
    const holidays = upcomingHolidays(VALENTINES_2026, 90);
    expect(holidays.every((h) => h.inDays >= 0)).toBe(true);
  });
});

describe('check_shabbat tool', () => {
  it('refuses a Friday-night slot in as many words', async () => {
    const result = await checkShabbatTool.execute(
      { city: 'Tel Aviv', when: '2026-02-13T20:00' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/IS during Shabbat/);
    expect(result.summary).toMatch(/do not propose it/i);
    expect((result.data as { duringShabbat: boolean }).duringShabbat).toBe(true);
  });

  it('clears a Saturday-night slot after Havdalah', async () => {
    const result = await checkShabbatTool.execute(
      { city: 'Tel Aviv', when: '2026-02-14T21:00' },
      CTX,
    );

    expect(result.summary).toMatch(/outside Shabbat/);
    expect((result.data as { duringShabbat: boolean }).duringShabbat).toBe(false);
  });

  it('gives times without a verdict when asked about a bare date', async () => {
    const result = await checkShabbatTool.execute({ when: '2026-02-14' }, CTX);

    // A bare date has no time to judge, and "not during Shabbat" would be a true
    // but misleading answer about a Saturday.
    expect((result.data as { duringShabbat: null }).duringShabbat).toBeNull();
    expect(result.summary).toContain('Havdalah');
  });

  it('says out loud when it substituted a city', async () => {
    const result = await checkShabbatTool.execute({ city: 'Atlantis' }, CTX);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Atlantis');
    expect(result.summary).toContain('Tel Aviv');
  });

  it('answers about now when given nothing at all', async () => {
    const result = await checkShabbatTool.execute({}, CTX);
    expect(result.ok).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

describe('get_hebrew_occasions tool', () => {
  it('converts an anniversary and names the Hebrew date it came from', async () => {
    const result = await hebrewOccasionsTool.execute(
      { anniversary_date: '2024-05-20', anniversary_title: 'their wedding' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Iyyar');
    expect(result.summary).toContain('their wedding');
    expect(
      (result.data as { anniversaries: unknown[] }).anniversaries,
    ).toHaveLength(2);
  });

  it('works with no anniversary, returning holidays alone', async () => {
    const result = await hebrewOccasionsTool.execute({ days_ahead: 30 }, CTX);

    expect(result.ok).toBe(true);
    expect((result.data as { anniversaries: unknown[] }).anniversaries).toEqual([]);
  });

  it('ignores an unparseable date rather than failing the turn', async () => {
    const result = await hebrewOccasionsTool.execute(
      { anniversary_date: 'sometime in the spring' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect((result.data as { anniversaries: unknown[] }).anniversaries).toEqual([]);
  });

  it('caps an absurd lookahead instead of walking the calendar forever', async () => {
    const result = await hebrewOccasionsTool.execute({ days_ahead: 99_999 }, CTX);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('400 days');
  });
});

describe('tool contracts', () => {
  it('marks both tools read-only, so neither can act unattended', () => {
    for (const tool of [checkShabbatTool, hebrewOccasionsTool]) {
      expect(tool.requiresConfirmation).toBe(false);
      expect(tool.confirm).toBeUndefined();
      expect(tool.service).toBe('hebcal');
    }
  });
});
