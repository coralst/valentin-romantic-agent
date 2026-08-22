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
  | { type: 'SWITCH_SESSION'; sessionId: string | null; messages: ChatMessage[] }
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
    case 'SESSION_INIT': {
      /*
       * Ignore a greeting addressed to a conversation the app has left.
       *
       * `session_init` arrives from whichever socket most recently authenticated,
       * and a session switch reconnects — so a frame for the *previous* session
       * can still be in flight when the new one is already on screen. Applying it
       * would move `sessionId` back, which drags the socket, the persistence owner
       * and the sidebar's idea of the active conversation along with it, and the
       * greeting would land in a transcript it does not belong to.
       *
       * A null `sessionId` is the one case where adopting is right: the app has no
       * conversation, so this is the server telling it which one it just got.
       */
      if (state.sessionId !== null && state.sessionId !== action.sessionId) {
        return state;
      }

      return {
        ...state,
        sessionId: action.sessionId,
        /*
         * The greeting only belongs in an *empty* transcript. The server greets
         * whenever a session has no messages, and it may say so to two sockets
         * at once; this guard became load-bearing once transcripts persisted,
         * because an unconditional append re-greeted a restored conversation on
         * every reload and the greeting was then saved, so it grew without bound.
         */
        messages:
          state.messages.length > 0
            ? state.messages
            : sortByTimestamp([action.welcomeMessage]),
      };
    }

    case 'SWITCH_SESSION':
      return {
        ...state,
        sessionId: action.sessionId,
        messages: action.messages,
        isTyping: false,
        inputValue: '',
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
