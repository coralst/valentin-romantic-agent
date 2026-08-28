import {
  HDate,
  HebrewCalendar,
  Location,
  TimedEvent,
  months,
  type Event,
} from '@hebcal/core';

/**
 * Hebrew calendar facts, computed locally.
 *
 * No HTTP and no credential: `@hebcal/core` carries the calendar and a city
 * database, so this is arithmetic. That makes it the one integration that cannot
 * be down, which is why it is worth having even though it looks like a detail.
 *
 * It exists because Valentin plans evenings in Israel, where two things are true
 * that a naive date-picker gets wrong every time:
 *
 * 1. **Friday night is not date night.** Restaurants close before candle
 *    lighting and reopen after Havdalah, so מוצ״ש — Saturday after dark — is the
 *    good slot, and its start time moves through the year by well over an hour.
 * 2. **A Hebrew-date anniversary drifts.** Couples who married on 12 Iyyar do
 *    not celebrate on the same civil date each year; the gap swings by up to
 *    three weeks. Looking it up is right; calculating "same day next year" is
 *    wrong, and confidently wrong.
 *
 * Everything here is a pure function of its arguments plus the clock, so the
 * tests need no stubs.
 */

/** Where we plan by default. Most of the demo is Tel Aviv. */
export const DEFAULT_CITY = 'Tel Aviv';

/** A resolved city, plus whether we got the one that was asked for. */
export interface ResolvedCity {
  location: Location;
  /** The name hebcal knows it by — not necessarily what the caller typed. */
  name: string;
  /** True when the requested city was not found and we fell back. */
  fellBack: boolean;
}

/**
 * Find a city, falling back to Tel Aviv rather than failing.
 *
 * A wrong city costs the user a candle-lighting time that is minutes out; a
 * failure costs them the whole answer. The fallback is reported so the tool can
 * say which city it actually used — silently answering about a different place
 * would be worse than either.
 */
export function resolveCity(city?: string): ResolvedCity {
  const requested = city?.trim();
  if (requested) {
    const found = Location.lookup(requested);
    if (found) return { location: found, name: found.getName() ?? requested, fellBack: false };
  }
  const fallback = Location.lookup(DEFAULT_CITY);
  if (!fallback) {
    // hebcal ships the city database, so this cannot happen — but constructing
    // Tel Aviv by hand is cheaper than a thrown error on a demo stage.
    const built = new Location(32.0853, 34.7818, true, 'Asia/Jerusalem', DEFAULT_CITY, 'IL');
    return { location: built, name: DEFAULT_CITY, fellBack: Boolean(requested) };
  }
  return {
    location: fallback,
    name: fallback.getName() ?? DEFAULT_CITY,
    fellBack: Boolean(requested),
  };
}

/** One end of the Shabbat window, as both an instant and a local wall time. */
export interface ShabbatMoment {
  /** ISO instant, unambiguous. */
  at: string;
  /** Local date, `YYYY-MM-DD` in the city's own timezone. */
  localDate: string;
  /** Local time, `HH:MM` in the city's own timezone. */
  localTime: string;
}

export interface ShabbatWindow {
  city: string;
  fellBackToDefaultCity: boolean;
  /** When restaurants shut. Absent only if the lookup window missed it. */
  candleLighting: ShabbatMoment | null;
  /** מוצ״ש — when the evening becomes available again. */
  havdalah: ShabbatMoment | null;
  /** This week's Torah portion, for a warmer sentence. */
  parsha: string | null;
}

/**
 * Format an instant as a wall clock in a given timezone.
 *
 * Done with `Intl` rather than by adding an offset, because Israel observes DST
 * and the offset therefore depends on the date being formatted.
 */
