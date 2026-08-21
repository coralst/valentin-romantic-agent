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
}

interface FeedGroup {
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
 */
export function groupFeedRows(rows: readonly FeedRow[]): FeedGroup[] {
  const groups: FeedGroup[] = [];

  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.actor === row.actor && last.action === row.action) {
      last.rows.push(row);
    } else {
      groups.push({ actor: row.actor, action: row.action, rows: [row] });
    }
  }

  return groups;
}

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

export function AwsFlowFeed({ rows, summary, heading, emptyMessage }: AwsFlowFeedProps) {
  // Newest first: reversed here rather than at the call site so the caller can
  // keep its rows in the order the traffic actually happened.
  const groups = groupFeedRows(rows).reverse();

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
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

        {groups.map((group, index) => {
          const isCurrent = group.rows.some((row) => row.isCurrent);
          return (
            <div
              key={`${group.actor}-${group.action}-${index}`}
              style={{ marginBottom: 7 }}
              data-testid="aws-feed-group"
            >
              <div
                style={{
                  // In the drawer the feed is only ~460px wide, so the action
                  // becomes a header above its spans rather than a left column —
                  // at 88px a left column truncated every operation to "Putlt…".
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 7,
                  padding: '5px 0 4px 8px',
                  borderLeft: `2px solid ${isCurrent ? '#8C2F45' : '#E5D9D2'}`,
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: '#A3959C',
                  }}
                >
                  {group.actor}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: isCurrent ? '#8C2F45' : '#756A70',
                    lineHeight: 1.3,
                  }}
                >
                  {group.action}
                </span>
              </div>

              {[...group.rows].reverse().map((row) => (
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
