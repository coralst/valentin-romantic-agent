import { colors, radii, typography } from '../../design-system/tokens';
import { confidenceWord } from '../../utils/confidence-wording';
import { describeProvenance } from '../../utils/provenance';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';
import { getFieldById } from '../../utils/profile-field-registry';
import { resolveField } from '../../utils/preference-field-mapper';
import {
  cardCountStyle,
  cardHeadStyle,
  cardTitleStyle,
  insetRing,
  paleCardStyle,
} from './board-tones';
import { dossierType } from './dossier-icons';

/**
 * A discovered value Valentin is not confident enough to state as fact.
 *
 * Below this the value is a guess worth settling; at or above it, saying "did I
 * get this right?" about something he is 90% sure of is just noise. The same
 * 0.5/0.9 scale `confidence-wording.ts` already collapses to words.
 */
const GUESS_CONFIDENCE_CEILING = 0.9;

export interface Guess {
  /** Stable across re-extraction, unlike the server-assigned `preference.id`. */
  id: string;
  /** The registry field this promotes into, when it resolves to one. */
  fieldId: string | null;
  /** "Hobbies?" — what he thinks he knows, as a question. */
  question: string;
  /** The value itself, so ✓ can promote exactly it. */
  value: string;
  /** "likely" / "maybe". */
  confidence: string;
  /** The provenance line, or null when nothing true can be said. */
  provenance: string | null;
}

/**
 * Turn the low-confidence discoveries into settleable guesses.
 *
 * Only preferences that resolve to a registry field are offered: ✓ promotes the
 * value with `SET_MANUAL_VALUE`, which is keyed by field id, so an unresolved
 * preference has nowhere to be promoted *to*. Those are shown in "Also
 * mentioned" instead, where they are at least visible.
 */
export function deriveGuesses(
  preferences: readonly PreferenceWithHistory[],
  messages: readonly ChatMessage[] = [],
  isManual: (fieldId: string) => boolean = () => false,
  isRejected: (fieldId: string) => boolean = () => false,
): Guess[] {
  const guesses: Guess[] = [];

  for (const preference of preferences) {
    if (preference.confidence >= GUESS_CONFIDENCE_CEILING) continue;

    const fieldId = resolveField(preference.category, preference.key);
    if (!fieldId) continue;
    // Already settled by hand — asking again would undo the user's own answer.
    if (isManual(fieldId)) continue;
    // Already declined. The preference is still in the store, so without this the
    // question re-derives on the very next render and ✗ looks like a no-op.
    if (isRejected(fieldId)) continue;

    const definition = getFieldById(fieldId);
    const provenance = describeProvenance(preference, messages);

    guesses.push({
      id: `${preference.category}:${preference.key}`,
      fieldId,
      question: `${definition?.label ?? preference.key}: ${preference.value}?`,
      value: preference.value,
      confidence: confidenceWord(preference.confidence),
      provenance: provenance?.line ?? null,
    });
  }

  return guesses;
}

/**
 * How many guesses the card shows at once.
 *
 * Found by screenshot rather than by reasoning: the seeded demo profile produces
 * ten guesses, and rendering all of them made this card ~2000px tall in a
 * 3-column board, so it alone set the board's scroll height and left an empty
 * two-thirds beside it. Three is a queue you can clear; ten is a form. The
 * counter in the head still reports the true total, and the rest surface as you
 * settle these.
 */
const VISIBLE_GUESSES = 3;

interface ConfirmMyGuessesProps {
  guesses: Guess[];
  /** ✓ — promote the guess to a stated fact at the same value. */
  onConfirm: (guess: Guess) => void;
  /** ✗ — clear it, so Valentin stops acting on it. */
  onReject: (guess: Guess) => void;
}

const guessStyle: React.CSSProperties = {
  background: colors.porcelain,
  borderRadius: radii.panel,
  padding: '12px 14px',
  marginBottom: 8,
  // A claret ring rather than a gold one: this card asks a question, it does not
  // warn. Gold is reserved for "Keep in mind", which has to stay expensive.
  boxShadow: insetRing('rgba(177, 74, 98, 0.22)'),
};

const questionStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  color: colors.ink,
};

/**
 * Provenance, where the mockup put invented reasoning.
 *
 * `full-profile.html:328` writes "I inferred this because she surfs…". Nothing in
 * the schema holds that sentence and nothing in the pipeline produces one — see
 * the long note in `utils/provenance.ts`. This line says when he picked the value
 * up, which is true, useful, and needs no schema change.
 */
const provenanceStyle: React.CSSProperties = {
  margin: '3px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.45,
  color: colors.inkMuted,
};

const confidenceStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: colors.claretLight,
  marginLeft: 8,
};

const remainingStyle: React.CSSProperties = {
  margin: '2px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkFaint,
};

const buttonsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 7,
  marginTop: 10,
  flexWrap: 'wrap',
};

const buttonBaseStyle: React.CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  borderRadius: radii.pill,
  padding: '7px 14px',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
};

const yesStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  background: colors.olive,
  color: colors.textOnAccent,
};

const noStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  background: colors.linenShade,
  color: colors.inkMuted,
};

/**
 * The guesses, made settleable.
 *
 * `confidence` already exists per-preference, so the question and the two buttons
 * are real behaviour rather than decoration: ✓ dispatches `SET_MANUAL_VALUE` with
 * the *same* value, which promotes it out of the guess pile — manual values
 * always win over discovered ones and are never revisited by ingestion — and ✗
 * clears it.
 *
 * Renders nothing when everything Valentin knows he is sure of. An empty
 * "Confirm my guesses" card is a prompt with no question in it.
 */
export function ConfirmMyGuesses({ guesses, onConfirm, onReject }: ConfirmMyGuessesProps) {
  if (guesses.length === 0) return null;

  const visible = guesses.slice(0, VISIBLE_GUESSES);
  const remaining = guesses.length - visible.length;

  return (
    <section style={paleCardStyle} data-testid="dossier-guesses">
      <div style={cardHeadStyle}>
        <h2 style={cardTitleStyle}>Confirm my guesses</h2>
        <span style={cardCountStyle}>{guesses.length}</span>
      </div>

      {visible.map((guess) => (
        <div key={guess.id} style={guessStyle} data-testid="dossier-guess">
          <div style={questionStyle}>
            {guess.question}
            <span style={confidenceStyle}>{guess.confidence}</span>
          </div>
          {guess.provenance && <p style={provenanceStyle}>{guess.provenance}</p>}
          <div style={buttonsStyle}>
            <button
              type="button"
              style={yesStyle}
              onClick={() => onConfirm(guess)}
              data-testid="dossier-guess-confirm"
            >
              &#10003; That&rsquo;s right
            </button>
            <button
              type="button"
              style={noStyle}
              onClick={() => onReject(guess)}
              data-testid="dossier-guess-reject"
            >
              Not quite
            </button>
          </div>
        </div>
      ))}

      {remaining > 0 && (
        <p style={remainingStyle} data-testid="dossier-guesses-remaining">
          {remaining} more once you have settled these.
        </p>
      )}
    </section>
  );
}
