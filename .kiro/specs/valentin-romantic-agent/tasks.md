# Implementation Plan: Valentin the Romantic Agent

## Overview

This plan is organized by agent domain so each agent can work on an independent feature branch in parallel. The System Architect and UI Designer produce shared foundations first; Frontend Dev and Backend Dev build in parallel on top of those; QA Agent writes E2E tests last once both ends are integrated.

## Dependency Graph

```
🏗️ System Architect (shared types, validation, errors, persistence interfaces)
🎨 UI Designer (design tokens, global styles)
    ↓                          ↓
⚛️ Frontend Dev            🔧 Backend Dev
(components, hooks,        (API, agent, extraction,
 state, WS client)          persistence, WS gateway)
    ↓                          ↓
            🧪 QA Agent
         (E2E Playwright tests)
```

## Tasks

### 🏗️ [System Architect] — Branch: `feat/arch-valentin-shared-types`

- [-] 1. Create shared interfaces and type definitions
  - [x] 1.1 Create `src/shared/interfaces/message.ts` with `ChatMessage` interface
    - Define `ChatMessage` with `id`, `sessionId`, `sender`, `content`, `timestamp` fields
    - Export `Sender` type union `'user' | 'agent'`
    - _Requirements: 1.2, 1.3, 3.1_
  - [x] 1.2 Create `src/shared/interfaces/preference.ts` with `Preference`, `PreferenceWithHistory`, `PreferenceHistoryEntry`, and `PreferenceCategory` types
    - Define `PreferenceCategory` as union of 8 category strings
    - Define `Preference` with `id`, `sessionId`, `category`, `key`, `value`, `confidence`, `sourceMessageId`, `createdAt`, `updatedAt`
    - Define `PreferenceHistoryEntry` with `previousValue`, `changedAt`, `sourceMessageId`
    - Define `PreferenceWithHistory` extending `Preference` with `history` array
    - _Requirements: 2.2, 2.3, 2.4_
  - [x] 1.3 Create `src/shared/interfaces/session.ts` with `SessionData` interface
    - Define `SessionData` with `id`, `createdAt`, `endedAt`, `messageCount`, `preferenceCount`
    - _Requirements: 3.4, 3.5_
  - [ ] 1.4 Create `src/shared/interfaces/ws-events.ts` with `WsEnvelope`, `ClientEvent`, and `ServerEvent` types
    - Define generic `WsEnvelope<T, P>` with `type`, `payload`, `timestamp`
    - Define all `ClientEvent` variants: `send_message`, `ping`
    - Define all `ServerEvent` variants: `agent_message`, `typing_start`, `typing_stop`, `preference_update`, `connection_status`, `session_init`, `error`, `pong`
    - _Requirements: 4.2, 6.4_
  - [ ] 1.5 Create `src/shared/constants/categories.ts` with `PREFERENCE_CATEGORIES` array and category metadata
    - Export `PREFERENCE_CATEGORIES` as const array of all 8 category strings
    - Export `CATEGORY_LABELS` map with display labels and descriptions per the design data model table
    - _Requirements: 2.4_
  - [ ] 1.6 Create `src/shared/index.ts` barrel export re-exporting all interfaces, types, and constants
    - _Requirements: 6.3_
  - [ ]* 1.7 Write unit tests for shared types and constants (`src/shared/__tests__/shared-exports.test.ts`)
    - Verify all interfaces are importable from barrel
    - Verify `PREFERENCE_CATEGORIES` contains exactly 8 entries
    - Verify `CATEGORY_LABELS` has an entry for each category
    - _Requirements: 7.1_

- [-] 2. Create shared validation utilities and error classes
  - [ ] 2.1 Create `src/shared/validation/message-validator.ts`
    - Implement `validateMessageContent(content: string): ValidationResult` — rejects empty/whitespace-only strings
    - Implement `validatePreference(pref: unknown): ValidationResult` — validates category is in enum, confidence is 0–1, key/value non-empty
    - Implement `validateSessionId(id: string): ValidationResult` — validates non-empty string format
    - _Requirements: 1.5, 2.2, 6.6_
  - [ ] 2.2 Create `src/shared/errors/` directory with `base-error.ts`, `connection-error.ts`, `llm-error.ts`, `extraction-error.ts`, `validation-error.ts`, `session-error.ts`, `storage-error.ts`, `context-error.ts`
    - Implement abstract `AppError` extending `Error` with `code`, `statusCode`, `context` fields
    - Implement each concrete error class per the design error classification table
    - _Requirements: 6.3_
  - [ ]* 2.3 Write unit tests for validation utilities (`src/shared/validation/message-validator.test.ts`)
    - Test empty string rejection, whitespace-only rejection, valid string acceptance
    - Test preference validation: valid preference passes, invalid category fails, out-of-range confidence fails
    - _Requirements: 7.1_
  - [ ]* 2.4 Write unit tests for error classes (`src/shared/errors/__tests__/errors.test.ts`)
    - Verify each error class has correct `code` and `statusCode`
    - Verify `context` is passed through constructor
    - _Requirements: 7.1_

