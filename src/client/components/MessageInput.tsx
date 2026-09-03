import { useLayoutEffect, useRef } from 'react';
import { validateMessageContent } from '../../shared/validation/message-validator';
import { colors, radii, insets, typography, layout } from '../design-system/tokens';
import { chatMeasureStyle } from './chat-measure';

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/** The composer never scrolls away, so it must not shrink (option-5d-brief.html:70). */
const containerStyle: React.CSSProperties = {
  padding: `6px ${insets.roomy}px 20px`,
  flexShrink: 0,
};

/**
 * The sand pill. `alignItems: flex-end` keeps the send button on the last line
 * as the textarea grows, rather than centring it against a tall box.
 */
const innerStyle: React.CSSProperties = {
  // Same box as the transcript, so the pill's edges land under the bubbles'.
  ...chatMeasureStyle,
  display: 'flex',
  alignItems: 'flex-end',
  gap: 10,
  backgroundColor: colors.sand,
  borderRadius: radii.card,
  padding: `9px 9px 9px 19px`,
};

/** One line of `typography.px.chat` at `lineHeight: 1.5`, plus the 3px lead-in. */
const COMPOSER_MIN_HEIGHT = 24;

/**
 * Six lines, then the draft scrolls inside itself.
 *
 * Uncapped growth would be worse than the bug it replaces: the composer does not
 * scroll away (`containerStyle`'s `flexShrink: 0`), so a pasted paragraph would
 * push the transcript off the top of the window and you would lose the
 * conversation to see the draft. Six lines is enough that ordinary multi-line
 * messages never scroll at all.
 */
const COMPOSER_MAX_HEIGHT = 132;

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  // No `outline: 'none'`: an inline declaration beats the stylesheet, so it was
  // deleting the composer's only focus indicator with nothing put back. The global
  // `:focus-visible` ring now applies, and only for keyboard focus.
  background: 'transparent',
  resize: 'none',
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.normal,
  fontSize: typography.px.chat,
  color: colors.ink,
  lineHeight: 1.5,
  /*
   * One line tall by default, grown by `autosize` below — never by `rows`.
   *
   * This used to be `height: 24` with a comment claiming "the row grows via
   * `rows`". It did not: `rows` is fixed at 1, and an explicit CSS height beats
   * row-based sizing anyway, so a draft that wrapped scrolled its own first line
   * out of a 24px window and you could not see what you had written. `minHeight`
   * rather than `height` is what lets the measured value win.
   */
  boxSizing: 'border-box',
  minHeight: COMPOSER_MIN_HEIGHT,
  maxHeight: COMPOSER_MAX_HEIGHT,
  // Only ever reached once the draft is taller than the cap; below it the element
  // is exactly its content's height, so there is nothing to scroll.
  overflowY: 'auto',
  paddingTop: 3,
};

const buttonStyle: React.CSSProperties = {
  width: layout.sendButtonSize,
  height: layout.sendButtonSize,
  borderRadius: radii.pill,
  border: 'none',
  cursor: 'pointer',
  flexShrink: 0,
  backgroundColor: colors.claret,
  color: colors.textOnAccent,
  fontSize: typography.px.control,
  boxShadow: '0 5px 14px rgba(140, 47, 69, 0.28)',
  transition: 'opacity 200ms ease',
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.4,
  cursor: 'not-allowed',
  // A disabled control should not claim to be liftable off the surface.
  boxShadow: 'none',
};

export function MessageInput({ value, onChange, onSubmit }: MessageInputProps) {
  const isValid = validateMessageContent(value).valid;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /*
   * Measure the draft and become that tall.
   *
   * Keyed on `value` rather than on `onChange`, because the draft is owned by the
   * parent: sending a message clears it from outside this component, and an
   * onChange-only autosize would leave the box six lines tall over an empty
   * placeholder. `height = 'auto'` first is not optional — `scrollHeight` of an
   * element with a height already set never reports less than that height, so
   * without the reset the composer could grow but never shrink again.
   *
   * `useLayoutEffect` so the resize lands in the same frame as the character that
   * caused it; in a `useEffect` the one-line box paints first and the composer
   * visibly judders on every wrap.
   */
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && isValid) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div style={containerStyle}>
      <div style={innerStyle}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Type a message"
          placeholder="Tell Valentin about her…"
          style={inputStyle}
        />
        <button
          onClick={onSubmit}
          disabled={!isValid}
          style={isValid ? buttonStyle : disabledButtonStyle}
          aria-label="Send message"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
