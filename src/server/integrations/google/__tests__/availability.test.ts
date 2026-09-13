import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../config';
import { busyInterval, instantOf, mergeIntervals, overlaps } from '../availability';
import { resetGoogleTokenCache, type CalendarEvent } from '../client';
import { findOccasionsTool, proposeCalendarEventTool } from '../tools';

/**
 * The availability check, and the two bugs that made it necessary.
 *
 * The scenario throughout is the real one that broke a demo: Monday 14 September
 * 2026 is blocked out 08:00–16:00, and a dinner is asked for at 13:00. Before this
 * check existed, `propose_calendar_event` never read the diary, so the card was
 * offered and the clash was the user's problem to notice.
 *
 * The timezone assertions are deliberately written as epoch comparisons against an
 * explicit `+03:00`/`+02:00` offset. That makes them independent of whatever
 * timezone the test runner is in, which is the whole point: the reason this class
 * of bug survived so long is that a laptop set to Asia/Jerusalem agrees with the
 * data by coincidence, and the container it ships in — running UTC — does not.
 */

interface Call {
  url: string;
  method: string;
  body: string | null;
}

let calls: Call[] = [];

function stubFetch(responder: (url: string, method: string) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null });

      const payload = responder(url, method);
      if (payload === undefined) {
        return { ok: false, status: 400, json: async () => ({}), text: async () => '{}' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      };
    }),
  );
}

const TOKEN_OK = { access_token: 'ya29.fake', expires_in: 3599 };

const CALENDAR_LIST = {
  items: [{ id: 'primary', summary: 'koralsteinberg@gmail.com', primary: true }],
};

/** The working day that the demo kept booking dinner inside. */
const SIVUS = {
  id: 'ev-sivus',
  summary: 'סיבוס',
  start: { dateTime: '2026-09-14T08:00:00+03:00' },
  end: { dateTime: '2026-09-14T16:00:00+03:00' },
};

/** A holiday feed entry: all-day and published as "free". */
const HOLIDAY = {
  id: 'ev-holiday',
  summary: 'Rosh Hashana (Day 2)',
  start: { date: '2026-09-14' },
  end: { date: '2026-09-15' },
  transparency: 'transparent',
};

function stubCalendar(items: unknown[]): void {
  stubFetch((url, method) => {
    if (url.includes('oauth2.googleapis.com/token')) return TOKEN_OK;
    if (url.includes('/users/me/calendarList')) return CALENDAR_LIST;
    if (url.includes('/events') && method === 'POST') return { id: 'created-1', htmlLink: 'x' };
    if (url.includes('/events')) return { items };
    return undefined;
  });
}

const ctx = { sessionId: 'session-1', userId: 'user-1' };

