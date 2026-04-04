import { useReducer } from 'react';
import type { ChatMessage } from '../../shared/interfaces/message';

/** Connection status for the WebSocket link */
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

/** Full chat state managed by the reducer */
export interface ChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  isTyping: boolean;
  connectionStatus: ConnectionStatus;
  inputValue: string;
}

/** All actions the chat reducer can handle */
export type ChatAction =
  | { type: 'SESSION_INIT'; sessionId: string; welcomeMessage: ChatMessage }
  | { type: 'SEND_MESSAGE'; message: ChatMessage }
  | { type: 'RECEIVE_MESSAGE'; message: ChatMessage }
  | { type: 'SET_TYPING'; isTyping: boolean }
  | { type: 'SET_CONNECTION'; status: ConnectionStatus }
  | { type: 'SET_INPUT'; value: string }
  | { type: 'CLEAR_INPUT' };

/** Sort messages ascending by ISO timestamp */
function sortByTimestamp(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

const initialState: ChatState = {
  sessionId: null,
  messages: [],
  isTyping: false,
  connectionStatus: 'disconnected',
  inputValue: '',
};

/** Reducer handling all chat state transitions */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SESSION_INIT':
      return {
        ...state,
        sessionId: action.sessionId,
        messages: sortByTimestamp([...state.messages, action.welcomeMessage]),
      };

    case 'SEND_MESSAGE':
      return {
        ...state,
        messages: sortByTimestamp([...state.messages, action.message]),
        inputValue: '',
      };

    case 'RECEIVE_MESSAGE':
      return {
        ...state,
        messages: sortByTimestamp([...state.messages, action.message]),
      };

    case 'SET_TYPING':
      return { ...state, isTyping: action.isTyping };

    case 'SET_CONNECTION':
      return { ...state, connectionStatus: action.status };

    case 'SET_INPUT':
      return { ...state, inputValue: action.value };

    case 'CLEAR_INPUT':
      return { ...state, inputValue: '' };

    default:
      return state;
  }
}

/** Hook wrapping useReducer with the chat reducer */
export function useChatState() {
  return useReducer(chatReducer, initialState);
}
