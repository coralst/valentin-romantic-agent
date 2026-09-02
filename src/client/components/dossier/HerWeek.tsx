import { colors, typography } from '../../design-system/tokens';
import { rhythmHeight, type RhythmEntry } from '../../utils/list-field-parsing';
import { askPillStyle } from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';
import { tileHeadStyle, tileStyle, tileTitleStyle } from './tile-tones';

/**
 * Which of her evenings are already hers.
 *
 * The tile that stops him planning a dinner on a Tuesday she spends at pottery.
 * Seven columns, Monday first, one bar per evening — the shape is the content, and
 * a sentence ("pottery on Tuesdays and her mother on Sundays") cannot be scanned
 * for a free night the way seven bars can.
 *
 * An empty day is drawn as an empty column and not as a short bar. A Wednesday she
 * never mentioned is a Wednesday I know nothing about, and a stub of a bar there
 * would claim she is a little bit busy.
 */

const chartStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 4,
};

const columnStyle: React.CSSProperties = {
  minWidth: 0,
  textAlign: 'center',
};

const dayLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  color: colors.inkFaint,
};

const busyDayLabelStyle: React.CSSProperties = {
  ...dayLabelStyle,
  color: colors.claret,
};

const trackStyle: React.CSSProperties = {
  height: 56,
  marginTop: 5,
  borderRadius: 8,
  background: colors.sand,
  display: 'flex',
  alignItems: 'flex-end',
  overflow: 'hidden',
};

function barStyle(percent: number): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    height: `${percent}%`,
    borderRadius: 8,
    background: `linear-gradient(180deg, #C4566E, ${colors.claret})`,
  };
}

const legendStyle: React.CSSProperties = { marginTop: 'auto', paddingTop: 10 };

const legendRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.35,
  color: colors.ink,
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.45,
  color: colors.inkMuted,
};

/** Monday first, like the calendar above it. `Date.getDay()` indices. */
const WEEK: ReadonlyArray<{ weekday: number; initial: string; name: string }> = [
  { weekday: 1, initial: 'M', name: 'Monday' },
  { weekday: 2, initial: 'T', name: 'Tuesday' },
  { weekday: 3, initial: 'W', name: 'Wednesday' },
  { weekday: 4, initial: 'T', name: 'Thursday' },
  { weekday: 5, initial: 'F', name: 'Friday' },
  { weekday: 6, initial: 'S', name: 'Saturday' },
  { weekday: 0, initial: 'S', name: 'Sunday' },
];

/** Short day name, for the legend: "Tue — pottery until nine". */
const SHORT_NAMES: Readonly<Record<number, string>> = {
  0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
};

interface HerWeekProps {
  entries: RhythmEntry[];
  onAsk: () => void;
}

export function HerWeek({ entries, onAsk }: HerWeekProps) {
  /*
   * The heaviest thing on each day.
   *
   * Two commitments on one evening still draw one bar — the bar is "how much of
   * this evening is gone", and stacking them would make a Tuesday with two small
   * things look busier than a Tuesday she spends the whole of.
   */
  const byDay = new Map<number, RhythmEntry>();
  for (const entry of entries) {
    const held = byDay.get(entry.weekday);
    if (!held || rhythmHeight(entry.weight) > rhythmHeight(held.weight)) {
      byDay.set(entry.weekday, entry);
    }
  }

  const legend = WEEK.map((day) => byDay.get(day.weekday)).filter(
    (entry): entry is RhythmEntry => entry !== undefined && entry.label.length > 0,
  );

  return (
    <div style={tileStyle} data-testid="dossier-her-week" data-days={byDay.size}>
      <h4 style={tileHeadStyle}>
        <DossierIcon name="clock" size={16} />
        <span style={tileTitleStyle}>Her week</span>
      </h4>

      {entries.length === 0 ? (
        <>
          <p style={emptyStyle}>
            I don&rsquo;t know how her week runs. Which evenings are already hers?
          </p>
          <button
            type="button"
            style={{ ...askPillStyle, alignSelf: 'flex-start', marginTop: 10 }}
            onClick={onAsk}
            aria-label="Ask about how her week runs"
            data-testid="her-week-ask"
          >
            Ask
          </button>
        </>
      ) : (
        <>
          <div style={chartStyle} data-testid="her-week-chart">
            {WEEK.map((day) => {
              const entry = byDay.get(day.weekday);
              return (
                <div
                  key={day.name}
                  style={columnStyle}
                  data-testid="her-week-column"
                  data-weekday={day.weekday}
                  data-weight={entry?.weight ?? 'free'}
                  title={entry ? `${day.name} — ${entry.label}` : `${day.name} — free`}
                >
                  <div style={entry ? busyDayLabelStyle : dayLabelStyle} aria-hidden="true">
                    {day.initial}
                  </div>
                  <div style={trackStyle}>
                    {entry && <i style={barStyle(rhythmHeight(entry.weight))} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* The legend is the accessible version of the chart: the bars carry no
              text, so the words under them are what a screen reader reads. */}
          <div style={legendStyle}>
            {legend.map((entry) => (
              <div key={`${entry.weekday}-${entry.label}`} style={legendRowStyle}>
                <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
                  <DossierIcon name="clock" size={16} />
                </span>
                {SHORT_NAMES[entry.weekday]} — {entry.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
