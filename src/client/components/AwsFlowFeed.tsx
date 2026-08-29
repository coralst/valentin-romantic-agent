import { AWS_CATEGORY_COLORS, type AwsCategory } from '../utils/aws-diagram-layout';
import { colors, typography } from '../design-system/tokens';

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
  gridTemplateColumns: '16px 70px 1fr 48px',
  gap: 8,
  alignItems: 'center',
  padding: '5px 0',
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 10.5,
};

export function AwsFlowFeed({
  rows,
  summary,
  heading,
  emptyMessage,
  onSelectGroup,
  selectedGroupId = null,
}: AwsFlowFeedProps) {
  // Newest first: reversed here rather than at the call site so the caller can
  // keep its rows in the order the traffic actually happened.
  const groups = groupFeedRows(rows).reverse();

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
        minWidth: 260,
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
        <span>{summary}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
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
          const isCollapsed = selectedGroupId !== null && !isSelected;

          const headerStyle: React.CSSProperties = {
            // In the drawer the feed is only ~460px wide, so the action becomes a
            // header above its spans rather than a left column — at 88px a left
            // column truncated every operation to "Putlt…".
            display: 'flex',
            alignItems: 'baseline',
            gap: 7,
            width: '100%',
            padding: '5px 0 4px 8px',
            borderLeft: `2px solid ${isSelected || isCurrent ? '#8C2F45' : '#E5D9D2'}`,
            background: isSelected ? 'rgba(242,212,216,0.35)' : 'transparent',
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
              {onSelectGroup && (
                <span
                  style={{
                    marginLeft: 'auto',
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
            >
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
                <div data-testid="aws-feed-group-header" style={headerStyle}>
                  {headerContent}
                </div>
              )}

              {!isCollapsed &&
                [...group.rows].reverse().map((row) => (
                  <div
                    key={row.key}
                    data-testid="aws-feed-row"
                    data-current={row.isCurrent ? 'true' : 'false'}
                    style={{
                      ...rowStyle,
                      background: row.isCurrent
                        ? 'linear-gradient(90deg, rgba(242,212,216,0.5), transparent)'
                        : undefined,
                      borderRadius: row.isCurrent ? 4 : undefined,
                    }}
                  >
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
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
