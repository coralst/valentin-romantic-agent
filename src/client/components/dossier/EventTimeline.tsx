import { colors, radii, typography } from '../../design-system/tokens';
import type { Outing } from '../../../shared/interfaces/outing';
import {
  relativeDayLabel,
  type EventTimeline as Timeline,
  type TimelineEntry,
} from '../../utils/event-timeline';
import {
  cardCountStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  goldWash,
  GOLD_INK,
  insetRing,
  linenWash,
} from './board-tones';
import { DossierIcon, dossierType, type DossierIconName } from './dossier-icons';
import {
  isRated,
  OutingSurvey,
  OutingVerdictPill,
  type OutingRatePatch,
} from './OutingSurvey';

/**
 * The two of you on one spine: what is coming, then everywhere you have been.
 *
 * ## Why a spine and not two lists side by side
 *
 * The point of the card is the *join* — "we go somewhere every anniversary, and
 * last year's place was a mistake" was previously two separate readings on two
 * separate cards. A single vertical rule with today marked on it makes the
 * relationship between a plan and a memory the thing you see first.
 *
 * ## Why today is drawn as a divider and not as a heading
 *
 * Because it moves. A heading would say "Past" and be a claim about the rows; the
 * divider says "today" and is a claim about the *date*, which is the only thing
 * that actually separates the halves. It also means a row can cross it overnight
 * without anything being relabelled — a booking becomes a memory by the date
 * passing, and the survey appears on it for exactly that reason.
 *
 * The survey is `OutingSurvey`, the same component `OutingHistory` asks with, so
 * the two surfaces cannot disagree about what closes a row.
 */

const wrapperStyle: React.CSSProperties = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
};

/** The spine's gutter: rail on the left, row content to its right. */
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '22px 1fr',
  gap: 12,
  padding: '10px 0',
};

/** The vertical rule, drawn as a border on the marker column. */
const railStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  justifyContent: 'center',
  /*
   * The line is on this column rather than on the section, so it starts at the
   * first row and stops at the last — a rule that overshot the rows read as a
   * border on the card.
   */
  borderLeft: `2px solid ${linenWash(0.9)}`,
  marginLeft: 9,
};

const markerBase: React.CSSProperties = {
  position: 'absolute',
  top: 2,
  left: -11,
  width: 20,
  height: 20,
  borderRadius: radii.pill,
  display: 'grid',
  placeItems: 'center',
  background: colors.sand,
};

/** An upcoming row: claret, because it is something still to do. */
const upcomingMarkerStyle: React.CSSProperties = {
  ...markerBase,
  color: colors.claret,
  boxShadow: insetRing(colors.petal),
};

/** A past row: muted, because it is a record. */
const pastMarkerStyle: React.CSSProperties = {
  ...markerBase,
  color: colors.inkMuted,
  boxShadow: insetRing(colors.linenShade),
};

const bodyStyle: React.CSSProperties = { minWidth: 0, paddingBottom: 2 };

const titleLineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  flexWrap: 'wrap',
};

const titleStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.body,
  fontWeight: typography.weights.semibold,
  lineHeight: 1.3,
  color: colors.ink,
  minWidth: 0,
};

const relativeStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  color: colors.claret,
  whiteSpace: 'nowrap',
};

const pastRelativeStyle: React.CSSProperties = {
  ...relativeStyle,
  color: colors.inkMuted,
  fontWeight: typography.weights.normal,
};

const whenStyle: React.CSSProperties = {
  margin: '2px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkMuted,
};

/** The act-by chip: what to do, by when. Gold, and louder once it is overdue. */
const actByStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 6,
  padding: '4px 10px',
  borderRadius: radii.pill,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  background: goldWash(0.14),
  color: GOLD_INK,
  boxShadow: insetRing(goldWash(0.35)),
};

const urgentActByStyle: React.CSSProperties = {
  ...actByStyle,
  background: colors.petal,
  color: colors.claret,
  boxShadow: insetRing('rgba(140, 47, 69, 0.28)'),
};

const noteStyle: React.CSSProperties = {
  margin: '5px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.45,
  color: colors.inkMuted,
  fontStyle: 'italic',
};

/** The "today" rule, which is what actually separates the halves. */
const todayStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  margin: '8px 0',
};

const todayLabelStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.claret,
};

const todayRuleStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: colors.linenShade,
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.body,
  lineHeight: 1.5,
  color: colors.inkMuted,
};

/** What each kind of row wears. A date is a calendar; a place is a pin. */
const ICON_BY_KIND: Readonly<Record<TimelineEntry['kind'], DossierIconName>> = {
  occasion: 'calendar',
  booking: 'clock',
  outing: 'pin',
};

interface EventTimelineProps {
  timeline: Timeline;
  /** Records her answer on a past row. Same signature as `OutingHistory`. */
  onRate: (outingId: string, patch: OutingRatePatch) => void;
}

function Row({
  entry,
  onRate,
}: {
  entry: TimelineEntry;
  onRate: (outingId: string, patch: OutingRatePatch) => void;
}) {
  const upcoming = entry.side === 'upcoming';
  const outing: Outing | undefined = entry.outing;
  const rated = outing ? isRated(outing) : false;
  /*
   * Only a past outing may be asked about — the derivation already decided which
   * side the row is on, so this is `side`, not a second date comparison. Two
   * places deciding "has this happened" is two places to get it wrong.
   */
  const askable = Boolean(outing) && !upcoming && !rated;

  return (
    <div
      style={rowStyle}
      data-testid={`timeline-row-${entry.id}`}
      data-side={entry.side}
      data-kind={entry.kind}
    >
      <div style={railStyle}>
        <span
          style={upcoming ? upcomingMarkerStyle : pastMarkerStyle}
          aria-hidden="true"
        >
          <DossierIcon name={ICON_BY_KIND[entry.kind]} size={13} />
        </span>
      </div>

      <div style={bodyStyle}>
        <div style={titleLineStyle}>
          <span style={titleStyle}>
            {entry.title}
            {entry.place ? `, ${entry.place}` : ''}
          </span>
          <span style={upcoming ? relativeStyle : pastRelativeStyle}>
            {relativeDayLabel(entry.daysFromToday)}
          </span>
        </div>

        <p style={whenStyle}>{entry.when}</p>

        {entry.actBy && (
          <span
            style={entry.isUrgent ? urgentActByStyle : actByStyle}
            data-testid={`timeline-act-by-${entry.id}`}
          >
            {entry.actBy}
          </span>
        )}

        {outing?.note && <p style={noteStyle}>{outing.note}</p>}

        {outing && rated && <OutingVerdictPill outing={outing} />}

        {askable && outing && <OutingSurvey outing={outing} onRate={onRate} />}
      </div>
    </div>
  );
}

export function EventTimeline({ timeline, onRate }: EventTimelineProps) {
  const { upcoming, past } = timeline;
  const waiting = past.filter((entry) => entry.outing && !isRated(entry.outing)).length;
  const total = upcoming.length + past.length;

  return (
    <section style={wrapperStyle} data-testid="dossier-event-timeline">
      <div style={cardHeadStyle}>
        <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
          <DossierIcon name="clock" size={18} />
        </span>
        <h2 style={cardTitleStyle}>The two of you</h2>
        <span style={cardCountStyle}>
          {waiting > 0
            ? `${waiting} to rate`
            : `${upcoming.length} ahead · ${past.length} behind`}
        </span>
      </div>

      {total === 0 ? (
        <p style={emptyStyle} data-testid="timeline-empty">
          Nothing on the spine yet. Tell me a date that matters — her birthday, your
          anniversary — and book somewhere through me; both land here, in order.
        </p>
      ) : (
        <>
          {upcoming.map((entry) => (
            <Row key={entry.id} entry={entry} onRate={onRate} />
          ))}

          <div style={todayStyle} data-testid="timeline-today">
            <span style={todayLabelStyle}>Today</span>
            <span style={todayRuleStyle} />
          </div>

          {past.length === 0 ? (
            <p style={emptyStyle} data-testid="timeline-no-past">
              Nowhere yet. Book somewhere through me and it lands below this line,
              so I stop suggesting the places that did not land.
            </p>
          ) : (
            past.map((entry) => <Row key={entry.id} entry={entry} onRate={onRate} />)
          )}
        </>
      )}
    </section>
  );
}
