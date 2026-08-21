import { useMemo } from 'react';
import { colors, radii, typography } from '../../design-system/tokens';
import { getDaysUntilOccasion, type Occasion } from '../../utils/occasion-derivation';
import { getActByPlan, getNextOccurrence } from '../../utils/lead-times';
import {
  cardEmptyStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  goldInk,
  goldWash,
  GOLD_INK,
  insetRing,
} from './board-tones';

interface WhatsComingProps {
  occasions: Occasion[];
  /** Injected so tests and screenshots can pin "today". */
  referenceDate?: Date;
}

/** "Wed 2 September" — the mockup's dated line (`full-profile.html:262`). */
const EVENT_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
});

/** Within this many days an occasion gets the gold dot and the claret countdown. */
const SOON_DAYS = 30;

/**
 * `position: relative` plus 17px of left padding, so the absolutely-positioned
 * spine and dots below have something to hang off (`full-profile.html:86`).
 */
const timelineStyle: React.CSSProperties = {
  position: 'relative',
  paddingLeft: 17,
};

/**
 * The hairline spine.
 *
 * A `::before` in the mockup; here it is a real absolutely-positioned box,
 * because inline styles have no pseudo-elements and there is no cascade to hang
 * one on. It fades downward so the dates read as a sequence that trails off
 * rather than as a bounded list (`:88-89`).
 *
 * Inset 8px top and bottom so it starts and ends *at* the first and last dots
 * instead of overshooting them.
 */
const spineStyle: React.CSSProperties = {
  position: 'absolute',
  left: 4,
  top: 8,
  bottom: 8,
  width: 1,
  background: colors.spineGradient,
  pointerEvents: 'none',
};

const eventStyle: React.CSSProperties = {
  position: 'relative',
  padding: '0 0 15px',
};

/**
 * The dot on the spine.
 *
 * The 3px ring is the *card's own sand*, not a colour — that is what punches the
 * dot through the spine so the line appears to pass behind it (`:92`).
 */
const dotStyle: React.CSSProperties = {
  position: 'absolute',
  left: -17,
  top: 6,
  width: 9,
  height: 9,
  borderRadius: radii.pill,
  background: colors.linenShade,
  boxShadow: `0 0 0 3px ${colors.sand}`,
};

const dotSoonStyle: React.CSSProperties = {
  ...dotStyle,
  background: colors.gold,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 9,
  flexWrap: 'wrap',
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingSm,
  fontWeight: typography.weights.normal,
  color: colors.ink,
};

const dateStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  color: colors.inkMuted,
};

const countdownStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.medium,
  color: colors.inkFaint,
  whiteSpace: 'nowrap',
};

const countdownSoonStyle: React.CSSProperties = {
  ...countdownStyle,
  color: colors.claret,
};

/**
 * The act-by chip — the thing a countdown cannot tell you.
 *
 * "12 days to the anniversary" is a fact; "book by 26 Aug" is the task, and it
 * is a week sooner. Reuses `getActByPlan` so the rail and the dossier can never
 * disagree about a deadline.
 */
const actByStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 7,
  background: goldWash(0.13),
  borderRadius: radii.pill,
  padding: '5px 11px',
  boxShadow: insetRing(goldWash(0.3)),
  maxWidth: '100%',
  flexWrap: 'wrap',
};

const actByIconStyle: React.CSSProperties = {
  fontStyle: 'normal',
  color: colors.gold,
  fontSize: typography.px.tiny,
  lineHeight: 1,
};

const actByLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  fontWeight: typography.weights.medium,
  color: GOLD_INK,
};

const actByAheadStyle: React.CSSProperties = {
  fontStyle: 'normal',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  color: goldInk(0.65),
};

/** "12 days" / "Tomorrow" / "Today" — readable at 1 day, unlike "1 days". */
function formatCountdown(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 365) return `${days} days`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'}`;
}

/**
 * The board's hero card: every dated occasion on one spine, each with the date
 * by which it has to be arranged.
 *
 * Unlike the rail's `NextUp`, which collapses everything after the first
 * occasion into a one-line row, the dossier has the width to give every occasion
 * its full deadline — that is the reason to open the dossier at all.
 */
export function WhatsComing({ occasions, referenceDate }: WhatsComingProps) {
  const now = referenceDate ?? new Date();
  const nowTime = now.getTime();

  const events = useMemo(() => {
    const reference = new Date(nowTime);
    return [...occasions]
      .map((occasion) => ({
        occasion,
        daysUntil: getDaysUntilOccasion(occasion, reference),
        date: getNextOccurrence(occasion, reference),
        plan: getActByPlan(occasion, reference),
      }))
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [occasions, nowTime]);

  return (
    <section style={cardStyle} data-testid="dossier-whats-coming">
      <div style={cardHeadStyle}>
        <h2 style={cardTitleStyle}>What&rsquo;s coming</h2>
      </div>

      {events.length === 0 ? (
        <p style={cardEmptyStyle} data-testid="dossier-whats-coming-empty">
          No dates yet. Tell me her birthday and I will start counting down to it —
          and tell you when to start planning.
        </p>
      ) : (
        <div style={timelineStyle}>
          <div style={spineStyle} aria-hidden="true" />
          {events.map(({ occasion, daysUntil, date, plan }) => {
            const isSoon = daysUntil <= SOON_DAYS;
            return (
              <div
                key={occasion.fieldId}
                style={eventStyle}
                data-testid="dossier-event"
                data-soon={isSoon ? 'true' : 'false'}
              >
                <div style={isSoon ? dotSoonStyle : dotStyle} aria-hidden="true" />
                <div style={rowStyle}>
                  <b style={labelStyle}>{occasion.label}</b>
                  <span style={dateStyle}>{EVENT_DATE.format(date)}</span>
                  <span style={isSoon ? countdownSoonStyle : countdownStyle}>
                    {formatCountdown(daysUntil)}
                  </span>
                </div>
                <div style={actByStyle} data-testid="dossier-act-by">
                  <i style={actByIconStyle} aria-hidden="true">
                    &#9727;
                  </i>
                  <b style={actByLabelStyle}>{plan.label}</b>
                  <em style={actByAheadStyle}>&middot; {plan.ahead}</em>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
