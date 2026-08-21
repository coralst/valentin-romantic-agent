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
 * "allergies" and lands nowhere in the 18-field registry. It is the single most
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

/** Sentence-case a key like "allergies" for use as a caution title prefix. */
function titleCase(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
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
      id: preference.id,
      title: `${titleCase(preference.key)}: ${preference.value}`,
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
