import { colors, radii, typography } from '../../design-system/tokens';
import { getFieldById } from '../../utils/profile-field-registry';
import { onClaret, ROW_HAIRLINE, insetRing } from './rail-tones';
import { SectionHead } from './SectionHead';

/**
 * The shape of the brief, before there is anything in it.
 *
 * A brand-new account used to get one paragraph of prose in a 306px claret
 * column and nothing else — a large, expensive-looking void. The demo's whole
 * moment is watching the panel fill in as you talk, and you cannot watch
 * something fill in if you have never seen its shape.
 *
 * So the empty state is a set of labelled rows with no values: this is what
 * Valentin is going to learn about her. Every row is a real registry field, and
 * an empty row is emphatically *not* counted as known — the tally footer still
 * reads "0 of N" underneath, because it counts the profile store, not this.
 *
 * WHY THIS IS NOT SHOWN ONCE SOMETHING IS KNOWN
 *
 * The rail already has two modules whose job is the filled-in and the still-
 * missing view — the "Good to know" chip strip and "Worth asking next", which is
 * ranked by payoff rather than by this hand-picked order. A permanent third list
 * would say the same things a third time. So the skeleton is the zero state's
 * content and hands over to them at the first fact.
 */

/**
 * The curated rows, by field id.
 *
 * NOT the whole registry. Twenty-one dashes is a wall, it pushes the pinned
 * nudge off the fold on a laptop, and it makes the profile look like a form to
 * complete rather than a conversation to have. These are the ten a person would
 * actually expect a romantic assistant to hold: the highest-payoff facts from
 * `field-payoff.ts`, plus the three sizes — which are the ones visitors are
 * surprised and pleased to see a place for.
 *
 * Labels are read from the registry rather than repeated here, so a relabelled
 * field cannot end up named two different things in two places.
 */
const SKELETON_GROUPS: ReadonlyArray<{ label: string; fieldIds: readonly string[] }> = [
  {
    label: 'The essentials',
    fieldIds: [
      'partner_name',
      'birthday',
      'anniversary',
      'love_language',
      'hobbies',
      'favorite_cuisine',
      'gift_budget',
    ],
  },
  {
    // Their own group because that is how they are used: you look up all three
    // at once, standing in a shop.
    label: 'Her sizes',
    fieldIds: ['clothing_size', 'shoe_size', 'ring_size'],
  },
  {
    /*
     * The only group that is about him, and two rows rather than the four
     * logistics fields, because the skeleton is capped at twelve — a longer wall
     * of dashes pushes the pinned nudge off the fold, which is the bug pinning it
     * was meant to fix (`BriefSkeleton.test.tsx`).
     *
     * These two earn the slots because they are the ones with no usable default:
     * with no city there is nowhere to search from and with no occasion there is
     * nothing to count down to. A radius and a lead time both fall back to a
     * sensible value in `profile-fields.ts`, so leaving them blank costs nothing.
     */
    label: 'Where and when',
    fieldIds: ['home_city', 'next_occasion'],
  },
];

const groupStyle: React.CSSProperties = {
  borderRadius: radii.kv,
  background: onClaret(0.05),
  boxShadow: insetRing(onClaret(0.07)),
  padding: '2px 12px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 10,
  // 26px rows rather than the 34px a `ProfileField` tile uses: ten of these have
  // to sit above the fold alongside the header, the nudge and the tally.
  minHeight: 26,
};

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: ROW_HAIRLINE,
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.02em',
  color: onClaret(0.68),
};

/**
 * The empty value: a gold en-dash, not the words "not yet known".
 *
 * Repeating a four-word sentence down ten rows reads as ten failures. A dash in
 * the same gold the tally uses for a *lit* tick reads as a slot waiting to be
 * filled, which is what it is.
 */
const emptyValueStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  color: colors.goldLight,
  // Held back from full strength so the dash never competes with a real value,
  // but no fainter: at 0.55 it disappeared against the claret in the rendered
  // rail and the rows read as broken rather than waiting.
  opacity: 0.75,
};

const groupsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

/** The labelled-but-empty rows a fresh account sees instead of a blank column. */
export function BriefSkeleton() {
  return (
    <section style={groupsStyle} data-testid="brief-skeleton" aria-label="What Valentin will learn">
      {SKELETON_GROUPS.map((group) => (
        <div key={group.label}>
          <SectionHead label={group.label} />
          <div style={groupStyle}>
            {group.fieldIds.map((fieldId, index) => {
              const field = getFieldById(fieldId);
              // A row whose field id no longer exists is dropped rather than
              // rendered as a blank: the registry is the authority on what
              // Valentin can learn, and this list is only a view of it.
              if (!field) return null;

              return (
                <div
                  key={fieldId}
                  style={index === 0 ? rowStyle : dividedRowStyle}
                  data-testid="brief-skeleton-row"
                  data-field-id={fieldId}
                  data-known="false"
                >
                  <span style={labelStyle}>{field.label}</span>
                  <span style={emptyValueStyle} aria-label="not yet known">
                    &#8211;
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
