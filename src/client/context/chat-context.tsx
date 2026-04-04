import React, { createContext, useContext } from 'react';
import { useChatState, type ChatState, type ChatAction } from '../hooks/use-chat-state';

interface ChatContextValue {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** Provider that wraps children with chat state */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useChatState();
  return (
    <ChatContext.Provider value={{ state, dispatch }}>
      {children}
    </ChatContext.Provider>
  );
}

/** Consumer hook — throws if used outside ChatProvider */
export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return ctx;
}
