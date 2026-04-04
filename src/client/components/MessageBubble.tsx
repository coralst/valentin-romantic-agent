import type { ChatMessage } from '../../shared/interfaces/message';
import { colors, spacing, borderRadius, typography } from '../design-system/tokens';

interface MessageBubbleProps {
  message: ChatMessage;
}

const baseStyle: React.CSSProperties = {
  maxWidth: '75%',
  padding: `${spacing.sm}px ${spacing.md}px`,
  borderRadius: borderRadius.lg,
  fontSize: typography.sizes.base,
  lineHeight: typography.lineHeights.normal,
  wordBreak: 'break-word',
};

const agentWrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: spacing.xs,
  justifyContent: 'flex-start',
  marginBottom: spacing.sm,
};

const userWrapperStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: spacing.sm,
};

const avatarStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: borderRadius.full,
  backgroundColor: colors.softBurgundy,
  color: colors.warmIvory,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: typography.headingFontFamily,
  fontWeight: typography.weights.bold,
  fontSize: typography.sizes.sm,
  flexShrink: 0,
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isAgent = message.sender === 'agent';

  const bubbleStyle: React.CSSProperties = {
    ...baseStyle,
    backgroundColor: isAgent ? colors.agentBubble : colors.userBubble,
    color: colors.text,
  };

  if (isAgent) {
    return (
      <div style={agentWrapperStyle} data-testid="message-bubble" data-sender="agent">
        <div style={avatarStyle} aria-hidden="true">V</div>
        <div style={bubbleStyle}>{message.content}</div>
      </div>
    );
  }

  return (
    <div style={userWrapperStyle} data-testid="message-bubble" data-sender="user">
      <div style={bubbleStyle}>{message.content}</div>
    </div>
  );
}