- [-] 3. Create persistence layer interfaces and in-memory implementation
  - [ ] 3.1 Create `src/server/persistence/storage-interface.ts` with `StorageInterface` abstract interface
    - Define all methods: `savePreference`, `updatePreference`, `getPreferencesBySession`, `findPreference`, `saveMessage`, `getMessagesBySession`, `createSession`, `getSession`, `endSession`
    - _Requirements: 6.5_
  - [ ] 3.2 Create `src/server/persistence/in-memory-store.ts` implementing `StorageInterface`
    - Use `Map` collections for sessions, messages, and preferences
    - Implement preference history tracking on `updatePreference` — push old value to history array
    - Implement `findPreference` matching by `sessionId + category + key`
    - _Requirements: 2.2, 2.3, 3.1, 3.4, 6.5_
  - [ ] 3.3 Create `src/server/persistence/conversation-memory.ts` implementing `ConversationMemory` interface
    - Implement `addMessage`, `getHistory`, `getContextWindow`
    - `getContextWindow` estimates token count and truncates with summary placeholder when over budget
    - _Requirements: 3.1, 3.2, 3.6_
  - [ ]* 3.4 Write property test: Message persistence round trip (`src/server/persistence/__tests__/in-memory-store.test.ts`)
    - **Property 5: Message persistence round trip**
    - For any ChatMessage, `saveMessage` then `getMessagesBySession` returns list containing that message with identical fields. For N stored messages, returns exactly N.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 3.1, 3.2, 3.4**
  - [ ]* 3.5 Write property test: Preference persistence with valid structure (`src/server/persistence/__tests__/in-memory-store.test.ts`)
    - **Property 6: Preference persistence with valid structure**
    - For any persisted ExtractedPreference, the resulting Preference has non-empty `id`, valid `category`, non-empty `key`/`value`, confidence in [0, 1].
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 2.2, 2.4**
  - [ ]* 3.6 Write property test: Preference update retains history (`src/server/persistence/__tests__/in-memory-store.test.ts`)
    - **Property 7: Preference update retains history**
    - For any existing Preference updated N times, history array length equals N and most recent entry has `previousValue` equal to old value.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 2.3**
  - [ ]* 3.7 Write property test: Context window stays within token budget (`src/server/persistence/__tests__/conversation-memory.test.ts`)
    - **Property 8: Context window stays within token budget**
    - For any conversation history and any positive `maxTokens`, the returned ContextWindow's estimated tokens do not exceed `maxTokens`. If full history fits, `summary` is null.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 3.6**

- [ ] 4. Checkpoint — System Architect
  - Ensure all shared types compile with `tsc --noEmit`, all tests pass with `npm test -- --run`, ask the user if questions arise.


### 🎨 [UI Designer] — Branch: `feat/design-valentin-design-system`

- [-] 5. Create design system tokens and global styles
  - [ ] 5.1 Create `src/client/design-system/tokens.ts`
    - Define `colors` object with warm muted tones: dusty rose, champagne, soft burgundy, warm neutrals, plus semantic tokens (agent bubble, user bubble, background, text, border, highlight)
    - Define `typography` object with serif heading font family and sans-serif body font family, plus size scale
    - Define `spacing` object following 8px grid: `xs: 8`, `sm: 16`, `md: 24`, `lg: 32`, `xl: 40`, `xxl: 48`
    - Define `animation` object with durations between 200ms–400ms and easing curves
    - Define `borderRadius` tokens with soft rounded values for cards
    - Define `shadows` tokens with subtle card shadows
    - Define `breakpoints` object with `mobile: 768` threshold
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.7_
  - [ ] 5.2 Create `src/client/design-system/global-styles.ts`
    - Export CSS reset/base styles as template literal or style object
    - Apply typography tokens to body and headings
    - Set background color from tokens
    - _Requirements: 5.1, 5.2_
  - [ ]* 5.3 Write unit tests for design tokens (`src/client/design-system/tokens.test.ts`)
    - Verify all color tokens are valid hex or CSS color values
    - Verify all expected token groups exist (colors, typography, spacing, animation, borderRadius, shadows, breakpoints)
    - _Requirements: 7.1_
  - [ ]* 5.4 Write property test: Design token constraints (`src/client/design-system/tokens.test.ts`)
    - **Property 11: Design token constraints**
    - For any spacing token, its numeric value is a positive multiple of 8. For any animation duration token, its value is between 200ms and 400ms inclusive.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 5.3, 5.7**

