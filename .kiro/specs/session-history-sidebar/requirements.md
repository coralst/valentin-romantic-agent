# Requirements Document

## Introduction

The session history sidebar adds a collapsible left panel to the Valentin application that lists past and current chat sessions. Users can start new sessions, switch between existing ones, and delete sessions they no longer need. All session data (messages, preferences, metadata) is persisted in localStorage so conversations survive page reloads.

This is a client-side-only feature. The server's in-memory store remains unchanged; the client manages its own persistence layer. A future phase will migrate to a server-side database.

## Glossary

- **Session_Sidebar**: The collapsible left panel displaying the session list and controls.
- **Session_Entry**: A single row in the session list representing one conversation session.
- **Session_Store**: The localStorage-based persistence layer that saves and restores session data on the client.
- **Active_Session**: The session currently loaded in the Chat_Panel and Profile_Dashboard.
- **Sidebar_Rail**: The collapsed state of the Session_Sidebar showing only icons and a toggle button.

## Requirements

### Requirement 1: Session List Display

**User Story:** As a user, I want to see a list of my past conversations so I can return to any previous session.

#### Acceptance Criteria

1. THE Session_Sidebar SHALL display all sessions stored in the Session_Store, ordered by last activity timestamp descending (most recent first).
2. EACH Session_Entry SHALL display the partner name (if discovered), a preview of the last message (truncated to 40 characters), and a relative timestamp of last activity.
3. THE Active_Session SHALL be visually distinguished from other entries with a highlight background.
4. WHEN no sessions exist in the Session_Store, THE Session_Sidebar SHALL display a message encouraging the user to start their first conversation.
5. WHEN a session has no partner name discovered, THE Session_Entry SHALL display "New conversation" as the title.

### Requirement 2: New Session Creation

**User Story:** As a user, I want to start a new conversation while preserving my previous ones.

#### Acceptance Criteria

1. THE Session_Sidebar SHALL display a "New chat" button at the top of the session list.
2. WHEN the user activates the "New chat" button, THE application SHALL create a new session, set it as the Active_Session, and connect to the server for a fresh welcome message.
3. WHEN a new session is created, THE Session_Store SHALL persist the previous Active_Session's state before switching.
4. THE newly created session SHALL appear at the top of the session list.

### Requirement 3: Session Switching

**User Story:** As a user, I want to click a past session to resume that conversation.

#### Acceptance Criteria

1. WHEN the user activates a Session_Entry, THE application SHALL save the current Active_Session to the Session_Store, load the selected session's messages and preferences, and set it as the Active_Session.
2. AFTER switching, THE Chat_Panel SHALL display the loaded session's message history.
3. AFTER switching, THE Profile_Dashboard SHALL display the loaded session's extracted preferences.
4. THE WebSocket connection SHALL remain active; messages sent after switching belong to the new Active_Session.

### Requirement 4: localStorage Persistence

**User Story:** As a user, I want my conversations to survive page reloads so I never lose chat history.

#### Acceptance Criteria

1. THE Session_Store SHALL persist all session data (messages, preferences, metadata) in localStorage keyed by `valentin_sessions`.
2. WHEN the application loads, THE Session_Store SHALL restore the most recent Active_Session and populate the session list.
3. WHEN a message is sent or received, THE Session_Store SHALL persist the updated session within 1 second.
4. IF localStorage data cannot be parsed, THE Session_Store SHALL discard the corrupt data and start fresh.
5. THE Session_Store SHALL limit total storage to the 10 most recent sessions to avoid exceeding localStorage quota.

### Requirement 5: Collapsible Sidebar

**User Story:** As a user, I want to collapse the sidebar when I want more space for the chat.

#### Acceptance Criteria

1. THE Session_Sidebar SHALL toggle between an expanded state (showing full session entries) and a collapsed Sidebar_Rail state.
2. THE Sidebar_Rail SHALL display only a toggle button and a "New chat" icon button.
3. WHEN the user activates the toggle, THE Session_Sidebar SHALL animate between states with a duration between 200ms and 400ms.
4. THE Session_Sidebar SHALL persist its collapsed/expanded state in localStorage.
5. THE expanded Session_Sidebar SHALL have a width of 280px on desktop.

### Requirement 6: Session Deletion

**User Story:** As a user, I want to delete a conversation I no longer need.

#### Acceptance Criteria

1. EACH Session_Entry SHALL display a delete button on hover (desktop) or via swipe gesture affordance (mobile).
2. WHEN the user activates the delete button, THE Session_Store SHALL remove that session from persistence and the session list.
3. IF the deleted session is the Active_Session, THE application SHALL switch to the next most recent session, or create a new session if none remain.
4. THE deletion SHALL not require confirmation for single sessions.

### Requirement 7: Session Metadata

**User Story:** As a user, I want to see key info about each session at a glance.

#### Acceptance Criteria

1. EACH Session_Entry SHALL display: partner name (or "New conversation"), message count badge, and relative time since last activity.
2. THE relative time SHALL update without requiring page reload (e.g., "2m ago" → "3m ago").
3. WHEN a session has extracted preferences, THE Session_Entry MAY display a small preference count indicator.

### Requirement 8: Responsive Behavior

**User Story:** As a mobile user, I want the sidebar accessible without cluttering my chat view.

#### Acceptance Criteria

1. WHILE the viewport width is below 768px, THE Session_Sidebar SHALL be hidden by default.
2. WHEN the user activates the sidebar toggle on mobile, THE Session_Sidebar SHALL appear as an overlay with a backdrop.
3. WHEN the user selects a session or taps the backdrop on mobile, THE Session_Sidebar SHALL close automatically.
4. THE mobile overlay SHALL animate from the left edge with a duration between 200ms and 400ms.

### Requirement 9: Design Consistency

**User Story:** As a user, I want the sidebar to feel like a natural part of the Valentin experience.

#### Acceptance Criteria

1. THE Session_Sidebar SHALL draw all colors, spacing, typography, shadows, and border-radius values from the Design_System tokens.
2. THE Session_Sidebar background SHALL use a slightly elevated surface color to distinguish it from the main content area.
3. THE "New chat" button SHALL use the accent gradient defined in the Design_System.
4. EACH Session_Entry SHALL use card-like styling with subtle hover effects.
5. THE toggle button SHALL use a chevron or hamburger icon consistent with the app's minimal iconography.
