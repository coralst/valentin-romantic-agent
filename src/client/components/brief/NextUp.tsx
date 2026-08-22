import { useMemo } from 'react';
import { colors, radii, typography } from '../../design-system/tokens';
import { getDaysUntilOccasion, type Occasion } from '../../utils/occasion-derivation';
import { getActByPlan, getNextOccurrence } from '../../utils/lead-times';
import { goldTint, insetRing, onClaret } from './rail-tones';
import { SectionHead } from './SectionHead';

interface NextUpProps {
  occasions: Occasion[];
  /** Injected so tests and screenshots can pin "today". */
  referenceDate?: Date;
}

/** "Wednesday 2 September" — the mockup's full, unabbreviated date line. */
const FULL_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** "17 Jun" — the compact date on the secondary rows. */
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

const heroStyle: React.CSSProperties = {
  // A gold *tint*, not a gold fill: the card has to read as raised off the
  // claret without competing with the pinned nudge, which is solid gold.
  background: goldTint(0.13),
  borderRadius: radii.panel,
  padding: '14px 15px',
  boxShadow: insetRing(goldTint(0.3)),
};

const heroTopStyle: React.CSSProperties = {
  display: 'flex',
  // Baseline, not centre: the serif title and the sans countdown have different
  // cap heights, and centring them makes the countdown look like it is sinking.
  alignItems: 'baseline',
  gap: 8,
};

const heroTitleStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingSm,
  fontWeight: typography.weights.normal,
  color: colors.onClaret,
};

const countdownStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  color: onClaret(0.55),
};

const whenStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  color: onClaret(0.62),
  marginTop: 2,
};

const actByStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  marginTop: 11,
  paddingTop: 11,
  // Dashed, not solid: it separates the deadline from the date without reading
  // as a second card edge inside a card that already has a ring.
  borderTop: `1px dashed ${goldTint(0.32)}`,
};

const actByIconStyle: React.CSSProperties = {
  fontStyle: 'normal',
  color: colors.goldLight,
  fontSize: typography.px.label,
  lineHeight: 1,
};

const actByLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.body,
  fontWeight: typography.weights.medium,
  color: colors.goldLight,
};

const actByAheadStyle: React.CSSProperties = {
  fontStyle: 'normal',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  color: onClaret(0.5),
  marginLeft: 'auto',
};

const secondaryRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 9,
  // 3px of side padding so the label optically aligns with the hero card's copy
  // rather than with the card's outer edge.
  padding: '11px 3px 0',
};

const secondaryLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  fontWeight: typography.weights.medium,
  color: colors.onClaret,
};

const secondaryDateStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: onClaret(0.55),
};

const secondaryCountdownStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  // Fainter than the hero's countdown — these rows are context, not the task.
  color: onClaret(0.42),
};

const emptyStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.45,
  color: onClaret(0.5),
  padding: '2px 3px',
};

/** "12 days" / "Tomorrow" / "Today" — a countdown that stays readable at 1 day. */
function formatCountdown(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

/**
 * The rail's headline module: the nearest occasion, and — louder than the
 * countdown — the date by which it has to be arranged.
 *
 * The hero slot belongs to the deadline rather than to the portrait because the
 * rail is a to-do list, not a mirror of the profile (option-5d-brief.html:78-81).
 * Everything after the first occasion collapses to a one-line row.
 */
export function NextUp({ occasions, referenceDate }: NextUpProps) {
  const now = referenceDate ?? new Date();
  const nowTime = now.getTime();

  const sorted = useMemo(() => {
    const reference = new Date(nowTime);
    return [...occasions]
      .map((occasion) => ({
        occasion,
        daysUntil: getDaysUntilOccasion(occasion, reference),
        date: getNextOccurrence(occasion, reference),
      }))
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [occasions, nowTime]);

  const [hero, ...rest] = sorted;

  return (
    <section data-testid="brief-next-up">
      <SectionHead label="Next up" />

      {!hero && (
        <p style={emptyStyle} data-testid="brief-next-up-empty">
          No dates yet. Tell Valentin her birthday and I will start counting down
          to it.
        </p>
      )}

      {hero && (
        <>
          <div style={heroStyle} data-testid="brief-next-up-hero">
            <div style={heroTopStyle}>
              <b style={heroTitleStyle}>{hero.occasion.label}</b>
              <span style={countdownStyle}>{formatCountdown(hero.daysUntil)}</span>
            </div>
            <div style={whenStyle}>{FULL_DATE.format(hero.date)}</div>
            {(() => {
              const plan = getActByPlan(hero.occasion, now);
              return (
                <div style={actByStyle} data-testid="brief-act-by">
                  <i style={actByIconStyle} aria-hidden="true">
                    &#9727;
                  </i>
                  <b style={actByLabelStyle}>{plan.label}</b>
                  <em style={actByAheadStyle}>{plan.ahead}</em>
                </div>
              );
            })()}
          </div>

          {rest.map(({ occasion, daysUntil, date }) => (
            <div
              key={occasion.fieldId}
              style={secondaryRowStyle}
              data-testid="brief-next-up-row"
            >
              <b style={secondaryLabelStyle}>{occasion.label}</b>
              <span style={secondaryDateStyle}>{SHORT_DATE.format(date)}</span>
              <span style={secondaryCountdownStyle}>{formatCountdown(daysUntil)}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
