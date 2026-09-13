import { useCallback, useState } from 'react';
import { AWS_CATEGORY_COLORS, type AwsCategory } from '../utils/aws-diagram-layout';
import { colors, typography } from '../design-system/tokens';
import type { GlowTarget } from '../utils/glow-target';

/**
 * The running list beside the diagram: what happened, where, and how long it took.
 *
 * The diagram answers "where is the traffic"; this answers "what was the call".
 * Newest group first, because on stage the thing that just happened is the thing
 * being talked about.
 */

export interface FeedRow {
  /** Stable key. */
  key: string;
  /** Short service name — the column is 70px, so 'DynamoDB', not 'Amazon DynamoDB'. */
  service: string;
  operation: string;
  /** Categories and sort keys only. Never a preference's value. */
  detail: string;
  /** Duration, already formatted. Em dash for a beat that had no measured call. */
  durationLabel: string;
  category: AwsCategory;
  /** Who acted — groups the row. */
  actor: string;
  /** What they were doing — captions the group. */
  action: string;
  /** True for the step currently on the diagram. */
  isCurrent?: boolean;
  /**
   * X-Ray trace id, when the call reported one — only engine B's Runtime does.
   *
   * Rendered as selectable monospace text rather than a console link: the URL
   * differs by region and account, and a link that 404s on stage is worse than a
   * value someone can copy. On its own line so it never squeezes the detail column.
   */
  traceId?: string;
  /**
   * Wall-clock time the beat happened, already formatted — `14:07:22`.
   *
   * Absent for a scripted step, which happened at no time at all. The column is
   * still reserved so the rows of a mixed list stay in one set of columns.
   */
  timeLabel?: string;
  /**
   * What this row put on screen, so pointing at it can glow the thing itself.
   *
   * Absent on rows that produced no element — a scripted demo step, a Bedrock
   * span — and those rows stay inert rather than becoming controls that do
   * nothing when pressed.
   */
  targets?: readonly GlowTarget[];
}

export interface AwsFlowFeedProps {
  rows: readonly FeedRow[];
  /** Right-hand summary, e.g. `6 spans · 2 model calls`. */
  summary: string;
  /** Heading — `Live flow` or `Demo flow`, so nobody mistakes one for the other. */
  heading: string;
  /** Shown when there is nothing yet. */
  emptyMessage?: string;
  /**
   * Makes each user action pickable, and replays it when picked.
   *
   * Optional because the feed is also rendered where there is nothing to replay
   * *to* — omit it and the groups are captions again, exactly as before.
   */
  onSelectGroup?: (group: FeedGroup) => void;
  /** The group being replayed, if any. Its steps stay expanded; the rest fold up. */
  selectedGroupId?: string | null;
  /**
   * Start with every group's steps showing instead of folded.
   *
   * Off by default: the feed is an index of actions first and a log second, and a
   * turn is a dozen spans — forty rows of them pushed the actions a presenter has to
   * point at off the bottom of the panel. Callers that render the feed as a plain
   * log (and the tests that assert over rows) opt back in.
   */
  startExpanded?: boolean;
  /**
   * Glow what this group produced, for as long as the pointer or focus is on it.
   *
   * Called with `null` on the way out. Separate from `onSelectGroup` because a
   * hover is a question and a click is an answer: sweeping the list to find the
   * turn you mean must not start a replay or move the transcript.
   */
  onHoverGroup?: (group: FeedGroup | null) => void;
  /**
   * Glow one step's own output, rather than everything its group produced.
   *
   * A group is a run of consecutive beats, so "learns something new · 6" holds six
   * different facts. Pointing at the group glows all six; pointing at a step
   * glows the one. Supplying this is what turns the steps into controls.
   */
  onSelectRow?: (row: FeedRow) => void;
  /** Hover half of `onSelectRow`. Called with `null` on the way out. */
  onHoverRow?: (row: FeedRow | null) => void;
  /**
   * The group id or row key whose glow is currently held on.
   *
   * One value for both, because only one thing can be pinned at a time and two
   * pieces of state could disagree about which.
   */
  glowingKey?: string | null;
}

