import { colors, typography } from '../../design-system/tokens';
import { PREFERENCE_CATEGORIES } from '../../../shared/constants/categories';
import type {
  PreferenceCategory,
  PreferenceWithHistory,
} from '../../../shared/interfaces/preference';
import { resolveField } from '../../utils/preference-field-mapper';
import { CategoryGroup } from '../CategoryGroup';
import {
  cardCountStyle,
  cardEmptyStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
} from './board-tones';

/**
 * ==========================================================================
 * THIS CARD RESCUES REAL EXTRACTION OUTPUT. IT IS NOT DECORATION.
 * ==========================================================================
 *
 * The 18-field registry is a fixed schema; extraction is free-form. When Valentin
 * pulls `hobbies: "she collects vinyl"` out of a conversation it lands in the
 * preferences store, but `resolveField('hobbies', 'she collects vinyl')` matches
 * no registry mapping, so nothing in the profile ever shows it.
 *
 * `PartnerProfilePanel` used to catch exactly this in an "Other Discoveries"
 * group. Stage 4 deleted that panel, and neither mockup has the module, so from
 * Stage 4 until now every unmapped extraction has been *silently dropped from the
 * UI* — the data was in the store with nowhere on screen to go. `BriefRail` left
 * a `TODO(yellow)` naming Stage 6 as the rescue point, and kept `CategoryGroup`
 * and `PreferenceCard` alive, compiling and unreferenced, so this card would have
 * something to mount rather than rebuilding the grouping from scratch.
 *
 * This is that rescue point. Deleting this card, or "simplifying" it down to only
 * the mapped preferences, re-introduces silent data loss.
 */

/**
 * Keys `KeepInMind` already surfaces, mirrored from `brief/KeepInMind.tsx`.
 *
 * Allergies and avoidances are unmapped preferences too, so they would otherwise
 * appear in both cards. They belong in the warning card — its whole value is that
 * gold styling means "this changes the plan" — so they are filtered out here
 * rather than listed twice at two different volumes.
 */
const CAUTION_KEY_PATTERNS = ['allerg', 'avoid', 'dislike', 'intoleran', 'never', 'hate'];

function isCaution(preference: PreferenceWithHistory): boolean {
  const key = preference.key.toLowerCase();
  return CAUTION_KEY_PATTERNS.some((pattern) => key.includes(pattern));
}

/**
 * The preferences that resolve to no registry field and are not already shown as
 * a caution, bucketed by category and stripped of empty buckets.
 *
 * Exported so the count is testable without rendering, and so `DossierView` can
 * decide whether the card has anything to say before it mounts it.
 */
export function groupUnmappedPreferences(
  preferences: readonly PreferenceWithHistory[],
): Array<{ category: PreferenceCategory; preferences: PreferenceWithHistory[] }> {
  const buckets = new Map<PreferenceCategory, PreferenceWithHistory[]>();

  for (const preference of preferences) {
    if (resolveField(preference.category, preference.key)) continue;
    if (isCaution(preference)) continue;
    const bucket = buckets.get(preference.category);
    if (bucket) bucket.push(preference);
    else buckets.set(preference.category, [preference]);
  }

  // Iterate the canonical category order rather than Map insertion order, so the
  // card's sections do not reshuffle as new extractions arrive.
  return PREFERENCE_CATEGORIES.flatMap((category) => {
    const bucketed = buckets.get(category);
    return bucketed && bucketed.length > 0 ? [{ category, preferences: bucketed }] : [];
  });
}

interface AlsoMentionedProps {
  /** Every preference, already flattened out of its per-category buckets. */
  preferences: readonly PreferenceWithHistory[];
  /** Preference ids mid highlight animation. */
  highlightedIds?: ReadonlySet<string>;
  onHighlightEnd?: (preferenceId: string) => void;
}

const noteStyle: React.CSSProperties = {
  margin: '0 0 11px',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.45,
  color: colors.inkMuted,
};

/**
 * Everything Valentin picked up that the registry fields have no room for.
 *
 * Grouped by preference category via `CategoryGroup`/`PreferenceCard` — the two
 * components Stage 4 kept alive for this. They carry the older component styling
 * rather than the vitrine palette, which is deliberate for now: they are correct,
 * they are round-cornered, and reskinning them is a smaller and separable change
 * than the data loss this card exists to stop.
 */
export function AlsoMentioned({
  preferences,
  highlightedIds,
  onHighlightEnd,
}: AlsoMentionedProps) {
  const groups = groupUnmappedPreferences(preferences);
  const count = groups.reduce((total, group) => total + group.preferences.length, 0);

  return (
    <section style={cardStyle} data-testid="dossier-also-mentioned">
      <div style={cardHeadStyle}>
        <h2 style={cardTitleStyle}>Also mentioned</h2>
        {count > 0 && <span style={cardCountStyle}>{count}</span>}
      </div>

      {count === 0 ? (
        <p style={cardEmptyStyle} data-testid="dossier-also-mentioned-empty">
          Nothing yet that does not already have a home above. Anything you tell me
          that her profile fields have no room for will collect here.
        </p>
      ) : (
        <>
          <p style={noteStyle}>
            Things I noted that do not fit one of her profile fields. Kept because
            you said them.
          </p>
          {groups.map((group) => (
            <CategoryGroup
              key={group.category}
              category={group.category}
              preferences={group.preferences}
              highlightedIds={
                // `CategoryGroup` wants a mutable `Set`; the ingestion result is
                // shared, so copy rather than cast away the readonly.
                highlightedIds ? new Set(highlightedIds) : new Set<string>()
              }
              onHighlightEnd={(id) => onHighlightEnd?.(id)}
            />
          ))}
        </>
      )}
    </section>
  );
}
