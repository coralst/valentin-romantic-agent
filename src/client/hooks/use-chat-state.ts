import { useReducer } from 'react';
import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  ActionProposalPayload,
  AgentActivityPayload,
} from '../../shared/interfaces/ws-events';

/** Connection status for the WebSocket link */
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

/**
 * What has become of a proposal Valentin raised.
 *
 * Resolved proposals stay in the transcript rather than disappearing. A card that
 * vanishes on click leaves no record that a table was booked or a message sent,
 * and this is the one place in the app where the user took an action with a
 * consequence outside the browser — it should still be there to scroll back to.
 */
export type ProposalStatus = 'open' | 'confirmed' | 'dismissed';

export interface ProposalEntry {
  proposal: ActionProposalPayload;
  status: ProposalStatus;
}

/**
 * One line in the trail of what Valentin is doing right now.
 *
 * The server's two tool frames (`tool_start`, `tool_end`) collapse into a *single*
 * entry here, completed in place when the call returns. Drawing a second row on
 * completion would reflow the trail under the reader's eyes mid-sentence, and the
 * two frames describe one event.
 */
export type AgentActivityEntry =
  | {
      kind: 'thinking';
      /** `thinking:<iteration>` — see `AgentActivityBase.id`. */
      id: string;
      iteration: number;
      /** Verbatim from a `reasoningContent` block. Never synthesised. */
      text: string;
    }
  | {
      kind: 'tool';
      /** Bedrock's `toolUseId`, which is what lets the end frame find this row. */
      id: string;
      iteration: number;
      tool: string;
      service: string;
      /** Already redacted by `activity-summary.ts`; never raw arguments. */
      inputSummary: string;
      /** All three absent while the call is still in flight. */
      durationMs?: number;
      ok?: boolean;
      outcome?: string;
    };

