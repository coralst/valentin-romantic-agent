import { describe, expect, it } from 'vitest';
import { buildEventTimeline, relativeDayLabel } from '../event-timeline';
import type { Occasion } from '../occasion-derivation';
import type { Outing } from '../../../shared/interfaces/outing';
import type { Reminder } from '../../../shared/interfaces/reminder';

/** Every case stands at the same day, so no label here depends on the clock. */
const NOW = new Date(2026, 8, 5, 12, 0, 0); // Saturday 5 September 2026

function outing(partial: Partial<Outing> & { id: string; venueName: string }): Outing {
  return {
    confirmedAt: '2026-08-20T18:00:00.000Z',
    ...partial,
  };
}

const anniversary: Occasion = {
  fieldId: 'anniversary',
  label: 'Anniversary',
  date: new Date(2023, 8, 10),
  recurrence: 'annual',
};

/**
 * A pending reminder, as the server hands it back.
 *
 * `dueAt` is a UTC instant, and the assertions below read it in Asia/Jerusalem — 05:30Z
 * is 08:30 there in September, which is the send time the planner pins to.
 */
function reminder(partial: Partial<Reminder> & { id: string; kind: Reminder['kind'] }): Reminder {
  return {
    sessionId: 'sess-1',
    userId: 'user-1',
    occursOn: '2026-09-10',
    dueAt: '2026-09-03T05:30:00.000Z',
    leadDays: 7,
    occasion: 'her anniversary',
    channel: 'gmail',
    target: 'him@example.com',
    sentAt: null,
    attempts: 0,
    lastError: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

describe('buildEventTimeline with reminders', () => {
  /*
   * The reminder annotates the date rather than sitting beside it.
   *
   * A birthday reminder and the birthday are the same date said twice; two rows would
   * read as two events. What the row gains is the one thing the page could not say
   * before — whether he will actually be told, and when.
   */
  it('hangs an armed reminder off the occasion it is about', () => {
    const timeline = buildEventTimeline({
      occasions: [anniversary],
      outings: [],
      reminders: [reminder({ id: 'anniversary-2026-09-10', kind: 'anniversary' })],
      now: NOW,
    });

    expect(timeline.upcoming).toHaveLength(1);
    const [entry] = timeline.upcoming;
    expect(entry.kind).toBe('occasion');
    expect(entry.remindsAt).toBe('Thursday 3 September at 08:30');
    expect(entry.reminderId).toBe('anniversary-2026-09-10');
    expect(entry.reminderKind).toBe('anniversary');
  });

  // The state that used to be indistinguishable from "reminder armed": a date on her
  // profile with nothing watching it.
  it('says nothing about a reminder when none is armed for the date', () => {
    const timeline = buildEventTimeline({ occasions: [anniversary], outings: [], now: NOW });

    expect(timeline.upcoming[0].remindsAt).toBeNull();
    expect(timeline.upcoming[0].reminderId).toBeNull();
  });

  /*
   * An errand has no other representation anywhere on the page. Before this it existed
   * only inside the sentence `set_reminder` returned, so he could be told it was set
   * and then find no trace of it.
   */
  it('gives a hand-set reminder a row of its own, titled in his words', () => {
    const timeline = buildEventTimeline({
      occasions: [],
      outings: [],
      reminders: [
        reminder({
          id: 'custom-2026-09-12-abcd1234',
          kind: 'custom',
          title: 'call the florist',
          occasion: 'call the florist',
          occursOn: '2026-09-12',
          dueAt: '2026-09-12T05:30:00.000Z',
          leadDays: 0,
        }),
      ],
      now: NOW,
    });

    expect(timeline.upcoming).toHaveLength(1);
    const [entry] = timeline.upcoming;
    expect(entry.kind).toBe('reminder');
    expect(entry.title).toBe('call the florist');
    // Placed on the day the florist is wanted, not the day the mail goes out — a row
    // at `dueAt` would file a week-ahead reminder a week early.
    expect(entry.when).toBe('Saturday 12 September');
    expect(entry.remindsAt).toBe('Saturday 12 September at 08:30');
  });

  // `next_occasion` is not a date-typed profile field, so an `occasion` reminder has no
  // occasion row to pair with and must not be silently dropped.
  it('gives an occasion reminder its own row, having nothing to pair with', () => {
    const timeline = buildEventTimeline({
      occasions: [],
      outings: [],
      reminders: [
        reminder({
          id: 'occasion-2026-09-20',
          kind: 'occasion',
          occasion: 'the promotion dinner',
          occursOn: '2026-09-20',
        }),
      ],
      now: NOW,
    });

    expect(timeline.upcoming.map((entry) => entry.kind)).toEqual(['reminder']);
    expect(timeline.upcoming[0].title).toBe('the promotion dinner');
  });

  it('leaves a reminder that has already been sent off the spine', () => {
    const timeline = buildEventTimeline({
      occasions: [anniversary],
      outings: [],
      reminders: [
        reminder({
          id: 'anniversary-2026-09-10',
          kind: 'anniversary',
          sentAt: '2026-09-03T05:30:01.000Z',
        }),
      ],
      now: NOW,
    });

    expect(timeline.upcoming[0].remindsAt).toBeNull();
  });

  it('drops a reminder about a day already behind us', () => {
    const timeline = buildEventTimeline({
      occasions: [],
      outings: [],
      reminders: [
        reminder({
          id: 'custom-2026-08-01-abcd1234',
          kind: 'custom',
          title: 'call the florist',
          occursOn: '2026-08-01',
          dueAt: '2026-08-01T05:30:00.000Z',
        }),
      ],
      now: NOW,
    });

    expect(timeline.upcoming).toEqual([]);
    expect(timeline.past).toEqual([]);
  });
});

describe('buildEventTimeline', () => {
  it('is empty when there is nothing to place', () => {
    const timeline = buildEventTimeline({ occasions: [], outings: [], now: NOW });

    expect(timeline.upcoming).toEqual([]);
    expect(timeline.past).toEqual([]);
  });

  it('puts an occasion ahead of today with its act-by deadline', () => {
    const timeline = buildEventTimeline({ occasions: [anniversary], outings: [], now: NOW });

    expect(timeline.upcoming).toHaveLength(1);
    const [entry] = timeline.upcoming;
    expect(entry.kind).toBe('occasion');
    expect(entry.title).toBe('Anniversary');
    expect(entry.daysFromToday).toBe(5);
    expect(entry.when).toBe('Thursday 10 September');
    expect(entry.actBy).toContain('Book by');
  });

  it('flags an occasion whose booking deadline has already passed', () => {
    // The anniversary is 5 days out and wants 7 days' notice, so the deadline is
    // behind us — the case the old planner used to silently drop.
    const timeline = buildEventTimeline({ occasions: [anniversary], outings: [], now: NOW });

    expect(timeline.upcoming[0].isUrgent).toBe(true);
  });

  it('files a table booked for a future night as a plan, not as a memory', () => {
    const timeline = buildEventTimeline({
      occasions: [],
      outings: [outing({ id: 'o1', venueName: 'Claro', occursOn: '2026-09-11' })],
      now: NOW,
    });

    expect(timeline.past).toHaveLength(0);
    expect(timeline.upcoming[0].kind).toBe('booking');
    expect(timeline.upcoming[0].daysFromToday).toBe(6);
  });

  it('files an evening that has happened as past, and carries its outing through', () => {
    const row = outing({ id: 'o2', venueName: "Ha'achim", city: 'Tel Aviv', occursOn: '2026-08-29' });
    const timeline = buildEventTimeline({ occasions: [], outings: [row], now: NOW });

    expect(timeline.upcoming).toHaveLength(0);
    expect(timeline.past[0].kind).toBe('outing');
    expect(timeline.past[0].place).toBe('Tel Aviv');
    expect(timeline.past[0].outing).toBe(row);
    expect(timeline.past[0].daysFromToday).toBe(-7);
  });

  it('treats tonight as past, so it can be rated in the morning', () => {
    const timeline = buildEventTimeline({
      occasions: [],
      outings: [outing({ id: 'o3', venueName: 'Tonight', occursOn: '2026-09-05' })],
      now: NOW,
    });

    expect(timeline.past).toHaveLength(1);
    expect(timeline.past[0].daysFromToday).toBe(0);
  });

  it('treats a row with no date as past, since only a confirmed booking makes one', () => {
    const timeline = buildEventTimeline({
      occasions: [],
      outings: [outing({ id: 'o4', venueName: 'Undated', occursOn: null })],
      now: NOW,
    });

    expect(timeline.past).toHaveLength(1);
    expect(timeline.upcoming).toHaveLength(0);
  });

  it('orders the upcoming half soonest first and the past half most recent first', () => {
    const timeline = buildEventTimeline({
      occasions: [anniversary],
      outings: [
        outing({ id: 'far', venueName: 'Far', occursOn: '2026-09-30' }),
        outing({ id: 'soon', venueName: 'Soon', occursOn: '2026-09-07' }),
        outing({ id: 'old', venueName: 'Old', occursOn: '2026-06-01' }),
        outing({ id: 'recent', venueName: 'Recent', occursOn: '2026-09-01' }),
      ],
      now: NOW,
    });

    expect(timeline.upcoming.map((entry) => entry.title)).toEqual([
      'Soon',
      'Anniversary',
      'Far',
    ]);
    expect(timeline.past.map((entry) => entry.title)).toEqual(['Recent', 'Old']);
  });

  it('drops a row whose stored date cannot be read rather than placing it wrongly', () => {
    const timeline = buildEventTimeline({
      occasions: [],
      outings: [outing({ id: 'bad', venueName: 'Nonsense', occursOn: 'not-a-date' })],
      now: NOW,
    });

    expect(timeline.upcoming).toHaveLength(0);
    expect(timeline.past).toHaveLength(0);
  });

  it('gives every entry a stable id namespaced by its source', () => {
    const timeline = buildEventTimeline({
      occasions: [anniversary],
      outings: [outing({ id: 'o5', venueName: 'Somewhere', occursOn: '2026-08-01' })],
      now: NOW,
    });

    expect(timeline.upcoming[0].id).toBe('occasion:anniversary');
    expect(timeline.past[0].id).toBe('outing:o5');
  });
});

describe('relativeDayLabel', () => {
  it('uses the words someone would actually say for the near days', () => {
    expect(relativeDayLabel(0)).toBe('today');
    expect(relativeDayLabel(1)).toBe('tomorrow');
    expect(relativeDayLabel(-1)).toBe('yesterday');
  });

  it('counts days forward and back', () => {
    expect(relativeDayLabel(5)).toBe('in 5 days');
    expect(relativeDayLabel(-7)).toBe('7 days ago');
  });

  it('coarsens as the past recedes, since nobody counts 94 days', () => {
    expect(relativeDayLabel(-21)).toBe('3 weeks ago');
    expect(relativeDayLabel(-94)).toBe('3 months ago');
  });
});
