import { typography } from '../../design-system/tokens';
import type { PinnedDate } from '../../utils/pinned-dates';
import { DossierIcon } from '../dossier/dossier-icons';
import { SectionHead } from './SectionHead';
import { onClaret, ROW_HAIRLINE } from './rail-tones';

/**
 * The days that come round every year, whether or not anyone wrote them down.
 *
 * Distinct from "Coming next" above it, which counts down the dates *he told
 * Valentin about*. These three are the calendar's own: her birthday, Valentine's,
 * and Tu B'Av. Two of the three the app knows without being told, which is the
 * whole reason the block exists — a rail that only reminds you of what you have
 * already entered cannot remind you of the one you forgot.
 *
 * Tu B'Av carries `heart-star`, the same heart as Valentine's with a Magen David
 * inside it. They are the same day for the same purpose in two calendars; giving
 * them unrelated marks would say they were different kinds of occasion.
 */

const stackStyle: React.CSSProperties = {
  borderRadius: 15,
  overflow: 'hidden',
  background: onClaret(0.07),
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 13px',
};

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: ROW_HAIRLINE,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: onClaret(0.72),
};

const labelStyle: React.CSSProperties = {
  color: '#FBEFF1',
  fontWeight: typography.weights.semibold,
  fontSize: typography.px.body,
};

const countdownStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.semibold,
  fontVariantNumeric: 'tabular-nums',
  color: '#F2D4D8',
  whiteSpace: 'nowrap',
};

/**
 * `'288d'`, `'today'` — and nothing at all when the date could not be worked out.
 *
 * A missing countdown is left blank rather than shown as `'—'`: the row's job is
 * the reminder, and a dash beside a date reads as an error in the date.
 */
function countdown(daysUntil: number | null): string {
  if (daysUntil === null) return '';
  if (daysUntil === 0) return 'today';
  return `${daysUntil}d`;
}

interface PinnedEveryYearProps {
  dates: PinnedDate[];
}

export function PinnedEveryYear({ dates }: PinnedEveryYearProps) {
  if (dates.length === 0) return null;

  return (
    <>
      <SectionHead label="Pinned every year" count={dates.length} />
      <div style={stackStyle} data-testid="brief-pinned">
        {dates.map((date, index) => (
          <div
            key={date.id}
            style={index === 0 ? rowStyle : dividedRowStyle}
            data-testid={`brief-pinned-${date.id}`}
          >
            <span style={{ color: '#F2D4D8', display: 'flex' }} aria-hidden="true">
              <DossierIcon name={date.icon} size={16} />
            </span>
            <span style={bodyStyle}>
              <b style={labelStyle}>{date.label}</b> {date.when}
            </span>
            <span style={countdownStyle}>{countdown(date.daysUntil)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
