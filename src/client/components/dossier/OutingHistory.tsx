import { colors, radii, typography } from '../../design-system/tokens';
import {
  outingHistory,
  OUTING_VERDICTS,
  type Outing,
  type OutingVerdict,
} from '../../../shared/interfaces/outing';
import {
  cardCountStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  goldWash,
  GOLD_INK,
  linenWash,
} from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';

/**
 * Where he has taken her, and the survey for the ones he has not answered on yet.
 *
 * Newest first, which is the order the question "have we been anywhere lately?"
 * is asked in — and the opposite of `unratedOutings`, whose oldest-first order is
 * about which memory is fading fastest. Both orders are right for their own job;
 * this card is a record, not a queue.
 *
 * ## Why the survey is rendered inline instead of as its own card
 *
 * The survey is not a separate feature. It is the missing half of one row, and it
 * has to appear against the venue name for the question to mean anything — "how
 * was it?" with no place attached is unanswerable. So an unrated past row grows
 * the controls in place and loses them again the moment it is answered, and the
 * card never announces "1 survey waiting" as though it were a chore.
 *
 * Only *past* rows get it. A table booked for next Friday cannot be rated, and
 * offering stars against it would invite an answer about the booking rather than
 * about the evening.
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

/** Her answer, once there is one. Gold, because it is the payoff of the row. */
const verdictPillStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 6,
  padding: '4px 10px',
  borderRadius: radii.pill,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  background: '#FFF4E6',
  color: GOLD_INK,
  boxShadow: `inset 0 0 0 1.5px ${goldWash(0.45)}`,
};

const surveyStyle: React.CSSProperties = {
  marginTop: 8,
  padding: '10px 12px',
  borderRadius: radii.kv,
  background: colors.porcelain,
};

const askStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.ink,
};

const starRowStyle: React.CSSProperties = { display: 'flex', gap: 4, marginBottom: 8 };

const starButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 2,
  cursor: 'pointer',
  display: 'flex',
  color: colors.linenShade,
  font: 'inherit',
};

const litStarStyle: React.CSSProperties = { ...starButtonStyle, color: colors.claret };

const verdictRowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

const verdictButtonStyle: React.CSSProperties = {
  padding: '5px 11px',
  borderRadius: radii.pill,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  background: colors.porcelain,
  color: colors.inkMuted,
  boxShadow: `inset 0 0 0 1.5px ${colors.linenShade}`,
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** The verdict he has already picked, while the stars are still outstanding. */
const chosenVerdictButtonStyle: React.CSSProperties = {
  ...verdictButtonStyle,
  background: colors.claret,
  color: colors.textOnAccent,
  boxShadow: 'none',
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

/**
 * A star is what closes the survey; a verdict on its own does not.
 *
 * Both are useful, but the number is the part the recommendation logic reads
 * (`placesToAvoid` thresholds on it), and it is the same field `unratedOutings`
 * looks for — so if a verdict alone collapsed the controls, the row would sit
 * unrated forever with nowhere left to answer.
 */
function isRated(outing: Outing): boolean {
  return outing.rating !== null && outing.rating !== undefined;
}

interface OutingHistoryProps {
  outings: Outing[];
  /** Records her answer. One call covers the stars and the verdict alike. */
  onRate: (
    outingId: string,
    patch: { rating?: number | null; verdict?: OutingVerdict | null },
  ) => void;
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

              {rated && (
                <span style={verdictPillStyle}>
                  {outing.rating}/5{outing.verdict ? ` — ${outing.verdict}` : ''}
                </span>
              )}

              {askable && (
                <div style={surveyStyle} data-testid={`outing-survey-${outing.id}`}>
                  <p style={askStyle}>How was it?</p>

                  <div style={starRowStyle} role="group" aria-label={`Rate ${outing.venueName}`}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        style={star <= (outing.rating ?? 0) ? litStarStyle : starButtonStyle}
                        onClick={() => onRate(outing.id, { rating: star })}
                        aria-label={`${star} out of 5`}
                      >
                        <DossierIcon name="heart" size={20} />
                      </button>
                    ))}
                  </div>

                  <div style={verdictRowStyle}>
                    {OUTING_VERDICTS.map((verdict) => (
                      <button
                        key={verdict}
                        type="button"
                        style={
                          outing.verdict === verdict
                            ? chosenVerdictButtonStyle
                            : verdictButtonStyle
                        }
                        onClick={() => onRate(outing.id, { verdict })}
                        aria-pressed={outing.verdict === verdict}
                      >
                        {verdict}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