beforeEach(() => {
  calls = [];
  resetGoogleTokenCache();
  config.integrations.googleClientId = 'gid';
  config.integrations.googleClientSecret = 'gsecret';
  config.integrations.googleRefreshToken = 'grefresh';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('instantOf', () => {
  it('reads a bare local time in Israel, not in the process timezone', () => {
    // The assertion that would have caught the deployment bug: under UTC the old
    // `new Date('2026-09-14T13:00:00')` was three hours adrift from this.
    expect(instantOf('2026-09-14T13:00:00')).toBe(Date.parse('2026-09-14T13:00:00+03:00'));
  });

  it('follows Israel across the DST boundary', () => {
    expect(instantOf('2026-12-01T13:00:00')).toBe(Date.parse('2026-12-01T13:00:00+02:00'));
  });

  it('trusts an offset that Google already supplied', () => {
    expect(instantOf('2026-09-14T08:00:00+03:00')).toBe(Date.parse('2026-09-14T05:00:00Z'));
  });

  it('returns null for something that is not a time', () => {
    expect(instantOf('next tuesday')).toBeNull();
  });
});

describe('busyInterval', () => {
  const base: CalendarEvent = {
    id: 'e',
    summary: 'Work',
    start: '2026-09-14T08:00:00+03:00',
    end: '2026-09-14T16:00:00+03:00',
    allDay: false,
    busy: true,
  };

  it('measures a timed, busy event', () => {
    expect(busyInterval(base)).toEqual({
      startMs: Date.parse('2026-09-14T08:00:00+03:00'),
      endMs: Date.parse('2026-09-14T16:00:00+03:00'),
    });
  });

  it('ignores an all-day entry, which cannot double-book an evening', () => {
    expect(busyInterval({ ...base, allDay: true, start: '2026-09-14', end: '2026-09-15' })).toBeNull();
  });

  it('ignores an entry marked free', () => {
    expect(busyInterval({ ...base, busy: false })).toBeNull();
  });

  it('ignores a zero-length entry', () => {
    expect(busyInterval({ ...base, end: base.start })).toBeNull();
  });
});

describe('overlaps', () => {
  const day = { startMs: 100, endMs: 200 };

  it('is true when the two genuinely intersect', () => {
    expect(overlaps(day, { startMs: 150, endMs: 250 })).toBe(true);
  });

  it('is false when one starts exactly as the other ends', () => {
    // A dinner at 16:00 after a day that ends at 16:00 is not a clash.
    expect(overlaps(day, { startMs: 200, endMs: 300 })).toBe(false);
  });

  it('is true when one contains the other', () => {
    expect(overlaps(day, { startMs: 120, endMs: 130 })).toBe(true);
  });
});

describe('mergeIntervals', () => {
  it('coalesces overlapping and abutting spans', () => {
    expect(
      mergeIntervals([
        { startMs: 300, endMs: 400 },
        { startMs: 100, endMs: 200 },
        { startMs: 150, endMs: 320 },
      ]),
    ).toEqual([{ startMs: 100, endMs: 400 }]);
  });

  it('keeps genuinely separate spans apart', () => {
    expect(
      mergeIntervals([
        { startMs: 100, endMs: 200 },
        { startMs: 500, endMs: 600 },
      ]),
    ).toEqual([
      { startMs: 100, endMs: 200 },
      { startMs: 500, endMs: 600 },
    ]);
  });
});

describe('propose_calendar_event against a busy diary', () => {
  it('refuses the taken slot, names the clash and offers free times', async () => {
    stubCalendar([SIVUS, HOLIDAY]);

    const result = await proposeCalendarEventTool.execute(
      { title: 'Dinner at NOEMA', date: '2026-09-14', time: '13:00', duration_minutes: 120 },
      ctx as never,
    );

    expect(result.ok).toBe(true);
    // No card: the whole point is that the user is asked before anything is offered.
    expect(result.proposal).toBeUndefined();
    expect(result.summary).toContain('סיבוס');
    // The end time is what makes the clash legible, and Israel time is what makes
    // it correct — 05:00 here would be the container's UTC talking.
    expect(result.summary).toContain('08:00–16:00');

    expect(result.summary).toContain('16:00, 18:00 or 20:00');

    const data = result.data as { conflict: boolean; alternatives: string[] };
    expect(data.conflict).toBe(true);
    // The gap after the working day, spread out rather than every half hour.
    expect(data.alternatives).toEqual(['16:00', '18:00', '20:00']);
  });

  it('never writes to Google while reporting a clash', async () => {
    stubCalendar([SIVUS]);

    await proposeCalendarEventTool.execute(
      { title: 'Dinner', date: '2026-09-14', time: '13:00' },
      ctx as never,
    );

    expect(calls.filter((call) => call.method === 'POST' && call.url.includes('/events'))).toEqual([]);
  });

  it('offers the card when the slot only touches the busy block', async () => {
    stubCalendar([SIVUS]);

    const result = await proposeCalendarEventTool.execute(
      { title: 'Dinner at NOEMA', date: '2026-09-14', time: '16:00', duration_minutes: 120 },
      ctx as never,
    );

    expect(result.proposal).toBeDefined();
    expect(result.data).toMatchObject({ when: 'Monday 14 September at 16:00' });
  });

  it('treats an all-day holiday as context, not as a clash', async () => {
    stubCalendar([HOLIDAY]);

    const result = await proposeCalendarEventTool.execute(
      { title: 'Dinner at NOEMA', date: '2026-09-14', time: '20:00' },
      ctx as never,
    );

    expect(result.proposal).toBeDefined();
  });

  it('books over the clash once the user has said to', async () => {
    stubCalendar([SIVUS]);

    const result = await proposeCalendarEventTool.execute(
      { title: 'Dinner', date: '2026-09-14', time: '13:00', ignore_conflicts: true },
      ctx as never,
    );

    expect(result.proposal).toBeDefined();
  });

  it('still offers the card when the calendar cannot be read at all', async () => {
    // A Google outage must not be able to stop the app offering to book something.
    stubFetch((url) => (url.includes('oauth2.googleapis.com/token') ? TOKEN_OK : undefined));

    const result = await proposeCalendarEventTool.execute(
      { title: 'Dinner', date: '2026-09-14', time: '13:00' },
      ctx as never,
    );

    expect(result.proposal).toBeDefined();
  });

  it('does not check availability for an all-day entry', async () => {
    stubCalendar([SIVUS]);

    const result = await proposeCalendarEventTool.execute(
      { title: 'Our anniversary', date: '2026-09-14' },
      ctx as never,
    );

    expect(result.proposal).toBeDefined();
    expect(calls.some((call) => call.url.includes('/events') && call.method === 'GET')).toBe(false);
  });
});

describe('find_occasions reporting times', () => {
  it('reports the span in Israel time rather than the process timezone', async () => {
    stubCalendar([SIVUS]);

    const result = await findOccasionsTool.execute({ days_ahead: 400 }, ctx as never);

    expect(result.summary).toContain('08:00–16:00');
  });
});
