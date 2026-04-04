# Requirements Document

## Introduction

Valentin the Romantic Agent is a Phase 1 POC for TFC that helps users make their spouse happier through conversational onboarding and memory. The system provides a sophisticated web-based chat interface where users interact naturally with an AI agent named Valentin. During conversation, the agent silently extracts spouse preferences and builds a structured knowledge base. A real-time dual-panel dashboard displays the chat alongside extracted preferences, giving users transparency into what the agent learns.

The architecture uses AWS Bedrock for LLM capabilities and AgentCore for agent orchestration, with a modular backend designed for future extensibility (Telegram bot, calendar integration).

## Glossary

- **Valentin**: The AI conversational agent that guides onboarding and extracts spouse preferences from natural dialogue
- **Chat_Panel**: The left-side UI panel where the user converses with Valentin via text messages
- **Profile_Dashboard**: The right-side UI panel that displays extracted spouse preferences in real time
- **Preference_Extractor**: The backend service that analyzes conversation messages and extracts structured spouse preference data using AWS Bedrock
- **Preference_Store**: The persistence layer that stores extracted spouse preferences as structured data
- **Conversation_Memory**: The session-scoped storage that retains all messages and extracted context for the duration of a user session
- **WebSocket_Gateway**: The real-time communication layer between the frontend and backend that pushes preference updates and streams chat responses
- **Agent_Orchestrator**: The backend service built on AWS AgentCore that coordinates Valentin's conversational flow and tool invocations
- **Design_System**: The set of design tokens (colors, typography, spacing) and reusable UI components that define the visual identity of the application
- **Session**: A single continuous interaction period between a user and Valentin, from page load to page close

## Requirements

### Requirement 1: Conversational Web Interface

**User Story:** As a user, I want to onboard by chatting naturally with Valentin via a web interface so the experience feels like interacting with an intelligent assistant rather than filling out static forms.

#### Acceptance Criteria

1. WHEN the user opens the application, THE Chat_Panel SHALL display a welcome message from Valentin that initiates the onboarding conversation.
2. WHEN the user submits a text message, THE Chat_Panel SHALL send the message to the Agent_Orchestrator and display the user's message immediately in the conversation thread.
3. WHEN the Agent_Orchestrator generates a response, THE Chat_Panel SHALL display Valentin's reply within the conversation thread in chronological order.
4. WHILE the Agent_Orchestrator is generating a response, THE Chat_Panel SHALL display a visible typing indicator to the user.
5. WHEN the user submits a message, THE Chat_Panel SHALL clear the input field and return focus to the input field for the next message.
6. IF the WebSocket_Gateway connection is lost, THEN THE Chat_Panel SHALL display a connection status banner and attempt to reconnect automatically.

### Requirement 2: Automated Background Profiling

**User Story:** As a system, I want to silently extract spouse preferences from the natural chat stream so the agent can dynamically build a structured knowledge base without interrupting the conversation flow.

#### Acceptance Criteria

1. WHEN the Agent_Orchestrator receives a user message, THE Preference_Extractor SHALL analyze the message for spouse preference data using AWS Bedrock.
2. WHEN the Preference_Extractor identifies a new preference, THE Preference_Store SHALL persist the preference as a structured record with category, key, value, and confidence score.
3. WHEN the Preference_Extractor identifies an update to an existing preference, THE Preference_Store SHALL update the existing record and retain the previous value in a history log.
4. THE Preference_Extractor SHALL categorize preferences into defined categories including: food, hobbies, music, travel, gifts, love_language, important_dates, and personality_traits.
5. THE Preference_Extractor SHALL operate asynchronously so that preference extraction does not add latency to the conversational response delivered to the user.
6. IF the Preference_Extractor fails to process a message, THEN THE Agent_Orchestrator SHALL log the failure with the message identifier and continue the conversation without interruption.

### Requirement 3: Persistent Conversational Memory

**User Story:** As a user, I want Valentin to remember details from previous messages in our session so I do not have to repeat context or previously stated facts.

#### Acceptance Criteria

1. WHEN the user sends a message, THE Conversation_Memory SHALL store the message along with a timestamp and sender identifier.
2. WHEN the Agent_Orchestrator prepares a prompt for AWS Bedrock, THE Conversation_Memory SHALL provide the full conversation history for the current Session.
3. WHEN the user references a previously stated fact, THE Agent_Orchestrator SHALL incorporate the relevant context from Conversation_Memory into the response.
4. THE Conversation_Memory SHALL retain all messages for the duration of the Session.
5. WHEN a Session ends, THE Conversation_Memory SHALL persist the session data to the Preference_Store so that extracted preferences survive beyond the session.
6. IF the Conversation_Memory exceeds the LLM context window limit, THEN THE Agent_Orchestrator SHALL summarize older messages and retain the summary alongside recent messages.

