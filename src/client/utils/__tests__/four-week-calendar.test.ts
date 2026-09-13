import { describe, it, expect } from 'vitest';
import type { Person } from '../../../shared/interfaces/person';
import type { Task } from '../../../shared/interfaces/task';
import type { Occasion } from '../occasion-derivation';
import type { Reminder } from '../../../shared/interfaces/reminder';
import { buildAgenda, buildFourWeeks, startOfWeek } from '../four-week-calendar';

/** A Friday, so the Monday-first arithmetic has something to get wrong. */
const NOW = new Date(2026, 7, 28, 9, 0, 0);

function occasion(overrides: Partial<Occasion> = {}): Occasion {
  return {
    fieldId: 'anniversary',
    label: 'Your anniversary',
    date: new Date(2021, 8, 18),
    recurrence: 'annual',
    ...overrides,
  };
}

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'anniversary-2026-09-18',
    sessionId: 'sess-1',
    userId: 'user-1',
    kind: 'anniversary',
    occursOn: '2026-09-18',
    dueAt: '2026-09-11T05:30:00.000Z',
    leadDays: 7,
    occasion: 'your anniversary',
    channel: 'gmail',
    target: 'him@example.com',
    sentAt: null,
    attempts: 0,
    lastError: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'yosef',
    name: 'Yosef',
    relationship: "uncle, mother's side",
    generation: 'elder',
    birthday: '1958-09-12',
    note: null,
    source: 'manual',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'book',
    title: 'Book whatever she picks',
    due: '2026-09-11',
    note: null,
    done: false,
    source: 'manual',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('startOfWeek', () => {
  it('is the Monday of the week the date falls in', () => {
    expect(startOfWeek(NOW).getDate()).toBe(24);
    expect(startOfWeek(NOW).getDay()).toBe(1);
  });

  it('treats Sunday as the end of its week, not the start of the next', () => {
    // `getDay()` is 0 for Sunday, so the naive offset sends Sunday forward six days
    // and the grid opens on the wrong week.
    const sunday = new Date(2026, 7, 30);
    expect(startOfWeek(sunday).getDate()).toBe(24);
  });
});