- [ ] 6. Checkpoint — UI Designer
  - Ensure all design token tests pass, ask the user if questions arise.

### ⚛️ [Frontend Dev] — Branch: `feat/frontend-valentin-chat-ui`

- [ ] 7. Implement state management hooks and context
  - [ ] 7.1 Create `src/client/hooks/use-chat-state.ts`
    - Implement `ChatState` interface and `ChatAction` union type per design
    - Implement `chatReducer` handling all action types: `SESSION_INIT`, `SEND_MESSAGE`, `RECEIVE_MESSAGE`, `SET_TYPING`, `SET_CONNECTION`, `SET_INPUT`, `CLEAR_INPUT`
    - Export `useChatState` hook wrapping `useReducer`
    - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - [ ] 7.2 Create `src/client/hooks/use-preferences-state.ts`
    - Implement `PreferencesState` interface and `PreferencesAction` union type per design
    - Implement `preferencesReducer` handling `ADD_PREFERENCE`, `UPDATE_PREFERENCE`, `CLEAR_HIGHLIGHT`
    - Group preferences by category in state
    - Export `usePreferencesState` hook wrapping `useReducer`
    - _Requirements: 4.3, 4.6_
  - [ ] 7.3 Create `src/client/context/chat-context.tsx` and `src/client/context/preferences-context.tsx`
    - Create React Context providers wrapping the respective hooks
    - Export provider components and consumer hooks (`useChatContext`, `usePreferencesContext`)
    - _Requirements: 1.2, 4.3_
  - [ ]* 7.4 Write property test: Message submission adds to conversation (`src/client/hooks/__tests__/use-chat-state.test.ts`)
    - **Property 1: Message submission adds to conversation**
    - For any valid non-empty message and any current message list, dispatching `SEND_MESSAGE` grows the list by exactly one with `sender: 'user'` and matching `content`.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 1.2**
  - [ ]* 7.5 Write property test: Messages display in chronological order (`src/client/hooks/__tests__/use-chat-state.test.ts`)
    - **Property 2: Messages display in chronological order**
    - For any sequence of ChatMessages with arbitrary timestamps, the rendered list is sorted ascending by timestamp.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 1.3**
  - [ ]* 7.6 Write property test: Input cleared after message submission (`src/client/hooks/__tests__/use-chat-state.test.ts`)
    - **Property 4: Input cleared after message submission**
    - For any non-empty input value, after dispatching `SEND_MESSAGE`, the resulting state has empty `inputValue`.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 1.5**

- [ ] 8. Implement WebSocket client hook
  - [ ] 8.1 Create `src/client/hooks/use-websocket.ts`
    - Implement `useWebSocket` hook returning `{ sendMessage, connectionStatus, lastError }`
    - Auto-connect on mount, auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
    - Dispatch incoming `ServerEvent` messages to chat and preferences reducers via context
    - Implement ping/pong heartbeat every 30s
    - _Requirements: 1.2, 1.6, 4.2, 6.4_
  - [ ]* 8.2 Write unit tests for WebSocket hook (`src/client/hooks/__tests__/use-websocket.test.ts`)
    - Test initial connection status is `'disconnected'`
    - Test reconnection backoff timing
    - Test event dispatching to correct reducers
    - _Requirements: 7.2_