/** Full chat state managed by the reducer */
export interface ChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  isTyping: boolean;
  connectionStatus: ConnectionStatus;
  inputValue: string;
  /** Open and resolved proposals for the conversation on screen, oldest first. */
  proposals: ProposalEntry[];
  /**
   * What Valentin is doing in the turn that is running *now*, oldest first.
   *
   * Emptied when the reply lands rather than kept under it: `ChatMessage` is five
   * fields and `saveMessage` persists exactly those, so there is no per-message
   * slot to restore a trail from. A trail present live and gone after a reload
   * would look like durable provenance that is not — the thing
   * `client/utils/provenance.ts` exists to refuse.
   */
  activity: AgentActivityEntry[];
  /**
   * Whether the *next* message asks Bedrock for its reasoning.
   *
   * App-wide rather than per-session, and restored from `localStorage` by
   * `use-show-thinking.ts`. Off by default: thinking forces `temperature: 1`,
   * which retunes the persona voice, and costs thinking tokens on every turn.
   */
  showThinking: boolean;
  /**
   * Ids of messages that *arrived* while this transcript was on screen, as
   * opposed to being loaded with it.
   *
   * Only the typewriter reveal reads this, and it is the whole reason the set
   * exists: revealing a reply character by character is right when it is
   * happening in front of you, and wrong when you have just opened a
   * conversation and the last thing Valentin said re-types itself as though he
   * were saying it again. Nothing in a stored `ChatMessage` distinguishes the
   * two cases — a restored message and a live one are byte-identical — so the
   * distinction has to be recorded at the moment of arrival. `RECEIVE_MESSAGE`
   * is that moment and the only one; `SWITCH_SESSION` hydrates and therefore
   * deliberately empties this.
   */
  liveMessageIds: ReadonlySet<string>;
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
  | { type: 'CLEAR_INPUT' }
  | { type: 'RECEIVE_PROPOSAL'; proposal: ActionProposalPayload }
  | { type: 'RESOLVE_PROPOSAL'; proposalId: string; status: ProposalStatus }
  | { type: 'RECEIVE_ACTIVITY'; activity: AgentActivityPayload }
  | { type: 'SET_SHOW_THINKING'; showThinking: boolean };

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
  proposals: [],
  activity: [],
  showThinking: false,
  liveMessageIds: new Set<string>(),
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

      // The greeting is only appended to an empty transcript (see below), and in
      // that case it genuinely is being said now, so it counts as live. A
      // restored conversation keeps its stored greeting and adds nothing here.
      const greetingIsNew = state.messages.length === 0;

      return {
        ...state,
        sessionId: action.sessionId,
        liveMessageIds: greetingIsNew
          ? new Set([...state.liveMessageIds, action.welcomeMessage.id])
          : state.liveMessageIds,
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
        // Everything in `action.messages` is being *loaded*, including whatever
        // was live a moment ago in the conversation being left. Carrying an id
        // across is what made the last reply re-type itself on entry.
        liveMessageIds: new Set<string>(),
        /*
         * Proposals do not survive a switch. They are held in memory on the
         * server too — deliberately, since an Ontopo checkout link is good for
         * about fifteen minutes — so there is nothing to restore when the user
         * comes back, and a card left over from another conversation would offer
         * to act on a proposal the orchestrator has forgotten.
         */
        proposals: [],
        activity: [],
      };

    case 'SEND_MESSAGE':
      return {
        ...state,
        messages: sortByTimestamp([...state.messages, action.message]),
        inputValue: '',
        // Clear on send, not on receive alone: the trail describes one turn, and
        // the previous turn's rows must not sit above the new one's.
        activity: [],
      };

    case 'RECEIVE_MESSAGE':
      return {
        ...state,
        messages: sortByTimestamp([...state.messages, action.message]),
        activity: [],
        liveMessageIds: new Set([...state.liveMessageIds, action.message.id]),
      };

    case 'SET_TYPING':
      // Deliberately leaves `activity` alone. `typing_stop` arrives *before*
      // `agent_message`, so clearing here would blank the trail a beat early and
      // leave an empty gap where the reply is about to appear.
      return { ...state, isTyping: action.isTyping };

    case 'SET_CONNECTION':
      return { ...state, connectionStatus: action.status };

    case 'SET_INPUT':
      return { ...state, inputValue: action.value };

    case 'CLEAR_INPUT':
      return { ...state, inputValue: '' };

    case 'RECEIVE_PROPOSAL': {
      /*
       * Addressed to the conversation on screen, or dropped.
       *
       * Same hazard as `SESSION_INIT`: a reply for the previous session can still
       * be in flight when the new one is showing, and a card offering to book a
       * table belongs to the conversation that asked for it.
       */
      if (state.sessionId !== null && state.sessionId !== action.proposal.sessionId) {
        return state;
      }
      // Idempotent on proposalId. The server emits each proposal once, but a
      // duplicate would put two identical Confirm buttons on screen — and the
      // second click would be the one that fails.
      if (state.proposals.some((entry) => entry.proposal.proposalId === action.proposal.proposalId)) {
        return state;
      }

      return {
        ...state,
        proposals: [...state.proposals, { proposal: action.proposal, status: 'open' }],
      };
    }

    case 'RESOLVE_PROPOSAL':
      return {
        ...state,
        proposals: state.proposals.map((entry) =>
          entry.proposal.proposalId === action.proposalId
            ? { ...entry, status: action.status }
            : entry,
        ),
      };

    case 'RECEIVE_ACTIVITY': {
      const frame = action.activity;

      /*
       * Addressed to the conversation on screen, or dropped — the same hazard
       * `RECEIVE_PROPOSAL` guards. A turn started before a session switch keeps
       * narrating itself, and those rows describe work nobody on screen asked for.
       */
      if (state.sessionId !== null && state.sessionId !== frame.sessionId) {
        return state;
      }

      if (frame.kind === 'thinking') {
        const entry: AgentActivityEntry = {
          kind: 'thinking',
          id: frame.id,
          iteration: frame.iteration,
          text: frame.text,
        };
        // Replace rather than append on a repeated id: one model turn produces one
        // block of reasoning, and two rows would read as two thoughts.
        return { ...state, activity: replaceOrAppend(state.activity, entry) };
      }

      if (frame.kind === 'tool_start') {
        const entry: AgentActivityEntry = {
          kind: 'tool',
          id: frame.id,
          iteration: frame.iteration,
          tool: frame.tool,
          service: frame.service,
          inputSummary: frame.inputSummary,
        };
        return { ...state, activity: replaceOrAppend(state.activity, entry) };
      }

      const existing = state.activity.find((row) => row.id === frame.id);
      if (!existing) {
        // Defensive: a dropped or reordered start frame must not lose the row that
        // carries the outcome and the only measured duration in the trail.
        return {
          ...state,
          activity: [
            ...state.activity,
            {
              kind: 'tool',
              id: frame.id,
              iteration: frame.iteration,
              tool: frame.tool,
              service: frame.service,
              inputSummary: '',
              durationMs: frame.durationMs,
              ok: frame.ok,
              outcome: frame.outcome,
            },
          ],
        };
      }

      return {
        ...state,
        activity: state.activity.map((row) =>
          row.id === frame.id && row.kind === 'tool'
            ? { ...row, durationMs: frame.durationMs, ok: frame.ok, outcome: frame.outcome }
            : row,
        ),
      };
    }

    case 'SET_SHOW_THINKING':
      return { ...state, showThinking: action.showThinking };

    default:
      return state;
  }
}

/** Put an entry in its existing slot if the id is already drawn, else at the end. */
function replaceOrAppend(
  activity: AgentActivityEntry[],
  entry: AgentActivityEntry,
): AgentActivityEntry[] {
  return activity.some((row) => row.id === entry.id)
    ? activity.map((row) => (row.id === entry.id ? entry : row))
    : [...activity, entry];
}

/** Hook wrapping useReducer with the chat reducer */
export function useChatState() {
  return useReducer(chatReducer, initialState);
}
