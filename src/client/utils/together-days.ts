/**
 * How long you have been together, in days.
 *
 * The headline figure on the dossier's command bar, and the only number on the
 * page that is about the relationship rather than about the profile. "2,003 days"
 * says something "since 2020" does not: it is large, it is specific, and it is
 * the kind of thing you mention out loud.
 *
 * Counted from the anniversary because that is the date the user gave for the
 * relationship starting. If they never gave one, there is no figure — a guess
 * ("about five years?") would be worse than the honest absence, since the whole
 * point of the number is that it is exact.
 */
export function deriveTogetherDays(
  anniversaryValue: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!anniversaryValue) return null;

  // Midnight-to-midnight, so the figure ticks over at the start of a day rather
  // than at whatever time of day the anniversary happens to be stored with —
  // otherwise the same date reads as 2,002 in the morning and 2,003 at night.
  //
  // A bare `YYYY-MM-DD` is read off the string rather than through `new Date`:
  // that form parses as UTC midnight, so local getters would move every
  // anniversary a day earlier west of Greenwich, and the headline figure on the
  // command bar would be off by one for most of the world.
  const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anniversaryValue.trim());

  let from: number;
  if (bareDate) {
    from = Date.UTC(Number(bareDate[1]), Number(bareDate[2]) - 1, Number(bareDate[3]));
  } else {
    const started = new Date(anniversaryValue);
    if (Number.isNaN(started.getTime())) return null;
    from = Date.UTC(started.getFullYear(), started.getMonth(), started.getDate());
  }

  const to = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  const days = Math.floor((to - from) / 86_400_000);

  // A future anniversary is a typo or a plan, not a negative relationship.
  return days >= 0 ? days : null;
}

/** `2003` → `"2,003"`. Grouped, because the figure is set at 22px. */
export function formatTogetherDays(days: number): string {
  return days.toLocaleString('en-US');
}
