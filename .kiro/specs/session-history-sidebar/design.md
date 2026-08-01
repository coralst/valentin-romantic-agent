# Design Document — Session History Sidebar

## Component Hierarchy

```
AppLayout
  SessionSidebar
    SidebarHeader
      NewChatButton
      CollapseToggle
    SessionList
      SessionEntry (x N)
        PartnerName
        LastMessagePreview
        RelativeTime
        MessageCountBadge
        DeleteButton (hover)
    EmptyState (when no sessions)
  ChatPanel
  ProfileDashboard
```

## Data Flow

```
localStorage ("valentin_sessions")
       |
  useSessionStore (hook) — load / save / delete / create
       |
  SessionProvider (React context)
       |
  SessionSidebar <-> AppLayout -> ChatProvider (reset on switch)
```

## Interfaces

```typescript
interface StoredSession {
  id: string;
  partnerName: string | null;
  messages: ChatMessage[];
  preferences: PreferenceWithHistory[];
  lastActivity: string; // ISO 8601
  messageCount: number;
}
```

## Storage Schema

- **Key**: `valentin_sessions` — JSON array of `StoredSession[]`
- **Sidebar state key**: `valentin_sidebar_collapsed` — boolean
- **Max sessions**: 10 (evict oldest by `lastActivity`)
- **Corruption recovery**: catch JSON.parse errors, discard and start fresh

## State Management

### useSessionStore Hook

Handles localStorage read/write:
- `loadSessions(): StoredSession[]`
- `saveSession(session: StoredSession): void`
- `deleteSession(id: string): void`
- `createNewSession(): StoredSession`

### SessionProvider Context

Uses `useReducer` with actions:
- `LOAD_SESSIONS` — initialize from localStorage
- `SET_ACTIVE` — switch active session
- `ADD_SESSION` — create and prepend
- `DELETE_SESSION` — remove by id
- `UPDATE_SESSION` — update messages/preferences for active session
- `TOGGLE_SIDEBAR` — expand/collapse

Exposes:
- `sessions: StoredSession[]`
- `activeSessionId: string | null`
- `sidebarCollapsed: boolean`
- `createSession(): void`
- `switchSession(id: string): void`
- `deleteSession(id: string): void`
- `updateActiveSession(messages, preferences): void`
- `toggleSidebar(): void`

## Responsive Behavior

- **Desktop (>= 768px)**: Sidebar is inline, collapsible (280px expanded / 56px rail)
- **Mobile (< 768px)**: Sidebar hidden by default, opens as fixed overlay with backdrop

## Animations

- Sidebar expand/collapse: `width` transition, 300ms, easeInOut
- Mobile overlay: `transform: translateX` from -100% to 0, 300ms, easeInOut
- Session entry hover: subtle shadow elevation, 200ms
