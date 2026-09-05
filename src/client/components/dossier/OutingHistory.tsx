import { colors, typography } from '../../design-system/tokens';
import { outingHistory, type Outing } from '../../../shared/interfaces/outing';
import {
  cardCountStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  linenWash,
} from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';
import {
  isRated,
  OutingSurvey,
  OutingVerdictPill,
  type OutingRatePatch,
} from './OutingSurvey';

/**
 * Where he has taken her, and the survey for the ones he has not answered on yet.
 *
 * Newest first, which is the order the question "have we been anywhere lately?"
 * is asked in — and the opposite of `unratedOutings`, whose oldest-first order is
 * about which memory is fading fastest. Both orders are right for their own job;
 * this card is a record, not a queue.
 *
 * ## Where this renders now
 *
 * Not on the dossier board — `EventTimeline` shows these rows in date order
 * against her upcoming dates, which is what the board wanted. This card is kept
 * as the standalone list because it is the only surface that shows outings
 * *without* needing her occasions derived, and its behaviour is pinned by tests
 * the timeline's own tests do not replace.
 *
 * The survey itself lives in `OutingSurvey`, shared with the timeline: the
 * question has to be asked identically in both places or the two disagree about
 * what closes a row.
 *
 * Only *past* rows get asked about. A table booked for next Friday cannot be
 * rated, and offering hearts against it would invite an answer about the booking
 * rather than about the evening.
 *
 * Deliberately not routed through `ProfileField.tsx`: that component dispatches on
 * a registry field's `valueType`, and an outing is not a field on her profile.
 */

const wrapperStyle: React.CSSProperties = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
};

const rowStyle: React.CSSProperties = { padding: '12px 0' };

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: `1.5px solid ${linenWash(0.55)}`,
};

const headLineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
};

const placeStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  lineHeight: 1.35,
  color: colors.ink,
  flex: 1,
  minWidth: 0,
};

const whenStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkMuted,
  whiteSpace: 'nowrap',
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.body,
  lineHeight: 1.5,
  color: colors.inkMuted,
};

/** `'12 Jun'`, or the day it was booked when nobody recorded a date for it. */
function whenLabel(outing: Outing): string {
  const iso = outing.occursOn ?? outing.confirmedAt.slice(0, 10);
  const day = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(day.getTime())) return '';
  return day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Whether the evening has happened, so it can be rated.
 *
 * Compared as date strings rather than instants: an outing has a *day*, not a
 * time, and a `Date` built from a bare `YYYY-MM-DD` is midnight UTC — which in
 * Israel makes tonight's dinner look like yesterday's for the first three hours
 * of every day. A row with no date at all counts as past, because the only thing
 * that produced it was a confirmed booking in the past.
 */
export function hasHappened(outing: Outing, now: Date = new Date()): boolean {
  if (!outing.occursOn) return true;
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
  return outing.occursOn <= today;
}

interface OutingHistoryProps {
  outings: Outing[];
  /** Records her answer. One call covers the stars and the verdict alike. */
  onRate: (outingId: string, patch: OutingRatePatch) => void;
  now?: Date;
}

export function OutingHistory({ outings, onRate, now = new Date() }: OutingHistoryProps) {
  const ordered = outingHistory(outings);
  const waiting = ordered.filter((outing) => hasHappened(outing, now) && !isRated(outing));

  return (
    <section style={wrapperStyle} data-testid="dossier-outing-history">
      <div style={cardHeadStyle}>
        <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
          <DossierIcon name="pin" size={18} />
        </span>
        <h2 style={cardTitleStyle}>Where you&rsquo;ve been</h2>
        <span style={cardCountStyle}>
          {waiting.length > 0 ? `${waiting.length} to rate` : `${ordered.length} places`}
        </span>
      </div>

      {ordered.length === 0 ? (
        <p style={emptyStyle}>
          Nowhere yet. Book somewhere through me and it lands here, so I stop
          suggesting the places that did not land.
        </p>
      ) : (
        ordered.map((outing, index) => {
          const rated = isRated(outing);
          const askable = !rated && hasHappened(outing, now);

          return (
            <div
              key={outing.id}
              style={index === 0 ? rowStyle : dividedRowStyle}
              data-testid={`outing-row-${outing.id}`}
              data-rated={rated ? 'true' : 'false'}
            >
              <div style={headLineStyle}>
                <span style={placeStyle}>
                  {outing.venueName}
                  {outing.city ? `, ${outing.city}` : ''}
                </span>
                <span style={whenStyle}>{whenLabel(outing)}</span>
              </div>

              {rated && <OutingVerdictPill outing={outing} />}

              {askable && <OutingSurvey outing={outing} onRate={onRate} />}
            </div>
          );
        })
      )}
    </section>
  );
}
