/**
 * What he has to do next, for the demo profile.
 *
 * Six rows, two of them already ticked. The ticked pair is the point: a to-do
 * list whose demo shows only open items demonstrates a list, not a *memory*.
 * `done` is the one thing on the board that cannot be derived (see
 * `shared/interfaces/task.ts`), so the seed has to show it surviving.
 *
 * Dues are offsets in days, not dates. A fixture that hard-coded "2026-09-11"
 * would read as overdue for eleven months of every year, and the row states the
 * card actually renders — today, soon, later, undated — are exactly the ones a
 * frozen date destroys. `resolveDemoTasks` stamps them against the moment the
 * session is seeded, so a demo given in March looks like a demo given in
 * September.
 *
 * The offsets are not arbitrary: they sit a week either side of "now" so that
 * one row is due today, two are inside the next fortnight, one has no date at
 * all, and the two ticked ones are in the past. Every branch of the due-label
 * logic is on screen at once.
 *
 * `source` is mixed on purpose. A suggestion Valentin raised should not look
 * identical to a commitment the user typed, and a seed where all six read the
 * same way would never show the difference.
 */

import type { Task } from '../../shared/interfaces/task';

/** A seeded task, before its dates are resolved against the seed time. */
export interface DemoTask extends Omit<Task, 'due' | 'createdAt' | 'updatedAt'> {
  /** Days from the seed moment. Negative is the past; null is "sometime". */
  dueInDays: number | null;
}

export const DEMO_TASKS: readonly DemoTask[] = [
  {
    id: 'demo-task-ask-about-the-18th',
    title: 'Ask her how she wants to mark the 18th',
    note: 'Before you plan anything — a surprise lands as pressure',
    dueInDays: 0,
    done: false,
    // Valentin's, and the one the board leads with. It follows from her
    // 'Prefers to Choose' surprise preference, which is a thing he read in the
    // profile rather than a thing the user told him to write down.
    source: 'discovered',
  },
  {
    id: 'demo-task-book-what-she-picks',
    title: 'Book whatever she picks',
    note: "Northern Italian, if it's her choosing",
    dueInDays: 7,
    done: false,
    source: 'discovered',
  },
  {
    id: 'demo-task-card-for-yosef',
    title: 'Card in the post for Yosef',
    note: 'Her uncle. She notices when you remember him',
    // A day after the booking, and tied to a person on the tree rather than to
    // her: the two cards are meant to read as one week of his life.
    dueInDays: 8,
    done: false,
    source: 'manual',
  },
  {
    id: 'demo-task-order-glaze-set',
    title: 'Order the ceramic glaze set',
    note: '£62 — ask which colour she runs out of first',
    // The undated row. "Sometime" is a real to-do and the list has to be able to
    // hold one without inventing a deadline for it.
    dueInDays: null,
    done: false,
    source: 'manual',
  },
  {
    id: 'demo-task-settle-the-anniversary',
    title: 'Settle which anniversary she counts',
    note: 'The 18th. The other date was the first coffee',
    dueInDays: -2,
    done: true,
    source: 'manual',
  },
  {
    id: 'demo-task-ask-nadia',
    title: "Ask Nadia which weekend she's free",
    note: 'She hears first, for anything that counts',
    dueInDays: -9,
    done: true,
    source: 'discovered',
  },
];

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stamp the fixture's offsets into real dates.
 *
 * `now` is passed in rather than read here so the seeder's single clock reading
 * covers the preferences, the backdated conversations and these together — six
 * separate `Date.now()` calls could straddle midnight and put "due today" on
 * yesterday.
 */
export function resolveDemoTasks(tasks: readonly DemoTask[], now: number): Task[] {
  const stamp = new Date(now).toISOString();
  return tasks.map(({ dueInDays, ...task }) => ({
    ...task,
    due: dueInDays === null ? null : isoDate(now + dueInDays * DAY_MS),
    // Created when the demo was seeded, like everything else in the session.
    // A backdated `createdAt` would be more realistic and less useful: the
    // ticked rows sort by `updatedAt`, and inventing an order there means
    // inventing which one he finished first.
    createdAt: stamp,
    updatedAt: stamp,
  }));
}

/** The date part of an ISO timestamp — what a `due` is stored as. */
function isoDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
