import type { AgentTool } from '../tool-registry';
import {
  DEFAULT_CITY,
  hebrewAnniversaries,
  hebrewDateOf,
  isDuringShabbat,
  parseInZone,
  shabbatWindow,
  timeZoneOf,
  upcomingHolidays,
  type Occasion,
} from './client';

/**
 * The two Hebrew-calendar questions Valentin cannot answer from the prompt.
 *
 * Both are read-only, so neither proposes anything and neither can spend money.
 * They exist so the model looks a date up instead of reasoning about it: an LLM
 * asked "when is their Hebrew anniversary next year" will produce a plausible
 * date, and a plausible date is worse than no date, because the couple will act
 * on it.
 */

/**
 * Parse a date the model supplied, in the timezone of the city being asked about.
 *
 * The model writes wall-clock times without an offset, and it means them locally:
 * "dinner at 20:00" is 20:00 in Tel Aviv regardless of where the container runs.
 * `parseInZone` resolves them there rather than in the process timezone — see its
 * doc for the production failure that motivated it. A string that *does* carry an
 * offset or a `Z` is already unambiguous and is honoured as written.
 */
function parseDate(value: unknown, timeZone: string): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const explicit = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  if (explicit) {
    const parsed = new Date(value.trim());
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return parseInZone(value, timeZone);
}

/** One line per occasion, in the order the agent should mention them. */
function renderOccasions(occasions: Occasion[]): string {
  return occasions
    .map((o) => `${o.date} (${o.hebrewDate}) — ${o.title}, in ${o.inDays} day(s)`)
    .join('; ');
}

/**
 * When Shabbat starts and ends, and whether a proposed time falls inside it.
 *
 * The `when` argument is what makes this useful rather than trivia: the model can
 * ask about the exact slot it is considering and be told no, instead of being
 * told the times and left to compare them itself.
 */
export const checkShabbatTool: AgentTool = {
  name: 'check_shabbat',
  description:
    'Look up when Shabbat begins (candle lighting) and ends (Havdalah) in an ' +
    'Israeli city, and whether a specific date and time falls inside it. Use ' +
    'this before proposing any Friday or Saturday plan — most restaurants are ' +
    'closed from candle lighting until Havdalah, and Havdalah moves by more ' +
    'than an hour across the year. Never guess these times.',
  input_schema: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: `City to check, e.g. "Tel Aviv", "Jerusalem", "Haifa". Defaults to ${DEFAULT_CITY}.`,
      },
      when: {
        type: 'string',
        description:
          'Optional date, or date and time, being considered — "2026-02-14" or ' +
          '"2026-02-14T20:00". The answer says whether it falls during Shabbat.',
      },
    },
    required: [],
  },
  service: 'hebcal',
  requiresConfirmation: false,
  async execute(input) {
    const city = typeof input.city === 'string' ? input.city : undefined;
    // The city's zone, not the process's — `timeZoneOf` falls back exactly as
    // `shabbatWindow` does, so both halves of the answer agree on which city.
    const when = parseDate(input.when, timeZoneOf(city));
    const reference = when ?? new Date();
    const window = shabbatWindow(reference, city);

    const notes: string[] = [];
    if (window.fellBackToDefaultCity) {
      notes.push(
        `I don't have ${String(input.city)} in the city list, so these times are for ${window.city} — say so if you mention them.`,
      );
    }

    if (window.candleLighting) {
      // Past tense when the reference instant is already inside the window. The
      // pair always describes one Shabbat, so "began … ends" is coherent where
      // "begins … ends" would read as a forecast of something under way.
      const verb = window.inProgress ? 'began' : 'begins';
      notes.push(
        `Shabbat ${verb} ${window.candleLighting.localDate} at ${window.candleLighting.localTime}`,
      );
    }
    if (window.havdalah) {
      notes.push(
        `and ends (Havdalah, מוצ״ש) ${window.havdalah.localDate} at ${window.havdalah.localTime}`,
      );
    }
    if (window.parsha) notes.push(`(${window.parsha})`);

    // Only meaningful when the caller named a time; a bare date is midday, and
    // reporting "not during Shabbat" for a date is a true but useless answer.
    const askedAboutATime = typeof input.when === 'string' && /\d{2}:\d{2}/.test(input.when);
    const during = when ? isDuringShabbat(when, city) : false;
    if (askedAboutATime && when) {
      notes.push(
        during
          ? `That time IS during Shabbat — do not propose it; offer after Havdalah instead.`
          : `That time is outside Shabbat, so it is available.`,
      );
    }

    return {
      ok: true,
      summary: `${window.city}: ${notes.join(' ')}`,
      data: {
        city: window.city,
        candleLighting: window.candleLighting,
        havdalah: window.havdalah,
        parsha: window.parsha,
        duringShabbat: askedAboutATime ? during : null,
      },
    };
  },
};

/**
 * Upcoming Jewish holidays, and where a Hebrew-date anniversary next lands.
 *
 * The anniversary half is the point. Given the civil date the couple married,
 * this reports the civil dates their *Hebrew* anniversary falls on — which drifts
 * by up to three weeks a year, so "same date next year" is simply the wrong
 * answer, and one the model will otherwise give confidently.
 */
export const hebrewOccasionsTool: AgentTool = {
  name: 'get_hebrew_occasions',
  description:
    'Look up upcoming Jewish holidays, and convert a Hebrew-date anniversary ' +
    '(a wedding, a first date) into the civil dates it next falls on. Hebrew ' +
    'anniversaries move against the civil calendar by up to three weeks a year, ' +
    'so always look this up rather than assuming the same date each year.',
  input_schema: {
    type: 'object',
    properties: {
      days_ahead: {
        type: 'number',
        description: 'How far ahead to look for holidays. Defaults to 90.',
      },
      anniversary_date: {
        type: 'string',
        description:
          'The civil date of the original event as YYYY-MM-DD, e.g. "2019-05-20" — ' +
          'the year it actually happened, not this year. Its Hebrew date is read off ' +
          'and projected forward.',
      },
      anniversary_title: {
        type: 'string',
        description: 'What the anniversary is, e.g. "their wedding anniversary".',
      },
    },
    required: [],
  },
  service: 'hebcal',
  requiresConfirmation: false,
  async execute(input) {
    const now = new Date();
    const daysAhead =
      typeof input.days_ahead === 'number' && input.days_ahead > 0
        ? Math.min(Math.round(input.days_ahead), 400)
        : 90;

    const holidays = upcomingHolidays(now, daysAhead);

    // No city argument on this tool, so the default — the anniversary is a date in
    // the couple's own calendar, and they are in Israel.
    const original = parseDate(input.anniversary_date, timeZoneOf());
    const title =
      typeof input.anniversary_title === 'string' && input.anniversary_title.trim()
        ? input.anniversary_title.trim()
        : 'their anniversary';
    const anniversaries = original
      ? hebrewAnniversaries(original, now, title)
      : [];

    const parts: string[] = [];
    if (original) {
      parts.push(
        `${input.anniversary_date} was ${hebrewDateOf(original)} in the Hebrew calendar, so ${title} falls on: ${renderOccasions(anniversaries)}.`,
      );
    }
    parts.push(
      holidays.length
        ? `Holidays in the next ${daysAhead} days: ${renderOccasions(holidays)}.`
        : `No notable holidays in the next ${daysAhead} days.`,
    );

    return {
      ok: true,
      summary: parts.join(' '),
      data: { anniversaries, holidays },
    };
  },
};

export const hebcalTools: AgentTool[] = [checkShabbatTool, hebrewOccasionsTool];
