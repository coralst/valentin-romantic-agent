/**
 * Someone in her life: a name, how they are related to her, and — if you know it
 * — the date you are going to be glad you wrote down.
 *
 * The profile registry cannot hold these. It is a fixed list of twenty-one
 * single-valued fields (`partner_name`, `birthday`, `ring_size`), and a family is
 * an unbounded set of *records* with their own fields. A `sister_name` field
 * would work until she has two sisters.
 */
export interface Person {
  /** Stable across renames, because a rename is the most likely edit. */
  id: string;
  /**
   * What you call them, or `null` when you know someone exists but not their
   * name.
   *
   * The nullable name is the point of the whole feature. "Her brother, whose
   * name I have never caught" is exactly the thing that ambushes you at a
   * dinner table, so it is recorded as a person with a gap rather than not
   * recorded at all — see `isGap`.
   */
  name: string | null;
  /** "Her mother", "Older sister", "Her cat" — free text, in your words. */
  relationship: string;
  /** Which row of the tree they belong on. */
  generation: PersonGeneration;
  /** ISO date, when known. Drives the birthday list and the countdowns. */
  birthday?: string | null;
  /** "Goes by Mimi", "Lives in Berlin", "Don't mention the illness". */
  note?: string | null;
  /** Set when the record came out of a conversation rather than a form. */
  source: 'manual' | 'discovered';
  updatedAt: string;
}

/**
 * The three rows the tree draws.
 *
 * Not "parent / sibling / child" — a cat is none of those and belongs on the
 * bottom row anyway, and a grandmother and a mother both belong on the top one.
 * Generation is about *where the card sits*, so it is stated directly instead of
 * inferred from the relationship text.
 */
export type PersonGeneration = 'elder' | 'peer' | 'younger';

/** A person you know of but cannot name — drawn dashed, and worth asking about. */
export function isGap(person: Person): boolean {
  return person.name === null || person.name.trim().length === 0;
}

/** What to print on their card. */
export function displayName(person: Person): string {
  if (isGap(person)) return unnamedLabel(person);
  return person.name as string;
}

/**
 * The placeholder a gap wears: "Brother?", not "Unknown".
 *
 * Phrased as the question you would actually ask, because the card is a prompt.
 */
export function unnamedLabel(person: Person): string {
  const relationship = person.relationship.trim();
  if (relationship.length === 0) return 'Someone?';
  return `${relationship.charAt(0).toUpperCase()}${relationship.slice(1)}?`;
}
