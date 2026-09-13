import { REMINDER_ZONE } from '../../../shared/interfaces/reminder';
import { inZone, parseInZone } from '../hebcal/client';
import { listEvents, type CalendarEvent } from './client';

/**
 * Is the user actually free then, and if not, when are they.
 *
 * Split out of `tools.ts` because it is the one part of the calendar path worth
 * testing without a network: the interesting behaviour is interval arithmetic, and
 * the bug it exists to prevent was arithmetic that was never performed at all.
 * `propose_calendar_event` used to build its card straight from the model's
 * arguments — it never read the diary — so a 13:00 dinner was offered on a day
 * blocked out 08:00–16:00 and the first anyone heard of the clash was the user.
 *
 * Everything here works in {@link REMINDER_ZONE} rather than the process timezone,
 * which matters more in deployment than locally: the container runs in UTC, so
 * comparing a bare `2026-09-14T13:00` against Google's `08:00:00+03:00` through
 * `new Date` puts the two three hours apart and finds no clash.
 */

/** A half-open interval in epoch milliseconds — `[startMs, endMs)`. */
export interface Interval {
  startMs: number;
  endMs: number;
}

/** Earliest a suggestion will put something, as a local hour. */
const DAY_OPENS_HOUR = 8;

/** Latest a suggestion will let something *end*, as a local hour. */
const DAY_CLOSES_HOUR = 23;

/** Suggested starts land on the half hour; nobody books a table at 16:07. */
const SLOT_STEP_MS = 30 * 60 * 1000;

/** Minimum spacing between two suggestions, so they are real alternatives. */
const SPREAD_MS = 2 * 60 * 60 * 1000;

/** How many alternative starts to hand back at most. */
const MAX_ALTERNATIVES = 3;

/**
 * The instant a calendar string names.
 *
 * Google's timed events carry their own UTC offset, so `Date.parse` is exact and
 * is used whenever one is present — that also keeps a flight booked in US time in
 * the right place. The proposal path deliberately builds *bare* local strings
 * (`2026-09-14T13:00:00`, no offset, see `addMinutes` in `tools.ts`), and those are
 * resolved in `zone`, never in whatever timezone the process happens to run in.
 */
export function instantOf(value: string, zone: string = REMINDER_ZONE): number | null {
  const text = value.trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const at = parseInZone(text, zone);
  return at === null ? null : at.getTime();
}

/**
 * The interval an event actually occupies, or null if it occupies nothing.
 *
 * Null for three kinds of entry, each for its own reason: an all-day entry (Yom
 * Kippur is context for a suggestion, not a double booking), anything Google marks
 * "free", and a zero-length or reversed entry, which cannot overlap anything under
 * a half-open comparison anyway.
 */
export function busyInterval(event: CalendarEvent, zone: string = REMINDER_ZONE): Interval | null {
  if (event.allDay || !event.busy) return null;

  const startMs = instantOf(event.start, zone);
  const endMs = instantOf(event.end, zone);
  if (startMs === null || endMs === null || endMs <= startMs) return null;

  return { startMs, endMs };
}

/**
 * Half-open overlap, so touching edges do not clash.
 *
 * This is the difference between "your day ends at 16:00 and dinner starts at
 * 16:00" being fine and being refused, and it is deliberate.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** Coalesce overlapping and abutting intervals into a sorted, disjoint list. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
      continue;
    }
    merged.push({ ...interval });
  }

  return merged;
}

/** Round up to the next half hour. */
function roundUpToSlot(atMs: number): number {
  return Math.ceil(atMs / SLOT_STEP_MS) * SLOT_STEP_MS;
}

/**
 * Every half-hour start inside the day's free gaps that leaves room for `durationMs`.
 *
 * Walks the merged busy list once, treating the space before, between and after
 * as candidate gaps, clamped to the day's opening hours.
 */
