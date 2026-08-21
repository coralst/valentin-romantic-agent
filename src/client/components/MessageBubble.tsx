import type { ChatMessage } from '../../shared/interfaces/message';
import { colors, radii, typography, layout } from '../design-system/tokens';
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

/**
 * Agent row: crest, then bubble, aligned to the top so the crest sits beside the
 * message's *first* line however tall the bubble grows (option-5d-brief.html:49).
 */
const agentWrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  justifyContent: 'flex-start',
  marginBottom: 18,
  maxWidth: '90%',
};

const userWrapperStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: 18,
};

/**
 * The crest. `overflow: hidden` on a pill-radius box plus an oversized
 * `objectFit: cover` image is what keeps the logo from reading as squashed —
 * the image is scaled to 122% and cropped, never distorted to fit.
 */
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

/** Tail on the top-left: the corner nearest the crest is the tight one. */
const agentBubbleStyle: React.CSSProperties = {
  backgroundColor: '#FAF2EF',
  borderRadius: `${radii.tail}px ${radii.card}px ${radii.card}px ${radii.card}px`,
  padding: '14px 19px',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.chat,
  lineHeight: 1.6,
  color: colors.ink,
  overflowWrap: 'break-word',
  minWidth: 0,
};

/** Tail on the top-right, mirroring the agent bubble across the column. */
const userBubbleStyle: React.CSSProperties = {
  maxWidth: '70%',
  backgroundColor: colors.claret,
  borderRadius: `${radii.card}px ${radii.tail}px ${radii.card}px ${radii.card}px`,
  padding: '13px 19px',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.chat,
  lineHeight: 1.55,
  color: colors.textOnAccent,
  overflowWrap: 'break-word',
  boxShadow: '0 8px 22px rgba(140, 47, 69, 0.20)',
};

export function MessageBubble({ message, animate = false }: MessageBubbleProps) {
  const isAgent = message.sender === 'agent';
  const { displayedText } = useTypewriter(message.content, {
    enabled: isAgent && animate,
  });

  if (isAgent) {
    return (
      <div style={agentWrapperStyle} data-testid="message-bubble" data-sender="agent">
        <div style={avatarStyle}>
          <img src="/logo.png" alt="Valentin" style={avatarImageStyle} />
        </div>
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
