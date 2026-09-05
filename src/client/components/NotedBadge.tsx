import { colors, radii, typography } from '../design-system/tokens';

interface NotedBadgeProps {
  /** What was recorded from this message. Rendered on one line. */
  values: readonly string[];
  /** User turns sit on the right, so their marker is mirrored to match. */
  align?: 'start' | 'end';
}

/**
 * The permanent counterpart to `LearnedStatus`: what is on the record, sitting
 * under the message that put it there.
 *
 * The two are one idea in two tenses, so they share the tick, the eyebrow and the
 * value type. Where they differ is register and duty:
 *
 * - `LearnedStatus` is the *moment*. It lives at the transcript tail for four
 *   seconds, announces itself through `aria-live="polite"`, and is gone.
 * - This is the *record*. It is terser, it never leaves, and it has **no live
 *   region** — see below.
 *
 * A11y: deliberately silent. The badge is mounted only once its message is no
 * longer the transcript tail, so it and the transient are never on screen saying
 * the same thing at once; a screen reader therefore hears each fact exactly once,
 * from the transient. Announcing a badge as well would repeat every fact on every
 * reload, when nothing has happened.
 *
 * No dwell, no animation, no timer. There is nothing to fade: it is as permanent
 * as the preference it is drawn from, and it renders on the first paint after a
 * reload because it derives from persisted state.
 */
export function NotedBadge({ values, align = 'start' }: NotedBadgeProps) {
  if (values.length === 0) return null;

  return (
    <div
      style={{ ...rowStyle, justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }}
      data-testid="noted-badge"
    >
      <span style={tickStyle} aria-hidden="true">
        ✓
      </span>
      <span style={labelStyle}>Noted</span>
      <span style={separatorStyle} aria-hidden="true" />
      <span style={valuesStyle} data-testid="noted-badge-values">
        {values.join(' · ')}
      </span>
    </div>
  );
}

/**
 * No reserved height, unlike `LearnedStatus`'s always-mounted slot.
 *
 * That slot exists so a line appearing and vanishing every four seconds moves no
 * message. This one appears once and stays, in the same commit as the reply that
 * already scrolled the transcript to its foot, so there is nothing to reserve
 * space against.
 */
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  minWidth: 0,
  marginTop: 3,
  marginBottom: 2,
};

/** A bare olive tick, matching the transient exactly — same fact, same mark. */
const tickStyle: React.CSSProperties = {
  color: colors.olive,
  fontSize: typography.px.caption,
  lineHeight: 1,
  flexShrink: 0,
};

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

const valuesStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.normal,
  fontSize: typography.px.labelLoose,
  color: colors.inkMuted,
  // One line: a badge under every fact-bearing message must not be able to grow
  // the transcript by a paragraph.
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};
