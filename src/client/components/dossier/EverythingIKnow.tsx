import { colors, typography } from '../../design-system/tokens';
import {
  PROFILE_FIELD_SECTIONS,
  getFieldsBySection,
  type ProfileFieldDefinition,
} from '../../utils/profile-field-registry';
import type { ProfileFieldValue } from '../../hooks/use-profile-store';
import { ProfileField } from '../ProfileField';
import {
  askPillStyle,
  cardCountStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  CARD_HAIRLINE,
  FIELD_HAIRLINE,
} from './board-tones';

interface EverythingIKnowProps {
  getFieldValue: (fieldId: string) => ProfileFieldValue | null;
  onSaveField: (fieldId: string, value: string) => void;
  onClearField: (fieldId: string) => void;
  /** Field ids mid highlight animation, from `usePreferenceIngestion`. */
  highlightedFieldIds?: ReadonlySet<string>;
  /** Drops "tell me about her X" into the composer. */
  onAsk?: (field: ProfileFieldDefinition) => void;
  /** Collapses `columns: 3` to 1. Driven by `AppLayout`'s `isMobile`. */
  isMobile?: boolean;
}

/**
 * CSS multi-column, not a grid — AND THE `columns` VALUE IS LOAD-BEARING.
 *
 * This card is `.w3`, i.e. full board width, and holds five sections totalling
 * 18 fields. Laid out as a single flow it is a 700px ladder in a 1000px-wide
 * card, with two-thirds of the card empty beside it. Laid out as a *grid* of
 * three the five sections tile as 3 + 2 and the third cell of the second row is
 * dead space.
 *
 * `columns: 3` balances by content height instead of by item count, so the five
 * sections flow into three even columns of roughly six fields each and nothing
 * is left empty. `break-inside: avoid` on each section is what stops a section
 * splitting its heading from its fields across a column boundary.
 *
 * `columnFill: 'balance'` is the default but stated explicitly: `auto` would fill
 * column one to the card's full height before starting column two, which in a
 * card with no fixed height means one long column and two empty ones — exactly
 * the failure this layout exists to avoid.
 */
const columnsStyle: React.CSSProperties = {
  columns: 3,
  columnGap: 22,
  columnFill: 'balance',
};

/** One column below 768px: three columns of six fields in 375px is unreadable. */
const mobileColumnsStyle: React.CSSProperties = {
  columns: 1,
  columnGap: 0,
};

const sectionStyle: React.CSSProperties = {
  // Without this a section's heading can be orphaned at the foot of one column
  // with its fields at the head of the next.
  breakInside: 'avoid',
  // Safari still needs the prefixed multi-column property; `breakInside` alone is
  // ignored there, which is exactly the orphaning this stops. Cast because React's
  // `CSSProperties` does not type the vendor-prefixed column-break family.
  ...({ WebkitColumnBreakInside: 'avoid' } as React.CSSProperties),
  marginTop: 15,
};

/** The first section must not push the whole card down by its own 15px. */
const firstSectionStyle: React.CSSProperties = {
  ...sectionStyle,
  marginTop: 0,
};

const sectionHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  paddingBottom: 7,
  borderBottom: CARD_HAIRLINE,
  marginBottom: 4,
};

const sectionLabelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrowWide,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: colors.inkMuted,
};

const sectionCountStyle: React.CSSProperties = {
  flex: 'none',
  fontStyle: 'normal',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  color: colors.inkFaint,
  whiteSpace: 'nowrap',
};

/**
 * The dossier's field row, replacing `FieldSection`'s card-per-section shell.
 *
 * `flexWrap` plus a `flex: 1 0 100%` label is the mockup's own trick at
 * `full-profile.html:167-169`: the label takes its own line so the value gets the
 * full column width. A fixed label gutter would leave ~90px for a value inside a
 * ~300px column.
 */
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
  padding: '9px 2px',
};

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: FIELD_HAIRLINE,
};

const unknownLabelStyle: React.CSSProperties = {
  flex: '1 0 100%',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  letterSpacing: '0.04em',
  color: colors.inkFaint,
};

