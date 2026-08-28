import type { Person } from '../../shared/interfaces/person';
import type { Task } from '../../shared/interfaces/task';
import { daysUntilBirthday } from './people-derivation';
import type { Occasion } from './occasion-derivation';
import { getDaysUntilOccasion, occasionFallsOnDay } from './occasion-derivation';
import type { RhythmEntry } from './list-field-parsing';

/**
 * The four weeks in front of him, as 28 cells.
 *
 * Four weeks rather than a month, and starting from *this* week's Monday rather
 * than from the 1st. A calendar month is an accounting period; four weeks from
 * today is the horizon a person actually plans a dinner inside. It also means the
 * grid never has leading blanks, so all 28 cells carry a date and the eye is not
 * asked to skip a hole.
 *
 * Everything drawn on it is real and comes from somewhere else in the app:
 * occasions from the date fields, birthdays from her people, deadlines from his
 * to-do list, and the faint dots from `weekly_rhythm` — the evenings she already
 * spends. Nothing here invents a marker.
 */

/** What a dot on a day means. */
export type DayMark =
  /** An occasion: her birthday, the anniversary. */
  | 'occasion'
  /** Someone on her family tree has a birthday. */
  | 'birthday'
  /** Something on his list is due. */
  | 'deadline'
  /** Her own week: pottery Tuesdays, her mother's Sunday call. */
  | 'rhythm';

export interface CalendarDay {
  /** Local midnight, so `isToday` compares like with like. */
  date: Date;
  /** 1–31, as drawn. */
  dayOfMonth: number;
  /** `'Sep'` on the first of a month, else null — the grid's only month cue. */
  monthLabel: string | null;
  isToday: boolean;
  /** Behind him. Drawn faintly rather than hidden: a week has a shape. */
  isPast: boolean;
  /**
   * The one lit cell in four weeks: the next occasion, if it lands inside them.
   *
   * At most one. Two focal points in a four-week grid is none.
   */
  isKey: boolean;
  /** A day something is due — the amber cell. */
  isDeadline: boolean;
  /** `'5th'` on a milestone anniversary, else null. */
  note: string | null;
  marks: DayMark[];
}

export interface FourWeeks {
  /** Four rows of seven, Monday first. */
  weeks: CalendarDay[][];
  /** `'24 Aug – 20 Sep'` — the head's own subtitle. */
  range: string;
}

export interface FourWeeksInput {
  now?: Date;
  occasions?: Occasion[];
  people?: Person[];
  tasks?: Task[];
  rhythm?: RhythmEntry[];
}

const DAY_MS = 86_400_000;

/** The Monday of the week `date` falls in, at local midnight. */
export function startOfWeek(date: Date): Date {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // `getDay()` is 0 for Sunday, and the grid is Monday-first, so Sunday is 6
  // days *into* its week rather than at the start of the next one.
  const offset = (midnight.getDay() + 6) % 7;
  return new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - offset);
}

/**
 * `'the 5th'` for a milestone: how many years this occasion has been running.
 *
 * Only for annual occasions with a year behind them, and only when the count is
 * at least one — "the 0th anniversary" is what a first anniversary would read as
 * otherwise.
 */
function milestoneNote(occasion: Occasion, on: Date): string | null {
  if (occasion.recurrence !== 'annual') return null;
  const years = on.getFullYear() - occasion.date.getFullYear();
  if (years < 1) return null;
  return `${years}${ordinalSuffix(years)}`;
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  if (n % 10 === 1) return 'st';
  if (n % 10 === 2) return 'nd';
  if (n % 10 === 3) return 'rd';
  return 'th';
}

/** `'24 Aug'`, in the grid's own voice. */
function shortDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Whether a task is due on this exact day.
 *
 * A `due` is a bare `YYYY-MM-DD`, so it is compared as a string against the
 * cell's own date rather than by parsing it into a `Date` — which would read as
 * UTC midnight and land a day early for anyone west of Greenwich.
 */
function isDueOn(task: Task, isoDay: string): boolean {
  return !task.done && task.due === isoDay;
}