function freeStarts(
  busy: Interval[],
  opensMs: number,
  closesMs: number,
  durationMs: number,
): number[] {
  const starts: number[] = [];

  const collect = (fromMs: number, toMs: number): void => {
    for (let at = roundUpToSlot(Math.max(fromMs, opensMs)); at + durationMs <= toMs; at += SLOT_STEP_MS) {
      starts.push(at);
    }
  };

  let cursor = opensMs;
  for (const interval of mergeIntervals(busy)) {
    if (interval.startMs > cursor) collect(cursor, Math.min(interval.startMs, closesMs));
    cursor = Math.max(cursor, interval.endMs);
    if (cursor >= closesMs) return starts;
  }
  collect(cursor, closesMs);

  return starts;
}

/**
 * Thin `starts` down to a few genuinely different options.
 *
 * Preferring starts at or after the time that was asked for is the whole point —
 * being told "you're busy, how about four hours earlier" is not a reschedule. When
 * nothing later fits, the latest earlier slots are better than nothing.
 */
function spread(starts: number[], preferFromMs: number): number[] {
  const later = starts.filter((at) => at >= preferFromMs);
  const pool = later.length > 0 ? later : [...starts].reverse();

  const picked: number[] = [];
  for (const at of pool) {
    if (picked.length >= MAX_ALTERNATIVES) break;
    const last = picked[picked.length - 1];
    if (last !== undefined && Math.abs(at - last) < SPREAD_MS) continue;
    picked.push(at);
  }

  return picked.sort((a, b) => a - b);
}

/** The day after a `YYYY-MM-DD`, as a `YYYY-MM-DD`. */
function nextDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

export interface AvailabilityReport {
  /** Busy, timed entries the proposed slot runs into. Empty means it is free. */
  clashes: CalendarEvent[];
  /** Local `HH:MM` starts that are free that day, nearest the asked-for time first. */
  alternatives: string[];
  /** All-day entries on the day — context for a suggestion, never a clash. */
  context: CalendarEvent[];
}

/**
 * Read the day and report what the proposed slot runs into.
 *
 * `null` — not an empty report — when the calendar could not be read at all, so
 * the caller can tell "you are free" from "I could not check". A Google outage
 * must not be able to stop the app offering to book something; it should only stop
 * it claiming the slot was verified.
 */
export async function checkAvailability(input: {
  /** Bare local start, `YYYY-MM-DDTHH:MM:00`. */
  startLocal: string;
  /** Bare local end, `YYYY-MM-DDTHH:MM:00`. */
  endLocal: string;
  zone?: string;
}): Promise<AvailabilityReport | null> {
  const zone = input.zone ?? REMINDER_ZONE;
  const startMs = instantOf(input.startLocal, zone);
  const endMs = instantOf(input.endLocal, zone);
  if (startMs === null || endMs === null || endMs <= startMs) return null;

  const date = input.startLocal.slice(0, 10);
  const dayStartMs = instantOf(`${date}T00:00`, zone);
  const dayEndMs = instantOf(`${nextDay(date)}T00:00`, zone);
  const opensMs = instantOf(`${date}T${String(DAY_OPENS_HOUR).padStart(2, '0')}:00`, zone);
  const closesMs = instantOf(`${date}T${String(DAY_CLOSES_HOUR).padStart(2, '0')}:00`, zone);
  if (dayStartMs === null || dayEndMs === null || opensMs === null || closesMs === null) return null;

  // One day is a small enough window that the per-calendar budget cannot bind, so
  // unlike `find_occasions` this sees the whole day rather than a fair sample of it.
  const events = await listEvents({
    timeMin: new Date(dayStartMs).toISOString(),
    timeMax: new Date(dayEndMs).toISOString(),
    limit: 100,
  });
  if (events === null) return null;

  const proposed: Interval = { startMs, endMs };
  const busy: Interval[] = [];
  const clashes: CalendarEvent[] = [];

  for (const event of events) {
    const interval = busyInterval(event, zone);
    if (interval === null) continue;
    busy.push(interval);
    if (overlaps(interval, proposed)) clashes.push(event);
  }

  const alternatives =
    clashes.length === 0
      ? []
      : spread(freeStarts(busy, opensMs, closesMs, endMs - startMs), startMs).map(
          (at) => inZone(new Date(at), zone).localTime,
        );

  return {
    clashes,
    alternatives,
    context: events.filter((event) => event.allDay),
  };
}