/** An unknown field is actionable, not just blank (`full-profile.html:175-176`). */
const unknownValueStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  fontWeight: typography.weights.normal,
  fontStyle: 'italic',
  color: colors.inkFaint,
};

/**
 * The reskin applied to `ProfileField`'s own container.
 *
 * `ProfileField` is reused rather than reimplemented because it owns the inline
 * edit: enter/escape handling, per-`valueType` validation, the enum `<select>`,
 * and "clear manual value". Rebuilding that for the dossier would fork the
 * validation rules — and lose the behaviour the whole card exists to provide.
 * Only its wrapper is restyled, from a padded rounded tile to a hairline-divided
 * row, which is what the board's density needs.
 */
const filledRowStyle: React.CSSProperties = {
  padding: '3px 0',
};

const dividedFilledRowStyle: React.CSSProperties = {
  ...filledRowStyle,
  borderTop: FIELD_HAIRLINE,
};

/**
 * Every registry field, in its real section, across three columns. The count is
 * not written down here: the registry has grown twice already.
 *
 * Every section is expanded. This is why `FieldSection` is deleted rather than
 * reused: its collapse-with-a-count-chip pattern makes sense in a 306px rail
 * where vertical space is scarce, but on a board the whole point is that the
 * complete picture is visible at once, and a collapsed section here would just
 * be a chip you have to click to see six short rows.
 */
export function EverythingIKnow({
  getFieldValue,
  onSaveField,
  onClearField,
  highlightedFieldIds,
  onAsk,
  isMobile = false,
}: EverythingIKnowProps) {
  const sections = [...PROFILE_FIELD_SECTIONS].sort((a, b) => a.order - b.order);

  let total = 0;
  let filled = 0;
  for (const section of sections) {
    for (const field of getFieldsBySection(section.id)) {
      total += 1;
      if (getFieldValue(field.id) !== null) filled += 1;
    }
  }

  return (
    <section style={cardStyle} data-testid="dossier-everything">
      <div style={cardHeadStyle}>
        <h2 style={cardTitleStyle}>Everything I know</h2>
        <span style={cardCountStyle}>
          {filled} of {total}
        </span>
      </div>

      <div
        style={isMobile ? mobileColumnsStyle : columnsStyle}
        data-testid="dossier-everything-columns"
      >
        {sections.map((section, sectionIndex) => {
          const fields = getFieldsBySection(section.id);
          const sectionFilled = fields.filter((f) => getFieldValue(f.id) !== null).length;

          return (
            <div
              key={section.id}
              style={sectionIndex === 0 ? firstSectionStyle : sectionStyle}
              data-testid="dossier-field-section"
              data-section-id={section.id}
            >
              <div style={sectionHeadStyle}>
                <h3 style={sectionLabelStyle}>{section.label}</h3>
                <em style={sectionCountStyle}>
                  {sectionFilled} of {fields.length}
                </em>
              </div>

              {fields.map((field, fieldIndex) => {
                const value = getFieldValue(field.id);
                const divided = fieldIndex > 0;

                // An unknown field is a prompt, not an empty `ProfileField`.
                // `ProfileField` would render "Not yet known" plus an "Add"
                // button, which is a second, quieter call to action competing
                // with the ranked queue in "Worth asking next".
                if (!value) {
                  return (
                    <div
                      key={field.id}
                      style={divided ? dividedRowStyle : rowStyle}
                      data-testid="dossier-field"
                      data-field-id={field.id}
                      data-known="false"
                    >
                      <span style={unknownLabelStyle}>{field.label}</span>
                      <span style={unknownValueStyle}>Not yet known</span>
                      <button
                        type="button"
                        style={askPillStyle}
                        onClick={() => onAsk?.(field)}
                        aria-label={`Ask about her ${field.label.toLowerCase()}`}
                      >
                        Ask
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={field.id}
                    style={divided ? dividedFilledRowStyle : filledRowStyle}
                    data-testid="dossier-field"
                    data-field-id={field.id}
                    data-known="true"
                  >
                    <ProfileField
                      definition={field}
                      value={value}
                      onSave={(next) => onSaveField(field.id, next)}
                      onClear={() => onClearField(field.id)}
                      isHighlighted={highlightedFieldIds?.has(field.id) ?? false}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
