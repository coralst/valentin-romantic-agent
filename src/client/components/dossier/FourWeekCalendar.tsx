import { colors, radii, typography } from '../../design-system/tokens';
import type { AgendaRow, CalendarDay, DayMark, FourWeeks } from '../../utils/four-week-calendar';
import { cardCountStyle, cardHeadStyle, cardStyle, cardTitleStyle, goldWash, GOLD_INK, linenWash } from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';

/**
 * The next four weeks, and the three things in them.
 *
 * The board's top-left half. It replaced three "triage" columns that split one
 * axis — time — three ways; a grid says the same thing in one glance and says the
 * part those columns could not, which is *how far apart* the dates are.
 *
 * Read-only on purpose. Every marker on it is owned somewhere else — the dates by
 * the profile fields, the birthdays by her family, the deadlines by his to-do
 * list — and a calendar you could edit would be a fourth place to change a date
 * from, with no way to say which of the four you meant.
 */

const wrapperStyle: React.CSSProperties = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
};

const dowsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 5,
};

const dowStyle: React.CSSProperties = {
  textAlign: 'center',
  paddingBottom: 5,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 5,
};

/**
 * One day.
 *
 * `aspectRatio` rather than a fixed height so the grid keeps its proportions
 * across the board's whole range of measures — 652px to 908px, per the container
 * query in `global-styles.ts`. Slightly wider than tall, because the dots sit on a
 * row of their own under the numeral and a square cell crowds them.
 */
const cellStyle: React.CSSProperties = {
  aspectRatio: '1 / 0.9',
  borderRadius: 12,
  background: colors.porcelain,
  padding: '6px 7px',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const pastCellStyle: React.CSSProperties = {
  ...cellStyle,
  background: linenWash(0.35),
};

const todayCellStyle: React.CSSProperties = {
  ...cellStyle,
  background: colors.cream,
  boxShadow: `inset 0 0 0 2px ${colors.claret}`,
};

/** The single lit cell. See `isKey` — at most one in four weeks. */
const keyCellStyle: React.CSSProperties = {
  ...cellStyle,
  background: `linear-gradient(150deg, ${colors.claret}, #B9455C)`,
  color: colors.textOnAccent,
  boxShadow: '0 6px 16px rgba(140, 47, 69, 0.3)',
};

const deadlineCellStyle: React.CSSProperties = {
  ...cellStyle,
  background: '#FFF4E6',
  boxShadow: `inset 0 0 0 1.5px ${goldWash(0.45)}`,
};

const numeralStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  lineHeight: 1,
};

const pastNumeralStyle: React.CSSProperties = {
  ...numeralStyle,
  fontWeight: typography.weights.medium,
  color: colors.inkFaint,
};

const noteStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.2,
  color: colors.inkFaint,
};

const marksStyle: React.CSSProperties = {
  marginTop: 'auto',
  display: 'flex',
  gap: 3,
  paddingTop: 4,
};

/** The dot's ink, by what it means. Rhythm is the faintest: it is hers, not his. */
const MARK_INK: Readonly<Record<DayMark, string>> = {
  occasion: colors.claretLight,
  birthday: colors.claretLight,
  deadline: colors.gold,
  rhythm: 'rgba(140, 47, 69, 0.28)',
};

function markStyle(mark: DayMark, onKeyCell: boolean): React.CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    // On the lit cell every dot goes cream: claret on claret is invisible.
    background: onKeyCell ? colors.textOnAccent : MARK_INK[mark],
  };
}

const rhythmNoteStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '11px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkMuted,
};

const agendaStyle: React.CSSProperties = { marginTop: 13 };

const agendaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  padding: '10px 0',
};

const dividedAgendaRowStyle: React.CSSProperties = {
  ...agendaRowStyle,
  borderTop: `1.5px solid ${linenWash(0.55)}`,
};

const whenStyle: React.CSSProperties = {
  flex: 'none',
  width: 66,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  fontVariantNumeric: 'tabular-nums',
  color: colors.claret,
};

const whatStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.35,
};

const detailStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkMuted,
};

const tagBaseStyle: React.CSSProperties = {
  flex: 'none',
  padding: '5px 11px',
  borderRadius: radii.pill,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  whiteSpace: 'nowrap',
};

