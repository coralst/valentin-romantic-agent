import { colors, spacing, borderRadius, animation, shadows } from '../design-system/tokens';

interface TypingIndicatorProps {
  isVisible: boolean;
}

const wrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: spacing.xs,
  padding: `0 ${spacing.md}px`,
  marginBottom: spacing.xs,
};

const avatarStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: borderRadius.full,
  background: `linear-gradient(135deg, #9B3A52 0%, #C4566E 100%)`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#FFFFFF',
  fontWeight: 700,
  fontSize: '0.875rem',
  flexShrink: 0,
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs / 2,
  padding: `${spacing.xs + 2}px ${spacing.sm}px`,
  backgroundColor: colors.agentBubble,
  borderRadius: `${borderRadius.lg} ${borderRadius.lg} ${borderRadius.lg} 4px`,
  width: 'fit-content',
  boxShadow: shadows.bubble,
};

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  backgroundColor: colors.warmTaupe,
};

const styleId = 'typing-indicator-keyframes';
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes typing-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-4px); }
    }
  `;
  document.head.appendChild(style);
}

export function TypingIndicator({ isVisible }: TypingIndicatorProps) {
  if (!isVisible) return null;

  ensureKeyframes();

  return (
    <div style={wrapperStyle}>
      <div style={avatarStyle} aria-hidden="true">V</div>
      <div style={containerStyle} data-testid="typing-indicator" aria-label="Valentin is typing">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              ...dotStyle,
              animation: `typing-bounce ${animation.durations.slow}ms ${animation.easing.easeInOut} infinite`,
              animationDelay: `${i * 100}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
