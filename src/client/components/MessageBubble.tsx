import type { ChatMessage } from '../../shared/interfaces/message';
import { colors, spacing, borderRadius, typography, shadows } from '../design-system/tokens';
import { useTypewriter } from '../hooks/use-typewriter';

function renderFormattedText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++}>{match[4]}</em>);
    } else if (match[5]) {
      parts.push(<em key={key++}>{match[6]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function renderContent(text: string): React.ReactNode {
  const lines = text.split('\n');
  if (lines.length === 1) {
    return <>{renderFormattedText(text)}</>;
  }
  return lines.map((line, i) => (
    <span key={i}>
      {renderFormattedText(line)}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

interface MessageBubbleProps {
  message: ChatMessage;
  /** When true (agent messages only), reveal the text letter-by-letter. */
  animate?: boolean;
}

/** Visually hidden but present for assistive tech and DOM queries. */
const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const agentWrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: spacing.xs,
  justifyContent: 'flex-start',
  marginBottom: spacing.sm,
  paddingRight: spacing.xxl,
};

const userWrapperStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: spacing.sm,
  paddingLeft: spacing.xxl,
};

const avatarStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: borderRadius.full,
  background: colors.accentGradient,
  color: colors.textOnAccent,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: typography.headingFontFamily,
  fontWeight: typography.weights.bold,
  fontSize: typography.sizes.sm,
  flexShrink: 0,
};

const agentBubbleStyle: React.CSSProperties = {
  maxWidth: '80%',
  padding: `${spacing.xs + 4}px ${spacing.sm}px`,
  borderRadius: `${borderRadius.lg} ${borderRadius.lg} ${borderRadius.lg} 4px`,
  fontSize: typography.sizes.base,
  lineHeight: typography.lineHeights.normal,
  wordBreak: 'break-word',
  backgroundColor: colors.agentBubble,
  color: colors.text,
  boxShadow: shadows.bubble,
};

const userBubbleStyle: React.CSSProperties = {
  maxWidth: '80%',
  padding: `${spacing.xs + 4}px ${spacing.sm}px`,
  borderRadius: `${borderRadius.lg} ${borderRadius.lg} 4px ${borderRadius.lg}`,
  fontSize: typography.sizes.base,
  lineHeight: typography.lineHeights.normal,
  wordBreak: 'break-word',
  background: colors.accentGradient,
  color: colors.userBubbleText,
};

export function MessageBubble({ message, animate = false }: MessageBubbleProps) {
  const isAgent = message.sender === 'agent';
  const { displayedText } = useTypewriter(message.content, {
    enabled: isAgent && animate,
  });

  if (isAgent) {
    return (
      <div style={agentWrapperStyle} data-testid="message-bubble" data-sender="agent">
        <div style={avatarStyle} aria-hidden="true">V</div>
        <div style={agentBubbleStyle}>
          {/* Full text for assistive tech — announced once, not letter-by-letter */}
          <span style={visuallyHidden}>{message.content}</span>
          {/* Presentational animated text */}
          <span aria-hidden="true">
            {animate ? renderContent(displayedText) : renderContent(message.content)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={userWrapperStyle} data-testid="message-bubble" data-sender="user">
      <div style={userBubbleStyle}>{renderContent(message.content)}</div>
    </div>
  );
}