const TAG_STYLES: Readonly<Record<AgendaRow['tone'], React.CSSProperties>> = {
  key: { ...tagBaseStyle, background: colors.claret, color: colors.textOnAccent },
  deadline: {
    ...tagBaseStyle,
    background: '#FFF4E6',
    color: GOLD_INK,
    boxShadow: `inset 0 0 0 1.5px ${goldWash(0.45)}`,
  },
  plain: {
    ...tagBaseStyle,
    background: colors.porcelain,
    color: colors.inkMuted,
    boxShadow: `inset 0 0 0 1.5px ${colors.linenShade}`,
  },
};

const emptyStyle: React.CSSProperties = {
  margin: '13px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.5,
  color: colors.inkMuted,
};

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface FourWeekCalendarProps {
  calendar: FourWeeks;
  agenda: AgendaRow[];
  /** The evenings she already spends, phrased — the legend under the grid. */
  rhythmNote: string | null;
}

function cellStyleFor(day: CalendarDay): React.CSSProperties {
  if (day.isKey) return keyCellStyle;
  if (day.isToday) return todayCellStyle;
  if (day.isDeadline) return deadlineCellStyle;
  if (day.isPast) return pastCellStyle;
  return cellStyle;
}

export function FourWeekCalendar({ calendar, agenda, rhythmNote }: FourWeekCalendarProps) {
  return (
    <section style={wrapperStyle} data-testid="dossier-four-weeks">
      <div style={cardHeadStyle}>
        <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
          <DossierIcon name="calendar" size={18} />
        </span>
        <h2 style={cardTitleStyle}>The next four weeks</h2>
        <span style={cardCountStyle}>{calendar.range}</span>
      </div>

      {/* The weekday header is decoration: every cell below carries its own full
          date in the accessible name, so announcing "Mon Tue Wed…" first would
          read the week twice. */}
      <div style={dowsStyle} aria-hidden="true">
        {DOW_LABELS.map((label) => (
          <span key={label} style={dowStyle}>
            {label}
          </span>
        ))}
      </div>

      <div style={gridStyle} data-testid="four-week-grid">
        {calendar.weeks.flat().map((day) => (
          <div
            key={day.date.toISOString()}
            style={cellStyleFor(day)}
            data-testid="four-week-cell"
            data-today={day.isToday ? 'true' : undefined}
            data-key={day.isKey ? 'true' : undefined}
            data-deadline={day.isDeadline ? 'true' : undefined}
            data-past={day.isPast ? 'true' : undefined}
            data-marks={day.marks.join(' ')}
          >
            <span style={day.isPast ? pastNumeralStyle : numeralStyle}>
              {day.dayOfMonth}
            </span>
            {day.isToday ? (
              <span style={{ ...noteStyle, color: colors.claret }}>Today</span>
            ) : day.note ? (
              <span style={{ ...noteStyle, color: 'rgba(255, 249, 245, 0.82)' }}>
                {day.note}
              </span>
            ) : (
              day.monthLabel && <span style={noteStyle}>{day.monthLabel}</span>
            )}
            {day.marks.length > 0 && (
              <span style={marksStyle} aria-hidden="true">
                {day.marks.map((mark) => (
                  <i key={mark} style={markStyle(mark, day.isKey)} />
                ))}
              </span>
            )}
          </div>
        ))}
      </div>

      {rhythmNote && (
        <p style={rhythmNoteStyle} data-testid="four-week-rhythm-note">
          <i
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              flex: 'none',
              background: MARK_INK.rhythm,
            }}
            aria-hidden="true"
          />
          {rhythmNote}
        </p>
      )}

      {agenda.length === 0 ? (
        <p style={emptyStyle}>
          Nothing dated in the next four weeks. Tell me her birthday or when you
          got together and this fills in.
        </p>
      ) : (
        <div style={agendaStyle} data-testid="four-week-agenda">
          {agenda.map((row, index) => (
            <div
              key={`${row.when}-${row.title}`}
              style={index === 0 ? agendaRowStyle : dividedAgendaRowStyle}
              data-testid="four-week-agenda-row"
              data-tone={row.tone}
            >
              <span style={whenStyle}>{row.when}</span>
              <span style={whatStyle}>
                {row.title}
                {row.detail && <span style={detailStyle}>{row.detail}</span>}
              </span>
              <span style={TAG_STYLES[row.tone]}>{row.tag}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
