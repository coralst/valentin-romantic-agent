import { useState } from 'react';
import { colors, borderRadius, typography, animation } from '../design-system/tokens';
import { useShowThinking } from '../hooks/use-show-thinking';

/**
 * Stable across both states, with `aria-pressed` carrying the state — the same rule
 * `ArchitectureToggle` documents. Renaming a toggle under a screen reader as it is
 * activated is confusing in its own right.
 */
export const SHOW_THINKING_LABEL = 'Show reasoning';

/**
 * Why the description exists rather than a tooltip: reasoning is requested from
 * Bedrock per turn and is not stored, so turning this on cannot fill anything in
 * behind the user. Saying so is the difference between a control that looks broken
 * and one that is understood.
 */
export const SHOW_THINKING_HINT = 'Applies to your next message.';

const HINT_ID = 'show-thinking-hint';

/** Small lightbulb, drawn rather than a glyph so it matches at every size. */
function ThoughtIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9V15h7v-1.1A6 6 0 0 0 12 3Z" />
    </svg>
  );
}

/**
 * Turns the model's real reasoning on for the *next* message.
 *
 * Off by default and off after a corrupt stored value, because thinking forces
 * `temperature: 1` — which retunes the persona voice — and spends thinking tokens
 * on every turn. It is a `<button aria-pressed>` rather than `role="switch"` to
 * match the three other toggles in this codebase.
 *
 * The tool trail is *not* behind this control. Those rows are derived from calls
 * that really happened, so they cost nothing and cannot invent anything.
 */
export function ShowThinkingToggle() {
  const { showThinking, setShowThinking } = useShowThinking();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div style={clusterStyle}>
      <span style={hintStyle} id={HINT_ID} data-testid="show-thinking-hint">
        {SHOW_THINKING_HINT}
      </span>
      <button
        type="button"
        onClick={() => setShowThinking(!showThinking)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-pressed={showThinking}
        aria-describedby={HINT_ID}
        data-testid="show-thinking-toggle"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 9px',
          border: `1px solid ${showThinking ? colors.softBurgundy : 'transparent'}`,
          borderRadius: borderRadius.sm,
          backgroundColor: showThinking
            ? colors.highlight
            : isHovered
              ? colors.borderSubtle
              : 'transparent',
          color: showThinking ? colors.softBurgundy : colors.textSecondary,
          cursor: 'pointer',
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.semibold,
          fontFamily: typography.bodyFontFamily,
          transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
          flexShrink: 0,
        }}
      >
        <ThoughtIcon />
        <span>{SHOW_THINKING_LABEL}</span>
      </button>
    </div>
  );
}

const clusterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

/**
 * Visible, not a tooltip: it is the answer to "why is there no reasoning on the
 * message I am looking at", and a hint nobody hovers cannot give it.
 */
const hintStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrow,
  letterSpacing: '0.04em',
  color: colors.inkFaint,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};