function inZone(at: Date, timeZone: string): { localDate: string; localTime: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    // `en-CA` renders midnight as 24:00; the calendar never puts candle lighting
    // there, but normalising costs one line and removes the class of bug.
    localTime: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`,
  };
}

/**
 * The instant a timed event happens, or null when it has no clock time.
 *
 * Candle lighting and Havdalah are `TimedEvent`s and carry `eventTime`; the
 * parsha and the holidays are plain `Event`s and do not. Narrowed with
 * `instanceof` rather than cast, so a hebcal upgrade that reshapes the hierarchy
 * fails at compile time instead of yielding `undefined` at runtime.
 */
function timeOf(event: Event): Date | null {
  return event instanceof TimedEvent ? event.eventTime : null;
}

function moment(at: Date, timeZone: string): ShabbatMoment {
  return { at: at.toISOString(), ...inZone(at, timeZone) };
}

/**
 * The Shabbat that contains or next follows `from`.
 *
 * The window is eight days wide so that asking on a Saturday afternoon still
 * finds that evening's Havdalah rather than skipping to next week.
 */
export function shabbatWindow(from: Date, city?: string): ShabbatWindow {
  const { location, name, fellBack } = resolveCity(city);
  const timeZone = location.getTimeZone();

  const events = HebrewCalendar.calendar({
    start: from,
    end: new Date(from.getTime() + 8 * 86_400_000),
    location,
    candlelighting: true,
    il: true,
    sedrot: true,
  });

  // Timed events carry `eventTime`; the untimed ones (the parsha) do not. The
  // first candle lighting at or after `from` is the one we want — an earlier one
  // in the window belongs to a Shabbat that has already begun.
  const timedAfter = (desc: string): Date | null => {
    for (const event of events) {
      if (event.getDesc() !== desc) continue;
      const at = timeOf(event);
      if (at && at.getTime() >= from.getTime()) return at;
    }
    return null;
  };

  const candle = timedAfter('Candle lighting');
  const havdalah = timedAfter('Havdalah');
  const parsha =
    events.find((e) => e.getDesc().startsWith('Parashat'))?.render('en') ?? null;

  return {
    city: name,
    fellBackToDefaultCity: fellBack,
    candleLighting: candle ? moment(candle, timeZone) : null,
    havdalah: havdalah ? moment(havdalah, timeZone) : null,
    parsha,
  };
}

/**
 * Is this instant inside Shabbat, per the city's own candle lighting?
 *
 * The question the agent actually needs answered before it proposes a Friday
 * 20:00 table. Computed from the window immediately preceding `at`, not from the
 * day of the week, because Shabbat starts on Friday afternoon and ends on
 * Saturday night — "is it Saturday" is the wrong question in both directions.
 */
export function isDuringShabbat(at: Date, city?: string): boolean {
  const { location } = resolveCity(city);
  const events = HebrewCalendar.calendar({
    // Two days back is enough to catch the candle lighting that began the
    // current Shabbat, whatever hour we are asked at.
    start: new Date(at.getTime() - 2 * 86_400_000),
    end: new Date(at.getTime() + 2 * 86_400_000),
    location,
    candlelighting: true,
    il: true,
  });

  const timed = events
    .map((e) => ({ desc: e.getDesc(), at: timeOf(e) }))
    .filter((e): e is { desc: string; at: Date } => e.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  let inside = false;
  for (const event of timed) {
    if (event.at.getTime() > at.getTime()) break;
    if (event.desc === 'Candle lighting') inside = true;
    if (event.desc === 'Havdalah') inside = false;
  }
  return inside;
}

/** A dated thing worth marking, with enough context for the agent to speak. */
export interface Occasion {
  /** Civil date, `YYYY-MM-DD`. */
  date: string;
  /** The Hebrew date that falls on it, e.g. `12 Iyyar 5786`. */
  hebrewDate: string;
  /** What it is — a holiday name, or the anniversary description we were given. */
  title: string;
  /** `holiday` | `anniversary` — the agent treats the two differently. */
  kind: 'holiday' | 'anniversary';
  /** Days from now. Negative never happens; the search starts today. */
  inDays: number;
}

function ymd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysBetween(from: Date, to: Date): number {
  const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

/**
 * Jewish holidays in the next `days`, filtered to the ones a couple might mark.
 *
 * Deliberately not every entry in the calendar: Rosh Chodesh and the minor fasts
 * are real but not occasions anyone plans a dinner around, and listing them
 * would bury Purim and Tu BiShvat in noise the model then has to sift.
 */
export function upcomingHolidays(from: Date, days = 90): Occasion[] {
  const events = HebrewCalendar.calendar({
    start: from,
    end: new Date(from.getTime() + days * 86_400_000),
    il: true,
    noRoshChodesh: true,
    noMinorFast: true,
    noSpecialShabbat: true,
    noModern: false,
  });

  return events
    .filter((e) => e.getFlags() !== 0)
    .map((e) => {
      const greg = e.getDate().greg();
      return {
        date: ymd(greg),
        hebrewDate: e.getDate().toString(),
        title: e.render('en'),
        kind: 'holiday' as const,
        inDays: daysBetween(from, greg),
      };
    })
    .filter((o) => o.inDays >= 0);
}

/**
 * When a Hebrew-date anniversary next falls on the civil calendar.
 *
 * This is the function the whole integration is for. Given the civil date of the
 * original event, it reads off the Hebrew date and then asks when *that* next
 * comes round — which is not "the same civil date", and is what a couple who
 * married on 12 Iyyar actually celebrates.
 *
 * Returns the next `count` occurrences, so the agent can say "this year it's the
 * 28th of April, next year the 17th" and be believed.
 */
export function hebrewAnniversaries(
  originalDate: Date,
  from: Date,
  title: string,
  count = 2,
): Occasion[] {
  const original = new HDate(originalDate);
  const day = original.getDate();
  const month = original.getMonth();
  const found: Occasion[] = [];

  // Walk Hebrew years forward from the one `from` sits in. Two extra years of
  // slack covers Adar in a leap year, where 30 Adar I simply does not exist and
  // hebcal moves the date rather than inventing a day.
  const startYear = new HDate(from).getFullYear();
  for (let year = startYear; year <= startYear + count + 2 && found.length < count; year += 1) {
    const candidate = safeHDate(day, month, year);
    if (!candidate) continue;
    const greg = candidate.greg();
    const inDays = daysBetween(from, greg);
    if (inDays < 0) continue;
    found.push({
      date: ymd(greg),
      hebrewDate: candidate.toString(),
      title,
      kind: 'anniversary',
      inDays,
    });
  }
  return found;
}

/**
 * Build an HDate, or nothing when that day does not exist in that year.
 *
 * Cheshvan and Kislev vary in length and Adar I exists only in leap years, so
 * `30 Kislev 5785` is a legitimate date and `30 Kislev 5784` is not. hebcal
 * throws on the impossible ones; skipping the year is the honest answer, and the
 * caller's loop has the slack to absorb it.
 */
function safeHDate(day: number, month: number, year: number): HDate | null {
  try {
    const hd = new HDate(day, month, year);
    // Guard against a silent roll-over: if hebcal normalised the day, this is
    // not the anniversary we were asked about.
    return hd.getDate() === day && hd.getMonth() === month ? hd : null;
  } catch {
    return null;
  }
}

/** The Hebrew date a civil date falls on, e.g. `12 Iyyar 5784`. */
export function hebrewDateOf(date: Date): string {
  return new HDate(date).toString();
}

/** Re-exported so tools can name a month without importing hebcal themselves. */
export { months as HEBREW_MONTHS };