- [ ] 9. Implement Chat Panel components
  - [ ] 9.1 Create `src/client/components/MessageBubble.tsx`
    - Render message content with distinct styling based on `sender` field (agent vs user)
    - Agent messages: left-aligned, agent background color, avatar placeholder
    - User messages: right-aligned, user background color
    - Apply design tokens for colors, spacing, border-radius
    - _Requirements: 5.4_
  - [ ] 9.2 Create `src/client/components/MessageHistory.tsx`
    - Render list of `MessageBubble` components from chat state
    - Auto-scroll to bottom on new messages
    - _Requirements: 1.3_
  - [ ] 9.3 Create `src/client/components/MessageInput.tsx`
    - Text input with submit button
    - Validate non-empty before sending (use `validateMessageContent` from shared)
    - Clear input and return focus after submit
    - Handle Enter key to submit
    - _Requirements: 1.2, 1.5_
  - [ ] 9.4 Create `src/client/components/TypingIndicator.tsx`
    - Animated dots indicator, visible only when `isTyping` is true in chat state
    - Use animation duration tokens from design system
    - _Requirements: 1.4, 5.7_
  - [ ] 9.5 Create `src/client/components/ConnectionBanner.tsx`
    - Show banner when `connectionStatus` is `'reconnecting'` or `'disconnected'`
    - Display appropriate message for each status
    - _Requirements: 1.6_
  - [ ] 9.6 Create `src/client/components/ChatPanel.tsx`
    - Compose `MessageHistory`, `MessageInput`, `TypingIndicator`, `ConnectionBanner`
    - Wire to `useChatContext` for state and dispatch
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [ ]* 9.7 Write property test: Typing indicator reflects agent processing state (`src/client/components/__tests__/TypingIndicator.test.tsx`)
    - **Property 3: Typing indicator reflects agent processing state**
    - For any ChatState where `isTyping` is true, the indicator is visible. Where false, it is not visible.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 1.4**
  - [ ]* 9.8 Write property test: Message styling differs by sender (`src/client/components/__tests__/MessageBubble.test.tsx`)
    - **Property 12: Message styling differs by sender**
    - For any ChatMessage, the CSS class applied when `sender === 'agent'` differs from `sender === 'user'`.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 5.4**
  - [ ]* 9.9 Write component tests for Chat Panel components (`src/client/components/__tests__/ChatPanel.test.tsx`)
    - Test ChatPanel renders welcome message
    - Test MessageInput clears after submit
    - Test ConnectionBanner shows on disconnect
    - _Requirements: 7.2_

- [ ] 10. Implement Profile Dashboard components
  - [ ] 10.1 Create `src/client/components/PreferenceCard.tsx`
    - Display preference key, value, confidence badge
    - _Requirements: 4.3_
  - [ ] 10.2 Create `src/client/components/PreferenceHighlight.tsx`
    - Wrap PreferenceCard with highlight animation on update
    - Auto-clear highlight after animation duration from design tokens
    - _Requirements: 4.6, 5.7_
  - [ ] 10.3 Create `src/client/components/CategoryGroup.tsx`
    - Collapsible section with category label and item count
    - Render list of `PreferenceCard` components for that category
    - _Requirements: 4.4_
  - [ ] 10.4 Create `src/client/components/EmptyState.tsx`
    - Encouraging message when no preferences extracted yet
    - _Requirements: 4.5_
  - [ ] 10.5 Create `src/client/components/ProfileDashboard.tsx`
    - Compose `CategoryGroup` components grouped by category from preferences state
    - Show `EmptyState` when preferences are empty
    - Wire to `usePreferencesContext`
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6_
  - [ ]* 10.6 Write property test: Preferences grouped by category with correct counts (`src/client/components/__tests__/ProfileDashboard.test.tsx`)
    - **Property 9: Preferences grouped by category with correct counts**
    - For any set of PreferenceWithHistory objects, one CategoryGroup per distinct category, each with correct item count.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 4.3, 4.4**
  - [ ]* 10.7 Write property test: Updated preferences show highlight (`src/client/components/__tests__/ProfileDashboard.test.tsx`)
    - **Property 10: Updated preferences show highlight**
    - For any preference update event where `isNew` is false, the PreferenceCard has active highlight. After animation duration, highlight is cleared.
    - Use fast-check with 100+ iterations
    - **Validates: Requirements 4.6**
  - [ ]* 10.8 Write component tests for Profile Dashboard (`src/client/components/__tests__/ProfileDashboard.test.tsx`)
    - Test empty state renders when no preferences
    - Test CategoryGroup renders correct count
    - Test PreferenceCard displays key/value
    - _Requirements: 7.2_

