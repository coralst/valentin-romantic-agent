/**
 * Something he has to actually do — the one thing on the dossier that is about
 * him rather than about her.
 *
 * ## Why this is stored and not derived
 *
 * Most of the board is derived: "Worth asking next" is empty fields ranked,
 * "Coming next" is dates counted down. Both recompute from scratch on every
 * render and are always right.
 *
 * A to-do cannot work that way, because the interesting state is the tick. A
 * derived list has no memory: it would re-offer "book somewhere for the
 * anniversary" the morning after he booked it, and the one thing a to-do list
 * must never do is nag about finished work. `done` is a fact about what he did,
 * which is exactly the kind of thing that has to be written down.
 *
 * It also has to survive a device change for the same reason the preferences
 * do — a list that forgets when he opens his laptop is worse than no list,
 * because he has already stopped keeping the real one.
 */
export interface Task {
  /** Stable across edits, and the sort key component. */
  id: string;
  /** The line as it reads on the row: "Ask her about her sister's plans". */
  title: string;
  /**
   * ISO date it wants doing by, when there is one.
   *
   * Nullable on purpose: "ask her sometime" is a real to-do, and forcing a
   * deadline onto it would either invent one or lose the item.
   */
  due?: string | null;
  /** The second line — why it matters, or what to say. */
  note?: string | null;
  /** Ticked. The whole reason this entity is persisted rather than derived. */
  done: boolean;
  /**
   * Whether Valentin raised it or the user typed it.
   *
   * Shown, not just recorded: a suggestion he never agreed to should not look
   * identical to a commitment he made himself.
   */
  source: 'manual' | 'discovered';
  createdAt: string;
  updatedAt: string;
}

/** Open tasks, soonest deadline first, undated last. */
export function openTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => !task.done)
    .sort((a, b) => compareDue(a.due, b.due));
}

/** Ticked tasks, most recently finished first. */
export function doneTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => task.done)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Undated tasks sort last rather than first.
 *
 * An empty string would sort before every real date and put "ask her sometime"
 * above "book by Friday", which inverts the only ordering the list is for.
 */
function compareDue(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}
