import { colors, radii, typography } from '../../design-system/tokens';
import { displayName, type Person } from '../../../shared/interfaces/person';
import { upcomingBirthdays } from '../../utils/people-derivation';
import { cardEmptyStyle, cardHeadStyle, cardTitleStyle, FIELD_HAIRLINE } from './board-tones';
import { toneCountStyle, toneGlyphStyle, tonedCardStyle } from './accent-tones';

/**
 * Their birthdays — her people, soonest first.
 *
 * Separate from `WhatsComing`, which is the spine of *her* dates. A sister's
 * birthday is a different kind of obligation: it needs no plan and no budget,
 * only a name and a day, and mixing the two would either bury her anniversary
 * among six other people's birthdays or drop them from the page entirely.
 */

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 0',
  borderBottom: FIELD_HAIRLINE,
};

const lastRowStyle: React.CSSProperties = { ...rowStyle, borderBottom: 'none' };

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
  fontSize: typography.px.small,
  lineHeight: 1,
};

const nameStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  fontWeight: typography.weights.semibold,
  color: colors.ink,
};

const whoStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 1,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  color: colors.inkMuted,
};

const awayStyle: React.CSSProperties = {
  flex: 'none',
  marginLeft: 'auto',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  fontWeight: typography.weights.semibold,
  color: '#A05A7A',
  whiteSpace: 'nowrap',
};

/** Today and tomorrow get words; everything else gets a number of days. */
function formatAway(daysUntil: number): string {
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return `${daysUntil}d`;
}

function formatDay(birthday: string): string {
  const parsed = new Date(birthday);
  if (Number.isNaN(parsed.getTime())) return '';
  // UTC, for the same reason as in `FamilyTree`: a bare `YYYY-MM-DD` is UTC
  // midnight, so local formatting would show every birthday a day early.
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

interface TheirBirthdaysProps {
  people: Person[];
  /** Shown as a row's second line: "Her sister · 9 Sep". */
  onSelectPerson: (person: Person) => void;
  now?: Date;
  /** How many rows to show before the card stops growing. */
  limit?: number;
}

export function TheirBirthdays({
  people,
  onSelectPerson,
  now = new Date(),
  limit = 5,
}: TheirBirthdaysProps) {
  const all = upcomingBirthdays(people, now);
  const shown = all.slice(0, limit);
  const next = shown[0];

  return (
    <section style={tonedCardStyle('kin')} data-testid="dossier-their-birthdays">
      <div style={cardHeadStyle}>
        <i style={toneGlyphStyle('kin')} aria-hidden="true">
          &#9737;
        </i>
        <h2 style={cardTitleStyle}>Their birthdays</h2>
        {next && <span style={toneCountStyle('kin')}>next {formatAway(next.daysUntil)}</span>}
      </div>

      {shown.length === 0 ? (
        <p style={cardEmptyStyle}>
          No birthdays yet. Add one to her mother or her sister and I&rsquo;ll count
          the days down for you — remembering theirs lands harder than remembering
          hers.
        </p>
      ) : (
        <div>
          {shown.map((entry, index) => (
            <button
              key={entry.person.id}
              type="button"
              style={{
                ...(index === shown.length - 1 ? lastRowStyle : rowStyle),
                width: '100%',
                background: 'none',
                border: 'none',
                borderBottom:
                  index === shown.length - 1 ? 'none' : FIELD_HAIRLINE,
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
              }}
              onClick={() => onSelectPerson(entry.person)}
              data-testid={`birthday-row-${entry.person.id}`}
            >
              <span style={initialStyle} aria-hidden="true">
                {displayName(entry.person).charAt(0).toUpperCase()}
              </span>
              <span style={{ minWidth: 0 }}>
                <b style={nameStyle}>{displayName(entry.person)}</b>
                <span style={whoStyle}>
                  {entry.person.relationship} · {formatDay(entry.person.birthday as string)}
                </span>
              </span>
              <span style={awayStyle}>{formatAway(entry.daysUntil)}</span>
            </button>
          ))}
          {all.length > shown.length && (
            <p style={{ ...cardEmptyStyle, marginTop: 10 }}>
              and {all.length - shown.length} more, further out
            </p>
          )}
        </div>
      )}
    </section>
  );
}