- [ ] 11. Implement App layout and mobile navigation
  - [ ] 11.1 Create `src/client/components/MobileNav.tsx`
    - Tab-based toggle between Chat and Profile panels below 768px viewport
    - _Requirements: 5.6_
  - [ ] 11.2 Create `src/client/components/AppLayout.tsx`
    - Side-by-side dual-panel layout (ChatPanel left, ProfileDashboard right)
    - Switch to single-panel + MobileNav below 768px breakpoint
    - Apply design tokens for spacing and transitions
    - _Requirements: 4.1, 5.6, 5.7_
  - [ ] 11.3 Create `src/client/App.tsx` and `src/client/main.tsx`
    - Wire context providers (ChatContext, PreferencesContext)
    - Render AppLayout
    - Add top-level React Error Boundary
    - _Requirements: 4.1, 6.3_
  - [ ]* 11.4 Write component tests for layout (`src/client/components/__tests__/AppLayout.test.tsx`)
    - Test dual-panel renders at desktop width
    - Test MobileNav renders at mobile width
    - _Requirements: 7.2_

- [ ] 12. Checkpoint — Frontend Dev
  - Ensure all frontend tests pass with `npm test -- --run`, ask the user if questions arise.


### 🔧 [Backend Dev] — Branch: `feat/backend-valentin-agent-services`

- [ ] 13. Implement API layer (WebSocket gateway and HTTP routes)
  - [ ] 13.1 Create `src/server/api/ws-gateway.ts`
    - Implement WebSocket server accepting client connections
    - Parse incoming `ClientEvent` envelopes, validate structure
    - Route events to `event-router`
    - Broadcast `ServerEvent` messages to connected clients by session
    - Implement ping/pong handling
    - _Requirements: 1.6, 4.2, 6.4_
  - [ ] 13.2 Create `src/server/api/event-router.ts`
    - Route `send_message` events to `AgentOrchestrator.handleMessage`
    - Emit `typing_start` before orchestrator call, `typing_stop` after
    - Emit `agent_message` with orchestrator response
    - Emit `preference_update` when extraction pipeline produces results
    - _Requirements: 1.2, 1.4, 4.2_
  - [ ] 13.3 Create `src/server/api/http-routes.ts`
    - `GET /health` — health check endpoint
    - `POST /session` — create new session, return `sessionId`
    - `GET /session/:id/preferences` — return preferences for session
    - _Requirements: 6.3_
  - [ ]* 13.4 Write unit tests for API layer (`src/server/api/__tests__/event-router.test.ts`)
    - Test `send_message` event routes to orchestrator
    - Test typing events emitted in correct order
    - Test invalid event type returns error event
    - _Requirements: 7.3_

- [ ] 14. Implement Agent Orchestrator and Bedrock client
  - [ ] 14.1 Create `src/server/agent/bedrock-client.ts`
    - Wrap AWS Bedrock SDK for conversation generation (standard message API)
    - Wrap AWS Bedrock SDK for tool-use calls (preference extraction)
    - Accept model ID as configuration parameter
    - Handle Bedrock API errors, wrap in `LlmError`
    - _Requirements: 6.2_
  - [ ] 14.2 Create `src/server/agent/prompts.ts`
    - Define Valentin's system prompt (warm, sophisticated, curious personality)
    - Define preference extraction tool schema (`extract_preferences` tool)
    - _Requirements: 1.1, 2.1_
  - [ ] 14.3 Create `src/server/agent/agentcore-adapter.ts`
    - Wrap AWS AgentCore SDK for agent registration on startup
    - Map user sessions to AgentCore sessions
    - Handle AgentCore tool orchestration callbacks
    - _Requirements: 6.1_
  - [ ] 14.4 Create `src/server/agent/agent-orchestrator.ts` implementing `AgentOrchestrator` interface
    - `initSession()` — create session via storage, register with AgentCore, return welcome message
    - `handleMessage(sessionId, content)` — store message in ConversationMemory, get context window, call Bedrock for response, store response, trigger async preference extraction, return response as ChatMessage
    - Handle errors: wrap Bedrock failures in `LlmError`, retry once, show user-friendly error on second failure
    - _Requirements: 1.1, 1.2, 2.1, 2.5, 2.6, 3.2, 3.3, 3.6, 6.1, 6.2_
  - [ ]* 14.5 Write unit tests for Agent Orchestrator (`src/server/agent/__tests__/agent-orchestrator.test.ts`)
    - Test `initSession` returns sessionId and welcome message
    - Test `handleMessage` stores message, calls Bedrock, returns response
    - Test Bedrock failure triggers retry then returns error message
    - Test preference extraction is called asynchronously (does not block response)
    - Mock Bedrock client and storage
    - _Requirements: 7.3_

