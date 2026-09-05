import { colors, radii, typography } from '../../design-system/tokens';
import {
  OUTING_VERDICTS,
  type Outing,
  type OutingVerdict,
} from '../../../shared/interfaces/outing';
import { goldWash, GOLD_INK } from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';

/**
 * "How was it?" — the hearts and the verdict, against one venue.
 *
 * Extracted from `OutingHistory` unchanged so the timeline can ask the same
 * question in the same words with the same controls. Two copies of a survey is
 * how one of them quietly stops writing `verdict`, or starts asking about a
 * table that has not happened yet.
 *
 * The rules it carries with it, both load-bearing:
 *
 *  - **A star closes the survey; a verdict alone does not.** `rating` is the
 *    field `unratedOutings` looks for and the one `placesToAvoid` thresholds on,
 *    so collapsing the controls on a verdict would leave the row unrated forever
 *    with nowhere left to answer.
 *  - **Only past rows may be asked about.** The caller decides that — see
 *    `hasHappened` — because "how was it?" against next Friday's booking invites
 *    an answer about the booking rather than about the evening.
 */

/** Whether the row still needs an answer. A number, not a verdict, closes it. */
export function isRated(outing: Outing): boolean {
  return outing.rating !== null && outing.rating !== undefined;
}

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

/** Her answer, once there is one. Gold, because it is the payoff of the row. */
export const verdictPillStyle: React.CSSProperties = {
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

export interface OutingRatePatch {
  rating?: number | null;
  verdict?: OutingVerdict | null;
}

interface OutingSurveyProps {
  outing: Outing;
  /** Records her answer. One call covers the stars and the verdict alike. */
  onRate: (outingId: string, patch: OutingRatePatch) => void;
}

export function OutingSurvey({ outing, onRate }: OutingSurveyProps) {
  return (
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
              outing.verdict === verdict ? chosenVerdictButtonStyle : verdictButtonStyle
            }
            onClick={() => onRate(outing.id, { verdict })}
            aria-pressed={outing.verdict === verdict}
          >
            {verdict}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Her recorded answer: "4/5 — again". Rendered wherever a rated row is drawn. */
export function OutingVerdictPill({ outing }: { outing: Outing }) {
  return (
    <span style={verdictPillStyle}>
      {outing.rating}/5{outing.verdict ? ` — ${outing.verdict}` : ''}
    </span>
  );
}
