import { colors, radii, typography } from '../../design-system/tokens';
import { goldTint, insetRing, onClaret, ROW_HAIRLINE } from './rail-tones';
import { SectionHead } from './SectionHead';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

/** A constraint that should change a plan before the plan is made. */
export interface Caution {
  id: string;
  /** The constraint itself, stated flatly: "Prefers to choose her own gifts". */
  title: string;
  /** What it rules out. The consequence, not a restatement of the title. */
  consequence: string;
}

/**
 * Keys whose values are constraints rather than preferences.
 *
 * Extraction is free-form, so an allergy arrives as a `food` preference keyed
 * "allergies" and lands nowhere in the field registry. It is the single most
 * consequential thing the app can know — a dinner suggestion that ignores it is
 * worse than no suggestion — so it is matched by substring here rather than
 * waiting for a registry field that does not exist.
 */
const CAUTION_KEY_PATTERNS = ['allerg', 'avoid', 'dislike', 'intoleran', 'never', 'hate'];

const CONSEQUENCE_BY_PATTERN: Readonly<Record<string, string>> = {
  allerg: 'Check every menu before you book.',
  intoleran: 'Check every menu before you book.',
  avoid: 'Rules out anything built around it.',
  dislike: 'Worth steering away from entirely.',
  never: 'Take it off the list for good.',
  hate: 'Take it off the list for good.',
};

/**
 * Sentence-case an extracted key for use as a caution title prefix.
 *
 * Keys arrive in whatever shape the model emitted, and a real run produced
 * `shellfish_allergy`, which rendered literally as "Shellfish_allergy: badly
 * allergic to shellfish" — a database identifier shown to a person. Underscores
 * and hyphens become spaces before the first letter is raised.
 */
export function titleCase(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The shared opening of a word's inflections — "allerg" for both "allergy" and
 * "allergic". Crude on purpose: this decides a label, not a search result, and a
 * missed match only costs a slightly redundant title.
 */
function stem(word: string): string {
  return word.replace(/(ies|ied|ing|ic|al|y|s)$/, '');
}

/**
 * The caution's headline: "<key>: <value>", unless the value already says the key.
 *
 * The same live run that produced `shellfish_allergy` gave it the value "badly
 * allergic to shellfish", so the naive join read "Shellfish allergy: badly allergic
 * to shellfish" — the same fact twice. When the value already carries the words of
 * the key, the value alone is the better sentence.
 */
export function cautionTitle(key: string, value: string): string {
  const label = titleCase(key);
  const spoken = value.trim();
  if (!spoken) return label;

  const haystack = spoken.toLowerCase();
  const significant = label
    .toLowerCase()
    .split(' ')
    // Short words ("of", "to") are not evidence either way.
    .filter((word) => word.length > 3);

  // Compare on a stem, not the whole word: the key said "allergy" and the value
  // said "allergic", which are the same fact in two inflections.
  const covered =
    significant.length > 0 && significant.every((word) => haystack.includes(stem(word)));

  if (covered) return spoken.charAt(0).toUpperCase() + spoken.slice(1);
  return `${label}: ${spoken}`;
}

/**
 * Pull the constraints out of the profile — the things that narrow a plan.
 *
 * Two sources, deliberately: the `surprise_preference` registry field, which is
 * a first-class enum, and free-form extracted preferences whose key reads as an
 * avoidance. The second is why this module exists at all; those preferences map
 * to no registry field and would otherwise be invisible.
 */
export function deriveCautions(
  getFieldValue: (fieldId: string) => { value: string } | null,
  preferences: PreferenceWithHistory[],
): Caution[] {
  const cautions: Caution[] = [];

  const surprise = getFieldValue('surprise_preference');
  if (surprise?.value === 'Prefers to Choose') {
    cautions.push({
      id: 'surprise_preference',
      title: 'Prefers to choose',
      consequence: 'Ask first. A surprise would land as pressure, not delight.',
    });
  }

  for (const preference of preferences) {
    const key = preference.key.toLowerCase();
    const pattern = CAUTION_KEY_PATTERNS.find((candidate) => key.includes(candidate));
    if (!pattern) continue;

    cautions.push({
      // Keyed on category+key rather than `preference.id`: the id is assigned by
      // the server and changes when a preference is re-extracted, which remounts
      // the row and loses its identity for no reason. category+key is stable
      // across re-extraction and is present even on a partial record.
      id: `${preference.category}:${preference.key}`,
      title: cautionTitle(preference.key, preference.value),
      consequence: CONSEQUENCE_BY_PATTERN[pattern] ?? 'Worth checking before you commit.',
    });
  }

  return cautions;
}

const cardStyle: React.CSSProperties = {
  background: goldTint(0.09),
  borderRadius: radii.chip,
  // 3px vertical, so each row's own 9px padding sets the rhythm and the first
  // and last rows are not double-padded away from the card edge.
  padding: '3px 14px',
  boxShadow: insetRing(goldTint(0.22)),
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '9px 0',
};

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: radii.pill,
  background: colors.goldLight,
  flex: 'none',
  // Nudged down to sit on the first line's centre, not its ascender.
  marginTop: 7,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.body,
  fontWeight: typography.weights.medium,
  color: colors.onClaret,
};

const consequenceStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.4,
  color: onClaret(0.55),
  marginTop: 2,
};

interface KeepInMindProps {
  cautions: Caution[];
}

/**
 * The rail's only warning styling, so it cannot be mistaken for anything else.
 *
 * Renders nothing when there is nothing to warn about — an empty "Keep in mind"
 * card would train the eye to skip the gold tint, which is the one visual signal
 * that has to stay expensive.
 */
export function KeepInMind({ cautions }: KeepInMindProps) {
  if (cautions.length === 0) return null;

  return (
    <section data-testid="brief-keep-in-mind">
      <SectionHead label="Keep in mind" warn count={cautions.length} />
      <div style={cardStyle}>
        {cautions.map((caution, index) => (
          <div
            key={caution.id}
            style={index === 0 ? rowStyle : { ...rowStyle, borderTop: ROW_HAIRLINE }}
            data-testid="brief-caution"
          >
            <div style={dotStyle} aria-hidden="true" />
            <div style={bodyStyle}>
              <b style={titleStyle}>{caution.title}</b>
              <p style={consequenceStyle}>{caution.consequence}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
