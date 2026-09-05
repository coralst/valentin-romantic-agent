import { colors, layout, radii, typography, animation } from '../design-system/tokens';
import { prefersReducedMotion } from '../utils/motion-preference';
import type { AgentActivityEntry } from '../hooks/use-chat-state';

interface AgentActivityTrailProps {
  /** The turn on screen, oldest first. Empty between turns. */
  activity: readonly AgentActivityEntry[];
  /** Whether the user asked for reasoning; rows are hidden without it. */
  showThinking: boolean;
}

/**
 * What Valentin is doing, while he is still doing it.
 *
 * Every line here describes something that actually happened: a `reasoningContent`
 * block Bedrock returned, or a tool the model really called, with a duration
 * measured around the call. Nothing is inferred from a message, which is the rule
 * `utils/provenance.ts` sets for this app — a plausible-sounding trail would be
 * worse than three dots.
 *
 * ACCESSIBILITY, DELIBERATELY
 *
 * `role="group"` with a label, and **no live region**. Several frames arrive per
 * turn, so announcing them would talk over the reply the user is waiting for. The
 * chat column keeps exactly the two live regions it already has ("Valentin is
 * typing" and the single "Noted" transient); this is readable on demand instead.
 * Durations are text, not `title` attributes, for the same reason.
 */
export function AgentActivityTrail({ activity, showThinking }: AgentActivityTrailProps) {
  const rows = showThinking ? activity : activity.filter((row) => row.kind !== 'thinking');

  // Nothing to say ⇒ nothing rendered, leaving the transcript exactly as it was.
  // With the toggle off and no tools called, the UI is unchanged; `TypingIndicator`
  // keeps its own slot above the composer either way.
  if (rows.length === 0) return null;

  const reduced = prefersReducedMotion();
  if (!reduced) ensureKeyframes();

  return (
    <div style={wrapperStyle}>
      <div
        style={listStyle}
        role="group"
        aria-label="What Valentin is doing"
        data-testid="agent-activity-trail"
      >
        {rows.map((row) =>
          row.kind === 'thinking' ? (
            <ThinkingRow key={row.id} text={row.text} />
          ) : (
            <ToolRow key={row.id} row={row} reduced={reduced} />
          ),
        )}
      </div>
    </div>
  );
}

function ThinkingRow({ text }: { text: string }) {
  return (
    <div style={thinkingRowStyle} data-testid="activity-thinking">
      <span style={{ ...labelStyle, marginTop: 3 }}>Thinking</span>
      <span style={{ ...separatorStyle, marginTop: 7 }} aria-hidden="true" />
      <span style={thinkingTextStyle}>{text}</span>
    </div>
  );
}

function ToolRow({
  row,
  reduced,
}: {
  row: Extract<AgentActivityEntry, { kind: 'tool' }>;
  reduced: boolean;
}) {
  // `durationMs` is the field that says the call has returned: it is written in the
  // same frame as `ok` and `outcome`, and it is the one nobody could estimate.
  const inFlight = row.durationMs === undefined;

  return (
    <div style={rowStyle} data-testid="activity-tool" data-service={row.service}>
      <span style={labelStyle}>{row.service}</span>
      <span style={separatorStyle} aria-hidden="true" />
      <span style={toolNameStyle}>{row.tool}</span>
      {row.inputSummary && <span style={detailStyle}>{row.inputSummary}</span>}
      {inFlight ? (
        <span
          style={{
            ...pendingStyle,
            // Users who asked for less motion get the word without the pulse.
            ...(reduced
              ? {}
              : {
                  animation: `${animationName} ${animation.durations.slow}ms ${animation.easing.easeInOut} infinite`,
                }),
          }}
          data-testid="activity-pending"
        >
          working…
        </span>
      ) : (
        <span
          style={{ ...outcomeStyle, color: row.ok ? colors.inkMuted : colors.error }}
          data-testid="activity-outcome"
        >
          {row.ok ? '✓' : '✕'} {row.outcome} · {formatDuration(row.durationMs ?? 0)}
        </span>
      )}
    </div>
  );
}

/**
 * Seconds once a call takes one, milliseconds below that.
 *
 * A tool round trip is the part of a turn the user actually feels, so the number is
 * shown at the precision that makes the wait legible rather than at a fixed unit.
 */
export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Sits at the tail of the transcript, so it needs no gutter and no measure of its
 * own: the scroll container supplies the first and `chatMeasureStyle` on the
 * content box supplies the second. Adding either back here would inset the rows
 * twice over. Only the gap that separates it from the message above is local.
 */
const wrapperStyle: React.CSSProperties = {
  marginTop: 2,
  marginBottom: 6,
  flexShrink: 0,
};

/**
 * The 44px indent is the avatar (32) plus the bubble gap (12), so the rows start
 * where Valentin's bubbles start — the same alignment `LearnedStatus` uses, so the
 * live trail and the "Noted" line read as one column of asides.
 */
const listStyle: React.CSSProperties = {
  marginLeft: layout.messageAvatarSize + 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  minWidth: 0,
  // One line per row, still: a turn can call four tools, and a trail that wraps
  // each of them to two or three lines becomes taller than the reply it explains.
  // Truncation is safe here in a way it is not for reasoning prose — the service,
  // the tool name and the outcome all sit at fixed ends of the row.
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

/** The eyebrow, borrowed from `LearnedStatus` so the two registers match. */
const labelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.eyebrow,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
  flexShrink: 0,
};

const separatorStyle: React.CSSProperties = {
  width: 12,
  height: 1,
  borderRadius: radii.pill,
  backgroundColor: colors.linenShade,
  flexShrink: 0,
};

const toolNameStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.labelLoose,
  color: colors.inkMuted,
  flexShrink: 0,
};

const detailStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  color: colors.inkFaint,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};

const pendingStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  color: colors.inkFaint,
  flexShrink: 0,
};

const outcomeStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};

/**
 * The one row allowed to wrap, because reasoning is prose and a single truncated
 * line of it would be less use than nothing.
 *
 * Capped at three lines rather than left unbounded: a reasoning block can run to a
 * paragraph, and the aside must not end up longer than the reply it belongs to.
 */
const thinkingRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 7,
  minWidth: 0,
};

/** Muted and italic: it is what he was working out, not what he said. */
const thinkingTextStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  fontStyle: 'italic',
  lineHeight: 1.5,
  color: colors.inkMuted,
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 3,
  overflow: 'hidden',
  minWidth: 0,
};

const animationName = 'activity-pending-pulse';
const styleId = 'agent-activity-keyframes';

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes ${animationName} {
      0%, 100% { opacity: 0.45; }
      50% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}