export interface FeedGroup {
  /**
   * The first row's key. A group has no identity of its own — it is a run of rows
   * that happen to share an actor and an action — and the alternative, an index into
   * the reversed list, changes the moment a new beat arrives, which would move the
   * selection onto a different action mid-replay.
   */
  id: string;
  actor: string;
  action: string;
  rows: FeedRow[];
}

/**
 * Group consecutive rows that are the same actor doing the same thing.
 *
 * Keyed on actor *and* action, not action alone: the mockup keyed on the caption
 * only, so two adjacent groups that happened to share a caption but had different
 * actors would silently merge into one.
 *
 * Consecutive, deliberately — not "all rows with this caption". "Valentin writes a
 * reply" happens once per turn, and collapsing every turn into one group would
 * produce a single ever-growing blob no presenter could point at.
 */
export function groupFeedRows(rows: readonly FeedRow[]): FeedGroup[] {
  const groups: FeedGroup[] = [];

  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.actor === row.actor && last.action === row.action) {
      last.rows.push(row);
    } else {
      groups.push({ id: row.key, actor: row.actor, action: row.action, rows: [row] });
    }
  }

  return groups;
}

/**
 * The replay affordance's words, in one place because the drawer's own replay
 * banner has to agree with the feed's — two spellings of the same feature read as
 * two features.
 */
export const REPLAY_COPY = {
  action: 'Replay',
  replaying: 'Replaying',
  /** Bare glyph on the unselected groups: forty of them, so it has to be quiet. */
  glyph: '↻',
} as const;

/**
 * The words for pointing at a step and lighting up what it produced.
 *
 * "Show" rather than "Highlight" or "Glow": the accessible name has to say what
 * pressing it does for someone who cannot see the result, and what it does is
 * show you where that step landed in the app.
 */
export const GLOW_COPY = {
  action: 'Show what this produced',
} as const;

/**
 * The fold affordance's words, in one place for the same reason as `REPLAY_COPY`.
 *
 * Chevrons rather than +/−: the control reveals a list underneath itself, which is
 * a disclosure, and a `+` in a log reads as "add a row".
 */
export const FOLD_COPY = {
  expand: 'Show steps',
  collapse: 'Hide steps',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  folded: '▸',
  unfolded: '▾',
} as const;

const headingStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#A3959C',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 7,
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  // The time is the last column, not the first: the eye scans this list for *what*
  // happened, and a leading clock column would push the service name away from the
  // coloured category chip that qualifies it.
  gridTemplateColumns: '16px 66px 1fr 46px 52px',
  gap: 8,
  alignItems: 'center',
  padding: '5px 0',
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 10.5,
};

/** Times are identifiers to line up, not prose — mono and tabular, like the trace id. */
const timeStyle: React.CSSProperties = {
  textAlign: 'right',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: typography.px.micro,
  color: '#A3959C',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

/** Bare glyph buttons: the panel is 260px wide and there is one per group. */
const foldButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: '0 2px',
  width: 14,
  fontSize: 9,
  lineHeight: 1,
  color: '#A3959C',
  cursor: 'pointer',
  flexShrink: 0,
};

