import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../shared/interfaces/message';
import { MessageBubble } from './MessageBubble';
import { spacing } from '../design-system/tokens';

interface MessageHistoryProps {
  messages: ChatMessage[];
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: spacing.md,
};

export function MessageHistory({ messages }: MessageHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div role="log" style={containerStyle} aria-label="Message history">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