/** The local date as `YYYY-MM-DD`, which is what a `due` is stored as. */
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function buildFourWeeks({
  now = new Date(),
  occasions = [],
  people = [],
  tasks = [],
  rhythm = [],
}: FourWeeksInput = {}): FourWeeks {
  const first = startOfWeek(now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  /*
   * The one occasion allowed to light a cell: the soonest one that falls inside
   * the four weeks. Computed once here rather than per cell, because "the next
   * one" is a fact about the whole grid.
   */
  const horizon = 28;
  const key = occasions
    .map((occasion) => ({ occasion, days: getDaysUntilOccasion(occasion, now) }))
    .filter((entry) => entry.days >= 0 && entry.days < horizon)
    .sort((a, b) => a.days - b.days)[0]?.occasion ?? null;

  const rhythmDays = new Set(rhythm.map((entry) => entry.weekday));

  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 4; week += 1) {
    const row: CalendarDay[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const index = week * 7 + offset;
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
      const marks: DayMark[] = [];

      const onThisDay = occasions.filter((occasion) =>
        occasionFallsOnDay(occasion, date.getFullYear(), date.getMonth(), date.getDate()),
      );
      if (onThisDay.length > 0) marks.push('occasion');

      // A birthday 0 days away *from this cell* is a birthday on this cell — the
      // same annual-recurrence rule the tree's chips use, so the two agree.
      const birthdayHere = people.some(
        (person) => person.birthday && daysUntilBirthday(person.birthday, date) === 0,
      );
      if (birthdayHere) marks.push('birthday');

      const day = isoDay(date);
      const isDeadline = tasks.some((task) => isDueOn(task, day));
      if (isDeadline) marks.push('deadline');

      if (rhythmDays.has(date.getDay())) marks.push('rhythm');

      const isKey = key !== null && onThisDay.some((occasion) => occasion === key);

      row.push({
        date,
        dayOfMonth: date.getDate(),
        monthLabel:
          date.getDate() === 1
            ? date.toLocaleDateString('en-GB', { month: 'short' })
            : null,
        isToday: date.getTime() === today,
        isPast: date.getTime() < today,
        isKey,
        // A cell cannot be both the occasion and its own deadline; the occasion
        // wins, because that is the day that matters and the amber ring would
        // fight the lit fill.
        isDeadline: isDeadline && !isKey,
        note: isKey && key ? milestoneNote(key, date) : null,
        marks,
      });
    }
    weeks.push(row);
  }

  const last = weeks[3][6].date;
  return { weeks, range: `${shortDate(first)} – ${shortDate(last)}` };
}

/** One line of the agenda under the grid. */
export interface AgendaRow {
  /** `'Fri 18'` — the day, as you would say it out loud. */
  when: string;
  title: string;
  detail: string | null;
  /** The pill on the right. `'the one'` is the next occasion; at most one row has it. */
  tone: 'key' | 'deadline' | 'plain';
  tag: string;
  /** Days from now, for ordering and for the tests to pin. */
  daysUntil: number;
}

/**
 * The three things next, under the grid.
 *
 * Occasions, family birthdays and dated to-dos in one ordered list rather than
 * three — the question the row answers is "what is coming", and splitting it by
 * where the fact is stored would make him read three lists to answer it.
 *
 * Three, because the grid above already shows the month and the rail already
 * counts the anniversary down. A fourth row is the first one nobody reads.
 */
export function buildAgenda({
  now = new Date(),
  occasions = [],
  people = [],
  tasks = [],
}: FourWeeksInput = {}, limit = 3): AgendaRow[] {
  const rows: AgendaRow[] = [];

  for (const occasion of occasions) {
    const daysUntil = getDaysUntilOccasion(occasion, now);
    if (daysUntil < 0) continue;
    rows.push({
      when: whenLabel(now, daysUntil),
      title: occasion.label,
      detail: null,
      tone: 'key',
      tag: daysUntil === 0 ? 'Today' : 'The one',
      daysUntil,
    });
  }

  for (const person of people) {
    if (!person.birthday) continue;
    const daysUntil = daysUntilBirthday(person.birthday, now);
    if (daysUntil === null) continue;
    rows.push({
      when: whenLabel(now, daysUntil),
      title: `${person.name ?? 'Someone'}’s birthday`,
      detail: person.relationship,
      tone: 'plain',
      tag: 'Card',
      daysUntil,
    });
  }

  for (const task of tasks) {
    if (task.done || !task.due) continue;
    const daysUntil = Math.round(
      (new Date(`${task.due}T00:00:00`).getTime() -
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
        DAY_MS,
    );
    if (daysUntil < 0) continue;
    rows.push({
      when: whenLabel(now, daysUntil),
      title: task.title,
      detail: task.note ?? null,
      tone: 'deadline',
      tag: 'Deadline',
      daysUntil,
    });
  }

  return rows.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, limit);
}

/** `'Fri 18'`, or `'Today'` when it is. */
function whenLabel(now: Date, daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil);
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}