export function AwsFlowFeed({
  rows,
  summary,
  heading,
  emptyMessage,
  onSelectGroup,
  selectedGroupId = null,
  startExpanded = false,
  onHoverGroup,
  onSelectRow,
  onHoverRow,
  glowingKey = null,
}: AwsFlowFeedProps) {
  // Newest first: reversed here rather than at the call site so the caller can
  // keep its rows in the order the traffic actually happened.
  const groups = groupFeedRows(rows).reverse();

  /*
   * Only the groups whose fold a person has actually touched.
   *
   * An override map rather than a set of open ids, because "unset" has to stay
   * distinguishable from "closed": groups arrive while the panel is open, and a set
   * of open ids cannot tell a new group (fold it) from one the presenter closed
   * (leave it closed) — nor honour `startExpanded` for arrivals.
   */
  const [foldOverrides, setFoldOverrides] = useState<Readonly<Record<string, boolean>>>({});

  const toggleFold = useCallback((groupId: string, expanded: boolean) => {
    setFoldOverrides((current) => ({ ...current, [groupId]: !expanded }));
  }, []);

  const setAllFolds = useCallback(
    (expanded: boolean) => {
      setFoldOverrides(Object.fromEntries(groups.map((group) => [group.id, expanded])));
    },
    [groups],
  );

  // Expand-all is offered when anything is folded, collapse-all when anything is
  // open, so the one control always does something.
  const someFolded = groups.some((group) => (foldOverrides[group.id] ?? startExpanded) === false);

  return (
    <div
      style={{
        flex: 1,
        /*
         * A floor, not `0`.
         *
         * The diagram beside this is a fixed 933px wide, so the feed used to take
         * whatever was left over — which on a 1440px screen is about 120px, narrow
         * enough that every operation truncated to nothing and the action captions
         * were unreadable. That was survivable while the feed was a passive log; it
         * is not now that choosing an action out of it is how a replay starts. The
         * row that holds both already scrolls horizontally, so on a small window the
         * diagram's far right edge — the shaded half's tool target — goes off the
         * side instead of the entire log becoming useless. On a presentation screen
         * neither has to give anything up.
         */
        // Was 260 before the rows carried a clock column; the detail column is the
        // one that gives way when the panel is squeezed, and at 260 it had nothing
        // left to give.
        minWidth: 300,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid #E5D9D2',
        paddingLeft: 18,
        fontFamily: typography.bodyFontFamily,
      }}
      data-testid="aws-flow-feed"
    >
      <div style={headingStyle}>
        <span>{heading}</span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {groups.length > 0 && (
            <button
              type="button"
              onClick={() => setAllFolds(someFolded)}
              data-testid="aws-feed-fold-all"
              style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                font: 'inherit',
                color: '#8C2F45',
                cursor: 'pointer',
              }}
            >
              {someFolded ? FOLD_COPY.expandAll : FOLD_COPY.collapseAll}
            </button>
          )}
          <span>{summary}</span>
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          /*
           * Room for the scrollbar, taken before it appears.
           *
           * The right-most things in this list are now a clock time and the replay
           * glyph. On a platform with classic (space-taking) scrollbars they sat
           * underneath one — invisible on macOS, where scrollbars are overlays, and
           * clipped everywhere else. A reserved gutter costs 8px and does not move
           * when the list starts scrolling.
           */
          scrollbarGutter: 'stable',
          paddingRight: 8,
        }}
      >
        {groups.length === 0 && emptyMessage && (
          <div style={{ fontSize: 11, color: '#A3959C', lineHeight: 1.6, paddingTop: 4 }}>
            {emptyMessage}
          </div>
        )}

        {groups.map((group) => {
          const isCurrent = group.rows.some((row) => row.isCurrent);
          const isSelected = selectedGroupId !== null && selectedGroupId === group.id;
          // Picking one action folds the others down to their captions. The ask was
          // to choose an action and see *its* steps; leaving forty rows expanded
          // underneath the chosen one buries the thing that was chosen.
          const defaultExpanded = selectedGroupId !== null ? isSelected : startExpanded;
          const isExpanded = foldOverrides[group.id] ?? defaultExpanded;
          const isCollapsed = !isExpanded;
          // When the group is folded this is the only time it shows, so it is the
          // group's newest beat — the one the presenter just talked about.
          const groupTimeLabel = group.rows[group.rows.length - 1]?.timeLabel;
          const isGlowing = glowingKey !== null && glowingKey === group.id;

          /*
           * Focus mirrors hover, so the preview is reachable from the keyboard.
           * The header is already a button for the replay, and a presenter tabbing
           * down the list should see the same thing a pointer shows them.
           */
          const hoverHandlers = onHoverGroup
            ? {
                onMouseEnter: () => onHoverGroup(group),
                onMouseLeave: () => onHoverGroup(null),
                onFocus: () => onHoverGroup(group),
                onBlur: () => onHoverGroup(null),
              }
            : {};

          const headerStyle: React.CSSProperties = {
            // In the drawer the feed is only ~460px wide, so the action becomes a
            // header above its spans rather than a left column — at 88px a left
            // column truncated every operation to "Putlt…".
            display: 'flex',
            alignItems: 'baseline',
            gap: 7,
            // `flex: 1` with `minWidth: 0`, not `width: 100%`: the header now shares a
            // flex row with the fold chevron, and a 100%-wide header beside a 14px
            // button overflows its container by exactly the button — which pushed the
            // replay glyph and the time off the right edge of the panel.
            flex: 1,
            minWidth: 0,
            padding: '5px 0 4px 8px',
            borderLeft: `2px solid ${isSelected || isCurrent || isGlowing ? '#8C2F45' : '#E5D9D2'}`,
            background: isSelected || isGlowing ? 'rgba(242,212,216,0.35)' : 'transparent',
            borderRadius: isSelected ? 3 : undefined,
            opacity: isCollapsed ? 0.55 : 1,
          };

          const headerContent = (
            <>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#A3959C',
                  flexShrink: 0,
                }}
              >
                {group.actor}
              </span>
              {/*
                Truncates rather than wraps. The feed is the narrowest column in the
                drawer, and a wrapped caption turned "writes a reply" into three
                stacked lines — which made the row it captions taller than the steps
                underneath it and the whole list hard to scan for the action you want.
              */}
              <span
                title={group.action}
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: isSelected || isCurrent ? '#8C2F45' : '#756A70',
                  lineHeight: 1.3,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {group.action}
              </span>
              {/* Step count, so a folded group still says how much is inside it. */}
              <span
                style={{
                  fontSize: 9,
                  color: '#A3959C',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}
              >
                {group.rows.length}
              </span>
              {/* When the group is folded, its steps' times are hidden with them. */}
              {groupTimeLabel && (
                <span
                  data-testid="aws-feed-group-time"
                  style={{ ...timeStyle, marginLeft: 'auto', flexShrink: 0 }}
                >
                  {groupTimeLabel}
                </span>
              )}
              {onSelectGroup && (
                <span
                  style={{
                    marginLeft: groupTimeLabel ? undefined : 'auto',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: isSelected ? '#8C2F45' : '#C3B4BA',
                    flexShrink: 0,
                  }}
                >
                  {isSelected ? REPLAY_COPY.replaying : REPLAY_COPY.glyph}
                </span>
              )}
            </>
          );

          return (
            <div
              key={group.id}
              style={{ marginBottom: 7 }}
              data-testid="aws-feed-group"
              data-group-id={group.id}
              data-selected={isSelected ? 'true' : 'false'}
              data-expanded={isExpanded ? 'true' : 'false'}
              data-glowing={isGlowing ? 'true' : 'false'}
            >
              {/*
                Fold and replay are two controls, side by side rather than nested:
                a button inside a button is invalid HTML, and the two answer different
                questions — "what were the steps" and "do it again". The chevron sits
                outside the header's own border so the caption keeps its left rule.
              */}
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 2 }}>
                <button
                  type="button"
                  onClick={() => toggleFold(group.id, isExpanded)}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? FOLD_COPY.collapse : FOLD_COPY.expand}: ${group.actor} ${group.action}`}
                  data-testid="aws-feed-group-fold"
                  style={foldButtonStyle}
                >
                  {isExpanded ? FOLD_COPY.unfolded : FOLD_COPY.folded}
                </button>

                {/*
                  A caption where there is nothing to replay to, a real control where
                  there is. Rendering the button unconditionally would put a dead
                  affordance on screen; rendering a clickable `div` would put one
                  outside the keyboard's reach.
                */}
                {onSelectGroup ? (
                  <button
                    type="button"
                    onClick={() => onSelectGroup(group)}
                    {...hoverHandlers}
                    aria-pressed={isSelected}
                    aria-label={`${REPLAY_COPY.action}: ${group.actor} ${group.action}`}
                    data-testid="aws-feed-group-header"
                    style={{
                      ...headerStyle,
                      // Strip the button back to the caption it replaces: the affordance
                      // is the pointer and the replay glyph, not a chrome-coloured box.
                      borderTop: 'none',
                      borderRight: 'none',
                      borderBottom: 'none',
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {headerContent}
                  </button>
                ) : (
                  <div data-testid="aws-feed-group-header" style={headerStyle} {...hoverHandlers}>
                    {headerContent}
                  </div>
                )}
              </div>

              {!isCollapsed &&
                [...group.rows].reverse().map((row) => (
                  // Wrapped so the trace id can sit under the row without becoming a
                  // fifth grid column — at 48px it would have squeezed the duration.
                  <div key={row.key}>
                    {(() => {
                      const isRowGlowing = glowingKey !== null && glowingKey === row.key;
                      /*
                       * A step is only a control when it actually produced something.
                       * `typing_stop` and a Bedrock span have nothing to glow, and a
                       * button that visibly does nothing when pressed is worse than a
                       * caption — it invites the presenter to press it again on stage.
                       */
                      const isInteractive =
                        onSelectRow !== undefined && (row.targets?.length ?? 0) > 0;

                      const rowHoverHandlers =
                        onHoverRow && isInteractive
                          ? {
                              onMouseEnter: () => onHoverRow(row),
                              onMouseLeave: () => onHoverRow(null),
                              onFocus: () => onHoverRow(row),
                              onBlur: () => onHoverRow(null),
                            }
                          : {};

                      const cellStyle: React.CSSProperties = {
                        ...rowStyle,
                        background: row.isCurrent
                          ? 'linear-gradient(90deg, rgba(242,212,216,0.5), transparent)'
                          : isRowGlowing
                            ? 'rgba(242,212,216,0.35)'
                            : // Spelled out rather than left `undefined`: the row is a
                              // `<button>` when it is interactive, and an unset
                              // background there means the platform's own grey pill.
                              'transparent',
                        borderRadius: row.isCurrent || isRowGlowing ? 4 : undefined,
                      };

                      const cells = (
                        <>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              justifySelf: 'center',
                              background: AWS_CATEGORY_COLORS[row.category],
                            }}
                          />
                          <span style={{ fontWeight: 700, color: '#2A2226', fontSize: 10 }}>
                            {row.service}
                          </span>
                          <span
                            style={{
                              color: '#756A70',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              // A grid item's automatic minimum is its content, so `1fr`
                              // could not actually shrink: the row stayed as wide as the
                              // longest detail string and the clock column hung off the
                              // panel's right edge. This is what makes the ellipsis work.
                              minWidth: 0,
                            }}
                          >
                            <b style={{ color: '#2A2226', fontWeight: 600 }}>{row.operation}</b>{' '}
                            {row.detail}
                          </span>
                          <span
                            style={{
                              textAlign: 'right',
                              fontWeight: 700,
                              fontSize: 10,
                              color: '#2A2226',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {row.durationLabel}
                          </span>
                          <span data-testid="aws-feed-row-time" style={timeStyle}>
                            {row.timeLabel ?? ''}
                          </span>
                        </>
                      );

                      /*
                       * A real button where there is something to show, a plain row
                       * where there is not — the same choice the group header makes,
                       * and for the same two reasons: an unconditional button puts a
                       * dead affordance on screen, and a clickable `div` puts a live
                       * one outside the keyboard's reach.
                       */
                      if (!isInteractive) {
                        return (
                          <div
                            data-testid="aws-feed-row"
                            data-current={row.isCurrent ? 'true' : 'false'}
                            data-glowing="false"
                            style={cellStyle}
                          >
                            {cells}
                          </div>
                        );
                      }

                      return (
                        <button
                          type="button"
                          onClick={() => onSelectRow(row)}
                          {...rowHoverHandlers}
                          aria-pressed={isRowGlowing}
                          aria-label={`${GLOW_COPY.action}: ${row.service} ${row.operation}`}
                          data-testid="aws-feed-row"
                          data-current={row.isCurrent ? 'true' : 'false'}
                          data-glowing={isRowGlowing ? 'true' : 'false'}
                          style={{
                            ...cellStyle,
                            // Stripped back to the row it replaces. `borderBottom`
                            // survives because it is the list's own rule between
                            // steps, not button chrome.
                            borderTop: 'none',
                            borderLeft: 'none',
                            borderRight: 'none',
                            width: '100%',
                            font: 'inherit',
                            fontSize: 10.5,
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          {cells}
                        </button>
                      );
                    })()}
                    {row.traceId && (
                      <div
                        data-testid="aws-feed-trace-id"
                        title={`X-Ray trace ${row.traceId}`}
                        style={{
                          // Indented under the service column, so it reads as
                          // belonging to the row above rather than as a step of its own.
                          paddingLeft: 24,
                          // Monospace spelled out rather than taken from a token:
                          // there is no mono face in the design system, because this is
                          // the only string in the app that is an identifier to be
                          // copied rather than words to be read.
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: typography.px.micro,
                          color: '#A3959C',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          // Selectable in one gesture, because copying it is the point.
                          userSelect: 'all',
                        }}
                      >
                        {row.traceId}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
