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
  GENERATION_ORDER,
  groupByGeneration,
} from '../../utils/people-derivation';
import { cardEmptyStyle, cardHeadStyle, cardTitleStyle } from './board-tones';
import { toneCountStyle, toneGlyphStyle, tonedCardStyle } from './accent-tones';
import { DossierIcon, dossierType } from './dossier-icons';

/**
 * Her family, drawn.
 *
 * The one card on the board that exists so a *name* is never lost. Everything
 * else here can be re-derived from a conversation; the fact that her sister is
 * called Leah cannot be, and being unable to produce it at a dinner table is the
 * specific failure this card prevents.
 *
 * Drawn as three rows with connectors rather than listed, because a list of
 * "mother: Miriam / sister: Leah / niece: Noa" does not show you that Noa belongs
 * to Leah, and the shape is what makes it memorable.
 *
 * The gap cards are the second half of the idea: someone you have mentioned but
 * never named is recorded with a dashed border and a question mark, so the card
 * shows what it is missing instead of quietly omitting it. Each one is a question
 * Valentin can ask.
 */

const treeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  paddingTop: 2,
};

/**
 * One generation: a centred, wrapping row.
 *
 * Wrapping rather than scrolling because a family is small but not bounded, and
 * a row that scrolls hides people — which is the failure mode of the card.
 */
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 10,
  position: 'relative',
};

/**
 * The connector between rows.
 *
 * A 1px rule above the row rather than per-node SVG lines: at three rows and a
 * wrapping flexbox, exact node-to-node lines would need measured positions and a
 * resize observer to stay attached, and they would be wrong the moment a row
 * wrapped. The rule reads as "this row descends from the one above", which is all
 * the diagram has to say.
 */
const connectorStyle: React.CSSProperties = {
  position: 'absolute',
  left: '22%',
  right: '22%',
  top: -10,
  height: 1,
  background: colors.linenShade,
};

const nodeBaseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  minWidth: 132,
  maxWidth: 230,
  padding: '8px 11px',
  borderRadius: radii.kv,
  background: colors.porcelain,
  border: `1px solid ${colors.linenShade}`,
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
  color: colors.ink,
};

/** Her own card: the only filled one, so the eye finds her first. */
const herNodeStyle: React.CSSProperties = {
  ...nodeBaseStyle,
  background: colors.claret,
  borderColor: 'transparent',
  color: colors.textOnAccent,
};

/** A person recorded without a name — dashed, and quieter. */
const gapNodeStyle: React.CSSProperties = {
  ...nodeBaseStyle,
  borderStyle: 'dashed',
  borderColor: colors.warmTaupe,
  background: 'transparent',
  color: colors.inkMuted,
};

const initialStyle: React.CSSProperties = {
  flex: 'none',
  width: 26,
  height: 26,
  borderRadius: radii.pill,
  display: 'grid',
  placeItems: 'center',
  background: '#F9EDF3',
  color: '#A05A7A',
  fontFamily: typography.headingFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1,
};

const herInitialStyle: React.CSSProperties = {
  ...initialStyle,
  background: 'rgba(255, 255, 255, 0.22)',
  color: colors.textOnAccent,
};

const nameStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  lineHeight: 1.25,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const roleStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 1,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkMuted,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const herRoleStyle: React.CSSProperties = {
  ...roleStyle,
  color: 'rgba(255, 255, 255, 0.78)',
};

const dateStyle: React.CSSProperties = {
  flex: 'none',
  marginLeft: 'auto',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.06em',
  color: colors.inkFaint,
  whiteSpace: 'nowrap',
};

const legendStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  marginTop: 16,
  paddingTop: 11,
  borderTop: `1px dashed ${colors.linenShade}`,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkMuted,
};

const swatchStyle = (background: string, dashed = false): React.CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  marginRight: 5,
  borderRadius: 2,
  background: dashed ? 'transparent' : background,
  border: dashed ? `1px dashed ${colors.warmTaupe}` : undefined,
  verticalAlign: 'middle',
});

const addStyle: React.CSSProperties = {
  ...nodeBaseStyle,
  minWidth: 0,
  borderStyle: 'dashed',
  borderColor: colors.linenShade,
  background: 'transparent',
  color: colors.claret,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  justifyContent: 'center',
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
  /** Her own name, so she can be drawn in the middle row with the others. */
  partnerName: string | null;
  /** Opens a person for editing. */
  onSelectPerson: (person: Person) => void;
  /** Starts a new record on the given row. */
  onAddPerson: (generation: PersonGeneration) => void;
  /** Fills the composer with the question a gap implies. */
  onAskAboutGap: (person: Person) => void;
  now?: Date;
}

