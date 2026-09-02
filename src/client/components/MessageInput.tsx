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
  // One line tall by default; the row grows via `rows` as the draft wraps.
  height: 24,
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
