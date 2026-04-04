import { colors, spacing, borderRadius, animation } from '../design-system/tokens';

interface TypingIndicatorProps {
  isVisible: boolean;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs / 2,
  padding: `${spacing.xs}px ${spacing.sm}px`,
  marginLeft: spacing.xl,
  marginBottom: spacing.sm,
  backgroundColor: colors.agentBubble,
  borderRadius: borderRadius.lg,
  width: 'fit-content',
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: colors.warmTaupe,
};

/** Inject keyframes once for the bounce animation */
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
  );
}