### Requirement 4: Real-Time Dual-Panel Dashboard

**User Story:** As a user, I want to view the extracted preferences updating in real-time alongside our chat so I can visually verify exactly what the agent is learning and tracking.

#### Acceptance Criteria

1. THE Profile_Dashboard SHALL display alongside the Chat_Panel in a side-by-side dual-panel layout.
2. WHEN the Preference_Extractor persists a new preference, THE WebSocket_Gateway SHALL push the updated preference to the Profile_Dashboard within 2 seconds.
3. WHEN the Profile_Dashboard receives a new preference, THE Profile_Dashboard SHALL render the preference under its corresponding category with a visual highlight animation indicating a new addition.
4. THE Profile_Dashboard SHALL group preferences by category and display each category as a collapsible section with a category label and item count.
5. WHEN no preferences have been extracted yet, THE Profile_Dashboard SHALL display an empty state message encouraging the user to continue chatting with Valentin.
6. WHEN a preference is updated, THE Profile_Dashboard SHALL visually indicate the change by highlighting the updated value.

### Requirement 5: Sophisticated UI/UX Design

**User Story:** As a user, I want the dashboard's visual design to be pleasant, warm, and romantic without feeling kitschy or cheesy, so the app feels like a sophisticated, premium assistant for an adult relationship.

#### Acceptance Criteria

1. THE Design_System SHALL define a color palette using warm, muted tones (dusty rose, champagne, soft burgundy, warm neutrals) that convey romance without appearing juvenile.
2. THE Design_System SHALL define typography tokens using a serif font for headings and a clean sans-serif font for body text to balance elegance with readability.
3. THE Design_System SHALL define spacing tokens following an 8px grid system for consistent layout rhythm.
4. THE Chat_Panel SHALL style Valentin's messages with a distinct visual treatment (background color, avatar) that differentiates agent messages from user messages.
5. THE Profile_Dashboard SHALL use subtle card-based layouts with soft shadows and rounded corners for preference categories.
6. WHILE the viewport width is below 768px, THE application SHALL switch to a single-panel layout with a tab-based toggle between Chat_Panel and Profile_Dashboard.
7. THE application SHALL use smooth transitions and micro-animations for state changes (new preferences appearing, panel toggling, typing indicators) with a duration between 200ms and 400ms.

### Requirement 6: Architecture and Extensibility

**User Story:** As a developer, I want the system architecture to be modular and extensible so that future phases (Telegram bot, calendar integration) can be added without restructuring the core system.

#### Acceptance Criteria

1. THE Agent_Orchestrator SHALL use AWS AgentCore for agent lifecycle management and tool orchestration.
2. THE Agent_Orchestrator SHALL use AWS Bedrock as the LLM provider for conversation generation and preference extraction.
3. THE system SHALL separate the API layer, agent layer, and persistence layer into distinct modules with defined interfaces between them.
4. THE WebSocket_Gateway SHALL expose a protocol-agnostic event interface so that future clients (Telegram bot) can subscribe to the same event stream.
5. THE Preference_Store SHALL expose a storage interface that abstracts the underlying persistence mechanism, allowing future migration from session storage to a database.
6. THE system SHALL use TypeScript in strict mode for all frontend and backend code.
7. THE system SHALL structure the codebase using kebab-case file naming for TypeScript files and PascalCase for React component files.

### Requirement 7: Testing and Quality Assurance

**User Story:** As a developer, I want comprehensive test coverage across all layers so that the system remains stable as features are added in future phases.

#### Acceptance Criteria

1. THE system SHALL include unit tests for all shared utility functions and data models using Vitest.
2. THE system SHALL include component tests for all React components using React Testing Library.
3. THE system SHALL include unit tests for all backend services including the Preference_Extractor and Agent_Orchestrator.
4. THE system SHALL include end-to-end tests for the critical user flow (open app, send message, receive response, see preference extracted) using Playwright.
5. THE system SHALL colocate test files alongside source files or within __tests__/ directories.
6. THE system SHALL enforce that all tests pass in CI before code can be merged to the main branch.
