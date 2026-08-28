import { colors, radii, typography } from '../../design-system/tokens';
import {
  displayName,
  isGap,
  type Person,
  type PersonGeneration,
} from '../../../shared/interfaces/person';
import {
  countGaps,
  daysUntilBirthday,
  GENERATION_LABELS,
  GENERATION_ORDER,
  groupByGeneration,
} from '../../utils/people-derivation';
import {
  cardCountStyle,
  cardEmptyStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
} from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';

/**
 * Her family, drawn — the whole width of the board, and the reason the board is
 * three bands rather than a grid of thirds.
 *
 * The one card here that exists so a *name* is never lost. Everything else can be
 * re-derived from a conversation; the fact that her sister is called Nadia cannot
 * be, and being unable to produce it at a dinner table is the specific failure
 * this card prevents.
 *
 * Four generations, top to bottom, each on a centred row with a rung between it
 * and the one above. Four rather than three because grandparents are a real rung
 * of a family and folding Miriam in with Ruth and Daniel says she is their
 * sibling.
 *
 * NODES ARE 134px WIDE AND THE NUMBER IS LOAD-BEARING. It is the width at which
 * her own generation — her, her sister, her sister's husband, two cousins and her
 * closest friend — fits on one line in the card's measure. A seventh card orphaned
 * onto a second row reads as a descendant, which is a claim about her family the
 * app has no basis for.
 *
 * The gap cards are the second half of the idea: someone mentioned but never named
 * is drawn with a ring and a question mark, so the tree shows what it is missing
 * instead of quietly omitting it. Each one is a question Valentin can ask.
 */

const treeStyle: React.CSSProperties = {
  paddingTop: 2,
};

const bandLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
  textAlign: 'center',
  marginBottom: 9,
};

/**
 * One generation: a centred, wrapping row.
 *
 * Wrapping rather than scrolling, because a family is small but not bounded and a
 * row that scrolls hides people — which is the failure mode of the card.
 */
const bandStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 10,
};

/**
 * The rung between two generations: a rule with a centred drop.
 *
 * Enough to read as descent without pretending to know who descends from whom —
 * which the app genuinely does not know. Per-node lines would need measured
 * positions and a resize observer to stay attached, and would be wrong the moment
 * a row wrapped.
 */
const rungStyle: React.CSSProperties = {
  height: 30,
  position: 'relative',
};

const rungRuleStyle: React.CSSProperties = {
  position: 'absolute',
  left: '12%',
  right: '12%',
  top: 14,
  height: 2,
  background: `linear-gradient(90deg, transparent, ${colors.linenShade} 12%, ${colors.linenShade} 88%, transparent)`,
};

const rungDropStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: 14,
  width: 2,
  height: 16,
  background: colors.linenShade,
  transform: 'translateX(-1px)',
};

const nodeBaseStyle: React.CSSProperties = {
  width: 134,
  flex: 'none',
  background: colors.porcelain,
  borderRadius: radii.kv,
  padding: '12px 11px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 6,
  position: 'relative',
  border: 'none',
  cursor: 'pointer',
  font: 'inherit',
  color: colors.ink,
};

/** The stub joining a node up to its rung. Suppressed on the top band. */
const nodeStubStyle: React.CSSProperties = {
  position: 'absolute',
  top: -14,
  left: '50%',
  width: 2,
  height: 14,
  background: colors.linenShade,
  transform: 'translateX(-1px)',
};

/** Her own card: the only filled one, so the eye finds her first. */
const herNodeStyle: React.CSSProperties = {
  ...nodeBaseStyle,
  background: `linear-gradient(150deg, ${colors.claret}, #A8394F)`,
  color: colors.textOnAccent,
  boxShadow: '0 8px 22px rgba(140, 47, 69, 0.26)',
  cursor: 'default',
};

/** A person recorded without a name. */
const gapNodeStyle: React.CSSProperties = {
  ...nodeBaseStyle,
  background: 'none',
  boxShadow: `inset 0 0 0 2px ${colors.linenShade}`,
};

const initialStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: colors.blush,
  color: colors.deepPlum,
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.semibold,
  fontSize: dossierType.small,
  lineHeight: 1,
};

const herInitialStyle: React.CSSProperties = {
  ...initialStyle,
  background: 'rgba(255, 249, 245, 0.2)',
  color: colors.textOnAccent,
};

const gapInitialStyle: React.CSSProperties = {
  ...initialStyle,
  background: 'none',
  color: colors.inkFaint,
  boxShadow: `inset 0 0 0 2px ${colors.linenShade}`,
};

const nameStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  lineHeight: 1.15,
};

const gapNameStyle: React.CSSProperties = { ...nameStyle, color: colors.inkFaint };

/**
 * The relationship, wrapping freely.
 *
 * No ellipsis: "uncle, mother's side" is the useful half of what the tree knows
 * about him, and truncating it to "uncle, moth…" in a 134px card would lose the
 * side of the family — which is the part that tells you whose birthday it is.
 */
const roleStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.25,
  color: colors.inkMuted,
};

const herRoleStyle: React.CSSProperties = {
  ...roleStyle,
  color: 'rgba(255, 249, 245, 0.78)',
};

const dateStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  fontVariantNumeric: 'tabular-nums',
  color: colors.claret,
};

const herDateStyle: React.CSSProperties = { ...dateStyle, color: colors.blush };

/** The claret pill on a gap: the question, as a button. */
const fixStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: radii.pill,
  border: 'none',
  cursor: 'pointer',
  background: colors.claret,
  color: colors.textOnAccent,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
};

/** The `+` that starts a record on a band. Sized like a node so rows stay even. */
const addStyle: React.CSSProperties = {
  ...nodeBaseStyle,
  background: 'none',
  boxShadow: `inset 0 0 0 2px ${colors.linenShade}`,
  color: colors.claret,
  justifyContent: 'center',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  minHeight: 96,
};