- [ ] 15. Implement Preference Extractor pipeline
  - [ ] 15.1 Create `src/server/extraction/category-mapper.ts`
    - Map raw extraction output categories to `PreferenceCategory` enum values
    - Handle unknown categories gracefully (log warning, skip)
    - _Requirements: 2.4_
  - [ ] 15.2 Create `src/server/extraction/preference-extractor.ts` implementing `PreferenceExtractor` interface
    - `extract(message, history)` — call Bedrock with tool-use schema, parse structured output, map categories, validate confidence scores
    - For each extracted preference: check if existing preference matches (same session + category + key), update if exists (triggering history), create if new
    - Persist to `PreferenceStore` and emit `preference_update` event via callback
    - Wrap failures in `ExtractionError`, log with message ID, never throw to caller
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [ ]* 15.3 Write unit tests for Preference Extractor (`src/server/extraction/__tests__/preference-extractor.test.ts`)
    - Test extraction with mocked Bedrock response returns structured preferences
    - Test duplicate preference triggers update with history
    - Test extraction failure logs error and returns empty array
    - Test category mapper handles unknown categories
    - _Requirements: 7.3_

- [ ] 16. Implement server entry point and wiring
  - [ ] 16.1 Create `src/server/index.ts`
    - Initialize in-memory store
    - Initialize ConversationMemory
    - Initialize Bedrock client with config
    - Initialize AgentCore adapter
    - Initialize PreferenceExtractor
    - Initialize AgentOrchestrator with all dependencies
    - Initialize EventRouter
    - Start HTTP server with routes and WebSocket gateway
    - Register agent with AgentCore on startup
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ]* 16.2 Write unit tests for server wiring (`src/server/__tests__/index.test.ts`)
    - Test server starts without errors with mocked dependencies
    - Test health endpoint returns 200
    - _Requirements: 7.3_

- [ ] 17. Checkpoint — Backend Dev
  - Ensure all backend tests pass with `npm test -- --run`, ask the user if questions arise.

### 🧪 [QA Agent] — Branch: `feat/qa-valentin-e2e-tests`

- [ ] 18. Set up E2E test infrastructure
  - [ ] 18.1 Create `playwright.config.ts`
    - Configure Chromium, Firefox, WebKit browsers
    - Set base URL to local dev server
    - Configure screenshot on failure
    - _Requirements: 7.4_
  - [ ] 18.2 Create `e2e/fixtures/page-objects.ts`
    - Define `ChatPage` page object with locators for: message input, send button, message list, typing indicator, connection banner
    - Define `ProfilePage` page object with locators for: category groups, preference cards, empty state
    - Define `AppPage` composing both with mobile nav toggle
    - _Requirements: 7.4_

- [ ] 19. Write E2E tests for critical user flows
  - [ ] 19.1 Create `e2e/tests/onboarding-flow.spec.ts`
    - Test: app loads and displays welcome message from Valentin
    - Test: user sends message and receives agent response in chat
    - Test: preference appears in Profile Dashboard after conversation
    - Test: typing indicator shows while agent is responding
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 4.2, 4.3, 7.4_
  - [ ] 19.2 Create `e2e/tests/responsive-layout.spec.ts`
    - Test: dual-panel layout at desktop viewport (≥768px)
    - Test: single-panel with tab toggle at mobile viewport (<768px)
    - Test: tab toggle switches between Chat and Profile panels
    - _Requirements: 5.6, 7.4_
  - [ ] 19.3 Create `e2e/tests/connection-recovery.spec.ts`
    - Test: connection banner appears when WebSocket disconnects
    - Test: app reconnects and resumes functionality after connection loss
    - _Requirements: 1.6, 7.4_

- [ ] 20. Final Checkpoint — QA Agent
  - Ensure all E2E tests pass with `npx playwright test`, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each agent works on their own feature branch — no cross-branch dependencies during implementation
- 🏗️ System Architect and 🎨 UI Designer must merge to `main` first — their outputs are imported by Frontend and Backend
- ⚛️ Frontend Dev and 🔧 Backend Dev can work in parallel after shared types are available
- 🧪 QA Agent starts after both Frontend and Backend PRs are merged
- Property tests use fast-check with 100+ iterations each
- All tests must pass in CI (`lint → test → build`) before PR merge
- Conventional commits: `feat(scope): description` per git-workflow steering
