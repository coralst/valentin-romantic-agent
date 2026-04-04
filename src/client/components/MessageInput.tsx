import { validateMessageContent } from '../../shared/validation/message-validator';
import { colors, spacing, borderRadius, typography } from '../design-system/tokens';

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  gap: spacing.xs,
  padding: spacing.sm,
  borderTop: `1px solid ${colors.border}`,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: `${spacing.xs}px ${spacing.sm}px`,
  borderRadius: borderRadius.md,
  border: `1px solid ${colors.border}`,
  fontSize: typography.sizes.base,
  fontFamily: typography.bodyFontFamily,
  outline: 'none',
};

const buttonStyle: React.CSSProperties = {
  padding: `${spacing.xs}px ${spacing.md}px`,
  borderRadius: borderRadius.md,
  backgroundColor: colors.softBurgundy,
  color: colors.warmIvory,
  fontWeight: typography.weights.semibold,
  fontSize: typography.sizes.base,
  cursor: 'pointer',
  border: 'none',
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

export function MessageInput({ value, onChange, onSubmit }: MessageInputProps) {
  const isValid = validateMessageContent(value).valid;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && isValid) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div style={containerStyle}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Type a message"
        placeholder="Tell Valentin about your partner..."
        style={inputStyle}
      />
      <button
        onClick={onSubmit}
        disabled={!isValid}
        style={isValid ? buttonStyle : disabledButtonStyle}
        aria-label="Send message"
      >
        Send
      </button>
    </div>
  );
}
