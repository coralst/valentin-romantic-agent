import { isGap, type Person, type PersonGeneration } from '../../shared/interfaces/person';

/** A person plus how far away their next birthday is. */
export interface UpcomingBirthday {
  person: Person;
  /** Days from the reference date to the next occurrence. 0 means today. */
  daysUntil: number;
}

const DAY_MS = 86_400_000;

/** The rows the tree draws, top to bottom. */
export const GENERATION_ORDER: PersonGeneration[] = ['elder', 'peer', 'younger'];

/**
 * Group people into the tree's three rows, named people before gaps.
 *
 * Gaps sort last within their row so the tree reads as "here is what I know,
 * and here is what I am missing" rather than interleaving the two.
 */
export function groupByGeneration(people: Person[]): Record<PersonGeneration, Person[]> {
  const rows: Record<PersonGeneration, Person[]> = { elder: [], peer: [], younger: [] };

  for (const person of people) {
    rows[person.generation].push(person);
  }

  for (const generation of GENERATION_ORDER) {
    rows[generation].sort((a, b) => {
      const aGap = isGap(a) ? 1 : 0;
      const bGap = isGap(b) ? 1 : 0;
      if (aGap !== bGap) return aGap - bGap;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
  }

  return rows;
}

/**
 * Days from `now` to the next occurrence of a birthday, ignoring the year.
 *
 * Same rule as `getDaysUntilOccasion` for profile dates: a birthday is annual,
 * so a date in March read in August means *next* March. Kept separate from that
 * function because it takes a `Person`, not an `Occasion`, and folding people
 * into the occasion type would put cats in the anniversary spine.
 */
export function daysUntilBirthday(
  birthday: string,
  now: Date = new Date(),
): number | null {
  const parsed = new Date(birthday);
  if (Number.isNaN(parsed.getTime())) return null;

  // UTC getters on `parsed`, local getters on `now`. A `<input type="date">`
  // value is a bare `YYYY-MM-DD`, which parses as UTC midnight — reading it with
  // local getters west of Greenwich would shift every birthday a day early.
  // `now`, by contrast, means "today where the user is standing".
  const month = parsed.getUTCMonth();
  const day = parsed.getUTCDate();

  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let next = Date.UTC(now.getFullYear(), month, day);
  if (next < today) {
    next = Date.UTC(now.getFullYear() + 1, month, day);
  }

  return Math.round((next - today) / DAY_MS);
}

/**
 * Everyone with a known birthday, soonest first.
 *
 * This is the card that earns the feature: remembering her sister's birthday
 * scores higher than remembering her own, and nothing else in the app knows
 * these dates.
 */
export function upcomingBirthdays(
  people: Person[],
  now: Date = new Date(),
): UpcomingBirthday[] {
  const dated: UpcomingBirthday[] = [];

  for (const person of people) {
    if (!person.birthday) continue;
    const daysUntil = daysUntilBirthday(person.birthday, now);
    if (daysUntil === null) continue;
    dated.push({ person, daysUntil });
  }

  return dated.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** How many people are recorded but unnamed — the number the tree advertises. */
export function countGaps(people: Person[]): number {
  return people.filter(isGap).length;
}

/**
 * The questions the tree generates, as composer-ready lines.
 *
 * A gap is only useful if it turns into an ask, so the tree hands its gaps to
 * the same "fill the composer, never send" path everything else on the board
 * uses (`DossierView.askAbout`).
 */
export function gapQuestions(people: Person[]): string[] {
  return people
    .filter(isGap)
    .map((person) => `What's her ${person.relationship.toLowerCase()}'s name?`);
}
