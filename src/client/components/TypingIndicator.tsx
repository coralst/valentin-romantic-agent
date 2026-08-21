import { colors, radii, insets, animation, layout } from '../design-system/tokens';

interface TypingIndicatorProps {
  isVisible: boolean;
}

/**
 * Sits between the transcript and the composer, so it aligns to the transcript's
 * 26px gutter and repeats the agent row's crest-then-bubble geometry.
 */
const wrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: `0 ${insets.roomy}px`,
  marginBottom: 10,
  flexShrink: 0,
};

/** Same crest treatment as MessageBubble, so the two rows read as one speaker. */
const avatarStyle: React.CSSProperties = {
  width: layout.messageAvatarSize,
  height: layout.messageAvatarSize,
  borderRadius: radii.pill,
  overflow: 'hidden',
  backgroundColor: colors.porcelain,
  boxShadow: '0 1px 5px rgba(42, 34, 38, 0.14)',
  flexShrink: 0,
};

const avatarImageStyle: React.CSSProperties = {
  width: '122%',
  height: '122%',
  objectFit: 'cover',
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '14px 19px',
  backgroundColor: '#FAF2EF',
  borderRadius: `${radii.tail}px ${radii.card}px ${radii.card}px ${radii.card}px`,
  width: 'fit-content',
};

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: radii.pill,
  backgroundColor: colors.inkFaint,
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
      <div style={avatarStyle}>
        <img src="/logo.png" alt="Valentin" style={avatarImageStyle} />
      </div>
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