describe('buildFourWeeks', () => {
  it('is 28 dated cells with no leading blanks', () => {
    const { weeks } = buildFourWeeks({ now: NOW });
    expect(weeks).toHaveLength(4);
    expect(weeks.flat()).toHaveLength(28);
    // Four weeks from *this week's Monday*, not from the 1st: the grid never asks
    // the eye to skip a hole.
    expect(weeks[0][0].dayOfMonth).toBe(24);
    expect(weeks[3][6].dayOfMonth).toBe(20);
  });

  it('marks exactly one cell today, and the ones behind it as past', () => {
    const days = buildFourWeeks({ now: NOW }).weeks.flat();
    expect(days.filter((day) => day.isToday)).toHaveLength(1);
    expect(days.find((day) => day.isToday)?.dayOfMonth).toBe(28);
    expect(days.filter((day) => day.isPast)).toHaveLength(4);
  });

  it('names the range in the head’s own voice', () => {
    expect(buildFourWeeks({ now: NOW }).range).toMatch(/^24 Aug – 20 Sept?$/);
  });

  it('lights exactly one cell — the next occasion inside the four weeks', () => {
    const days = buildFourWeeks({ now: NOW, occasions: [occasion()] }).weeks.flat();
    const lit = days.filter((day) => day.isKey);
    expect(lit).toHaveLength(1);
    expect(lit[0].dayOfMonth).toBe(18);
    // Five years since 2021: the cell says which anniversary it is.
    expect(lit[0].note).toBe('5th');
  });

  it('lights nothing when the next occasion is beyond the horizon', () => {
    // Two focal points in four weeks is none, and one outside them is a claim
    // about a month the grid does not show.
    const days = buildFourWeeks({
      now: NOW,
      occasions: [occasion({ fieldId: 'birthday', date: new Date(1994, 5, 12) })],
    }).weeks.flat();
    expect(days.filter((day) => day.isKey)).toHaveLength(0);
  });

  it('dots a relative’s birthday on the day it falls, whatever year it was', () => {
    const days = buildFourWeeks({ now: NOW, people: [person()] }).weeks.flat();
    const twelfth = days.find((day) => day.dayOfMonth === 12 && day.date.getMonth() === 8);
    expect(twelfth?.marks).toContain('birthday');
  });

  it('rings a day something is due, and lets the occasion win when they collide', () => {
    const days = buildFourWeeks({
      now: NOW,
      occasions: [occasion()],
      tasks: [task(), task({ id: 'on-the-day', due: '2026-09-18' })],
    }).weeks.flat();

    const eleventh = days.find((day) => day.dayOfMonth === 11 && day.date.getMonth() === 8);
    expect(eleventh?.isDeadline).toBe(true);

    // The lit fill and an amber ring on the same cell fight; the day that matters
    // wins and keeps its fill.
    const eighteenth = days.find((day) => day.isKey);
    expect(eighteenth?.isDeadline).toBe(false);
    expect(eighteenth?.marks).toContain('deadline');
  });

  it('ignores a to-do he has already ticked', () => {
    const days = buildFourWeeks({ now: NOW, tasks: [task({ done: true })] }).weeks.flat();
    expect(days.some((day) => day.isDeadline)).toBe(false);
  });

  it('dots every occurrence of an evening she already spends', () => {
    const days = buildFourWeeks({
      now: NOW,
      rhythm: [{ weekday: 2, label: 'pottery', weight: 'heavy' }],
    }).weeks.flat();
    // Four Tuesdays in four weeks.
    expect(days.filter((day) => day.marks.includes('rhythm'))).toHaveLength(4);
  });

  /*
   * The marker the grid could not draw before: the morning he actually hears about it.
   *
   * `dueAt` is a UTC instant and the cell is a local day, so the comparison is made
   * through Asia/Jerusalem — 05:30Z on the 11th is 08:30 there on the 11th. Read in a
   * browser west of Israel, a naive conversion lands the dot on the 10th.
   */
  it('dots the day a reminder actually goes out', () => {
    const days = buildFourWeeks({
      now: NOW,
      reminders: [reminder({ dueAt: '2026-09-11T05:30:00.000Z' })],
    }).weeks.flat();

    const marked = days.filter((day) => day.marks.includes('reminder'));
    expect(marked).toHaveLength(1);
    expect(marked[0].dayOfMonth).toBe(11);
  });

  // The whole point of a separate mark: the occasion and the notice about it are two
  // different facts, and a same-day reminder puts both on one cell.
  it('keeps the reminder dot distinct from the occasion’s own', () => {
    const days = buildFourWeeks({
      now: NOW,
      occasions: [occasion()],
      reminders: [reminder({ dueAt: '2026-09-18T05:30:00.000Z' })],
    }).weeks.flat();

    const eighteenth = days.find((day) => day.dayOfMonth === 18 && day.date.getMonth() === 8);
    expect(eighteenth?.marks).toContain('occasion');
    expect(eighteenth?.marks).toContain('reminder');
  });

  it('does not dot a reminder that has already gone out', () => {
    const days = buildFourWeeks({
      now: NOW,
      reminders: [
        reminder({ dueAt: '2026-09-11T05:30:00.000Z', sentAt: '2026-09-11T05:30:01.000Z' }),
      ],
    }).weeks.flat();

    expect(days.some((day) => day.marks.includes('reminder'))).toBe(false);
  });

  it('labels only the first of a month, which is the grid’s one month cue', () => {
    const days = buildFourWeeks({ now: NOW }).weeks.flat();
    const labelled = days.filter((day) => day.monthLabel !== null);
    expect(labelled).toHaveLength(1);
    expect(labelled[0].dayOfMonth).toBe(1);
  });
});

describe('buildAgenda', () => {
  it('merges the three sources into one ordered list', () => {
    // The question the rows answer is "what is coming"; splitting it by where the
    // fact is stored would make him read three lists to answer it.
    const rows = buildAgenda({
      now: NOW,
      occasions: [occasion()],
      people: [person()],
      tasks: [task()],
    });
    expect(rows.map((row) => row.daysUntil)).toEqual([14, 15, 21]);
    expect(rows.map((row) => row.tone)).toEqual(['deadline', 'plain', 'key']);
  });

  it('shows three rows and no more', () => {
    const rows = buildAgenda({
      now: NOW,
      tasks: [
        task({ id: 'a', due: '2026-08-29' }),
        task({ id: 'b', due: '2026-08-30' }),
        task({ id: 'c', due: '2026-08-31' }),
        task({ id: 'd', due: '2026-09-01' }),
      ],
    });
    expect(rows).toHaveLength(3);
  });

  it('says Today rather than naming the weekday for something due now', () => {
    const rows = buildAgenda({ now: NOW, tasks: [task({ due: '2026-08-28' })] });
    expect(rows[0].when).toBe('Today');
    expect(rows[0].tag).toBe('Deadline');
  });

  it('drops what has already gone past rather than listing it as coming', () => {
    expect(buildAgenda({ now: NOW, tasks: [task({ due: '2026-08-01' })] })).toEqual([]);
  });
});