export function FamilyTree({
  people,
  partnerName,
  onSelectPerson,
  onAddPerson,
  onAskAboutGap,
  now = new Date(),
}: FamilyTreeProps) {
  const rows = groupByGeneration(people);
  const gaps = countGaps(people);
  const named = people.length - gaps;

  return (
    <section style={tonedCardStyle('kin')} data-testid="dossier-family-tree">
      <div style={cardHeadStyle}>
        <span style={toneGlyphStyle('kin')} aria-hidden="true">
          <DossierIcon name="people" size={16} />
        </span>
        <h2 style={cardTitleStyle}>Her people</h2>
        <span style={toneCountStyle('kin')}>
          {people.length === 0
            ? 'nobody yet'
            : `${named} named${gaps > 0 ? ` · ${gaps} ${gaps === 1 ? 'gap' : 'gaps'}` : ''}`}
        </span>
      </div>

      {people.length === 0 ? (
        <div>
          <p style={cardEmptyStyle}>
            Nobody here yet. Add her mother, her sister, the friend she talks about
            most — and I&rsquo;ll keep their names and birthdays so you never have to
            reach for one.
          </p>
          <button
            type="button"
            style={{ ...addStyle, marginTop: 12 }}
            onClick={() => onAddPerson('peer')}
            data-testid="family-tree-add-first"
          >
            &#43;&nbsp; Add someone
          </button>
        </div>
      ) : (
        <div style={treeStyle}>
          {GENERATION_ORDER.map((generation) => {
            const row = rows[generation];
            const isPeerRow = generation === 'peer';
            // Her own card belongs on the peer row even though she is not a
            // record in the store — the tree is *hers*, so leaving her out makes
            // it a diagram of a family she is not in.
            //
            // All three rows are drawn even when empty, holding only their `+`.
            // Skipping them looked tidier and made the card unusable: with a
            // mother and a sister recorded but no children, there was no way to
            // *start* a younger person — the only route was to add them to
            // another row and then change the row select, which nothing tells
            // you about. An empty row is one 30px button, which is a fair price.

            return (
              <div key={generation} style={rowStyle} data-testid={`family-row-${generation}`}>
                {generation !== 'elder' && <span style={connectorStyle} aria-hidden="true" />}

                {isPeerRow && (
                  <span style={herNodeStyle} data-testid="family-node-her">
                    <span style={herInitialStyle} aria-hidden="true">
                      {(partnerName ?? '?').charAt(0).toUpperCase()}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <b style={nameStyle}>{partnerName ?? 'Her'}</b>
                      <span style={herRoleStyle}>Her</span>
                    </span>
                  </span>
                )}

                {row.map((person) => {
                  const gap = isGap(person);
                  const chip = person.birthday ? formatDateChip(person.birthday, now) : null;
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
                          ? 'I know they exist but not their name — ask me and I’ll write it down'
                          : (person.note ?? undefined)
                      }
                    >
                      <span style={initialStyle} aria-hidden="true">
                        {gap ? '?' : displayName(person).charAt(0).toUpperCase()}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <b style={nameStyle}>{displayName(person)}</b>
                        <span style={roleStyle}>
                          {gap
                            ? 'Mentioned — no name yet'
                            : [person.relationship, person.note].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {chip && <span style={dateStyle}>{chip}</span>}
                    </button>
                  );
                })}

                <button
                  type="button"
                  style={addStyle}
                  onClick={() => onAddPerson(generation)}
                  aria-label={`Add someone to the ${generation} row`}
                  data-testid={`family-add-${generation}`}
                >
                  &#43;
                </button>
              </div>
            );
          })}
        </div>
      )}

      {people.length > 0 && (
        <div style={legendStyle}>
          <span>
            <i style={swatchStyle(colors.claret)} aria-hidden="true" />
            Her
          </span>
          <span>
            <i style={swatchStyle('#A05A7A')} aria-hidden="true" />
            Name known
          </span>
          <span>
            <i style={swatchStyle('transparent', true)} aria-hidden="true" />
            Gap — press to ask
          </span>
        </div>
      )}
    </section>
  );
}
