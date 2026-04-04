import { validateMessageContent } from '../../shared/validation/message-validator';
import { colors, spacing, borderRadius, typography, shadows } from '../design-system/tokens';

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

const containerStyle: React.CSSProperties = {
  padding: `${spacing.sm}px ${spacing.md}px ${spacing.md}px`,
  backgroundColor: colors.surface,
};

const innerStyle: React.CSSProperties = {
  display: 'flex',
  gap: spacing.xs,
  padding: `6px 6px 6px ${spacing.sm}px`,
  borderRadius: borderRadius.xl,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.background,
  boxShadow: shadows.input,
  alignItems: 'center',
  transition: 'border-color 200ms ease, box-shadow 200ms ease',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: `${spacing.xs}px 0`,
  border: 'none',
  fontSize: typography.sizes.base,
  fontFamily: typography.bodyFontFamily,
  outline: 'none',
  backgroundColor: 'transparent',
  color: colors.text,
};

const buttonStyle: React.CSSProperties = {
  padding: `${spacing.xs}px ${spacing.md}px`,
  borderRadius: borderRadius.lg,
  background: colors.accentGradient,
  color: colors.textOnAccent,
  fontWeight: typography.weights.semibold,
  fontSize: typography.sizes.sm,
  cursor: 'pointer',
  border: 'none',
  transition: 'opacity 200ms ease, transform 100ms ease',
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.4,
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
      <div style={innerStyle}>
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
    </div>
  );
}