/** "9 Sep" — the date without the year, which is the part you need. */
function formatDay(birthday: string): string | null {
  const parsed = new Date(birthday);
  if (Number.isNaN(parsed.getTime())) return null;
  // `timeZone: 'UTC'` because a bare `YYYY-MM-DD` parses as UTC midnight: without
  // it, a 9 September birthday renders as "8 Sep" for anyone west of Greenwich.
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "9 Sep · 18d" once a birthday is close enough to act on. */
function formatDateChip(birthday: string, now: Date): string | null {
  const day = formatDay(birthday);
  if (!day) return null;
  const days = daysUntilBirthday(birthday, now);
  if (days === null || days > 30) return day;
  return days === 0 ? `${day} · today` : `${day} · ${days}d`;
}

interface FamilyTreeProps {
  people: Person[];
  /** Her own name, so she can be drawn on her own band with the others. */
  partnerName: string | null;
  /**
   * Her birthday, so her own card carries a date like everyone else's.
   *
   * Passed in rather than read from the profile store here: this component is
   * given her family, and reaching past its props for one more field of hers
   * would make the tree impossible to render from a fixture.
   */
  partnerBirthday?: string | null;
  /** Opens a person for editing. */
  onSelectPerson: (person: Person) => void;
  /** Starts a new record on the given band. */
  onAddPerson: (generation: PersonGeneration) => void;
  /** Fills the composer with the question a gap implies. */
  onAskAboutGap: (person: Person) => void;
  now?: Date;
}

export function FamilyTree({
  people,
  partnerName,
  partnerBirthday = null,
  onSelectPerson,
  onAddPerson,
  onAskAboutGap,
  now = new Date(),
}: FamilyTreeProps) {
  const bands = groupByGeneration(people);
  const gaps = countGaps(people);
  const herBirthday = partnerBirthday ? formatDateChip(partnerBirthday, now) : null;

  return (
    <section style={cardStyle} data-testid="dossier-family-tree">
      <div style={cardHeadStyle}>
        <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
          <DossierIcon name="people" size={18} />
        </span>
        <h2 style={cardTitleStyle}>Her family</h2>
        <span style={cardCountStyle}>
          {people.length === 0
            ? 'nobody yet'
            : `${people.length} known${gaps > 0 ? ` · ${gaps} still unnamed` : ''}`}
        </span>
      </div>

      {people.length === 0 ? (
        <div>
          <p style={cardEmptyStyle}>
            Nobody here yet. Tell me about her mother, her sister, the friend she
            talks about most — and I&rsquo;ll keep their names and birthdays so you
            never have to reach for one.
          </p>
          <button
            type="button"
            style={{ ...addStyle, marginTop: 12, minHeight: 0, width: 'auto', padding: '10px 18px' }}
            onClick={() => onAddPerson('peer')}
            data-testid="family-tree-add-first"
          >
            &#43;&nbsp; Add someone
          </button>
        </div>
      ) : (
        <div style={treeStyle} data-testid="family-tree-bands">
          {GENERATION_ORDER.map((generation, bandIndex) => {
            const band = bands[generation];
            const isPeerBand = generation === 'peer';
            // Every band is drawn even when empty, holding only its `+`. Skipping
            // the empty ones looked tidier and made the card unusable: with a
            // mother and a sister recorded but no children, there was no way to
            // *start* a younger person.
            //
            // The top band's nodes carry no stub, because there is no rung above
            // them for one to reach — a stub there points at nothing.
            const isTopBand = bandIndex === 0;

            return (
              <div key={generation}>
                {!isTopBand && (
                  <div style={rungStyle} aria-hidden="true">
                    <span style={rungRuleStyle} />
                    <span style={rungDropStyle} />
                  </div>
                )}

                <div style={bandLabelStyle}>{GENERATION_LABELS[generation]}</div>

                <div style={bandStyle} data-testid={`family-band-${generation}`}>
                  {isPeerBand && (
                    <span style={herNodeStyle} data-testid="family-node-her">
                      {!isTopBand && <span style={nodeStubStyle} aria-hidden="true" />}
                      <span style={herInitialStyle} aria-hidden="true">
                        {(partnerName ?? '?').charAt(0).toUpperCase()}
                      </span>
                      <span style={nameStyle}>{partnerName ?? 'Her'}</span>
                      <span style={herRoleStyle}>her</span>
                      {herBirthday && <span style={herDateStyle}>{herBirthday}</span>}
                    </span>
                  )}

                  {band.map((person) => {
                    const gap = isGap(person);
                    const chip = person.birthday
                      ? formatDateChip(person.birthday, now)
                      : null;
                    return (
                      <button
                        key={person.id}
                        type="button"
                        style={gap ? gapNodeStyle : nodeBaseStyle}
                        onClick={() => (gap ? onAskAboutGap(person) : onSelectPerson(person))}
                        data-testid={`family-node-${person.id}`}
                        data-gap={gap ? 'true' : 'false'}
                        title={
                          gap
                            ? 'I know they exist but not their name — press to ask'
                            : (person.note ?? undefined)
                        }
                      >
                        {!isTopBand && <span style={nodeStubStyle} aria-hidden="true" />}
                        <span style={gap ? gapInitialStyle : initialStyle} aria-hidden="true">
                          {gap ? '?' : displayName(person).charAt(0).toUpperCase()}
                        </span>
                        <span style={gap ? gapNameStyle : nameStyle}>
                          {gap ? 'Unnamed' : displayName(person)}
                        </span>
                        <span style={roleStyle}>{person.relationship}</span>
                        {gap ? (
                          <span style={fixStyle}>Ask her</span>
                        ) : (
                          <span style={dateStyle}>{chip ?? '—'}</span>
                        )}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    style={addStyle}
                    onClick={() => onAddPerson(generation)}
                    aria-label={`Add someone to ${GENERATION_LABELS[generation].toLowerCase()}`}
                    data-testid={`family-add-${generation}`}
                  >
                    {!isTopBand && <span style={nodeStubStyle} aria-hidden="true" />}
                    &#43;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
