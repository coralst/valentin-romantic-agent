import { v4 as uuidv4 } from 'uuid';
import { useChatContext } from '../context/chat-context';
import { useWebSocketContext } from '../context/websocket-context';
import { MessageHistory } from './MessageHistory';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { ConnectionBanner } from './ConnectionBanner';
import { colors, spacing } from '../design-system/tokens';
import type { ChatMessage } from '../../shared/interfaces/message';

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: colors.background,
};

export function ChatPanel() {
  const { state, dispatch } = useChatContext();
  const { sendMessage } = useWebSocketContext();

  const handleSubmit = () => {
    const content = state.inputValue.trim();
    if (!content) return;

    const message: ChatMessage = {
      id: uuidv4(),
      sessionId: state.sessionId ?? '',
      sender: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    dispatch({ type: 'SEND_MESSAGE', message });
    sendMessage(content);
  };

  return (
    <div style={panelStyle} data-testid="chat-panel">
      <ConnectionBanner status={state.connectionStatus} />
      <MessageHistory messages={state.messages} />
      <TypingIndicator isVisible={state.isTyping} />
      <MessageInput
        value={state.inputValue}
        onChange={(value) => dispatch({ type: 'SET_INPUT', value })}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
