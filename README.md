# Valentin — Romantic Concierge Agent

Valentin is an AI-powered romantic concierge that helps you build a detailed profile of your partner's preferences through natural conversation. You chat with a warm, sophisticated AI agent; it listens and automatically extracts structured insights — favourite foods, hobbies, love languages, important dates, and more — into a live Partner Profile dashboard.

---

## What it does

1. **Conversational onboarding** — Valentin greets the user and collects basic partner info (name, age/birthday, gender) before moving into open-ended preference discovery.
2. **Real-time preference extraction** — every user message is asynchronously analyzed by AWS Bedrock (Claude 3 Haiku) using tool-use, and extracted preferences are persisted and surfaced in the UI instantly over WebSocket.
3. **Partner Profile dashboard** — a side panel (or mobile tab) shows all extracted preferences grouped by category, with highlight animations on new or updated entries.
4. **Connection resilience** — a reconnecting WebSocket with a visible banner keeps the experience smooth even during brief network interruptions.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (React + Vite)                             │
│  ┌──────────────┐   ┌───────────────────────────┐  │
│  │  ChatPanel   │   │   ProfileDashboard         │  │
│  │  (messages)  │   │   (CategoryGroup cards)    │  │
│  └──────┬───────┘   └───────────────────────────┘  │
│         │ WebSocket (ws-events)                      │
└─────────┼───────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────┐
│  Express + ws server                                │
│  ┌──────────────┐   ┌───────────────────────────┐  │
│  │  WsGateway   │──▶│  EventRouter               │  │
│  └──────────────┘   └──────────┬────────────────┘  │
│                                │                    │
│  ┌─────────────────────────────▼────────────────┐  │
│  │  AgentOrchestrator                            │  │
│  │  ┌──────────────┐  ┌──────────────────────┐  │  │
│  │  │ BedrockClient│  │ PreferenceExtractor   │  │  │
│  │  │ (Converse API│  │ (tool-use extraction) │  │  │
│  │  └──────────────┘  └──────────────────────┘  │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │  InMemoryStore  +  ConversationMemory         │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
          │
    AWS Bedrock (Claude 3 Haiku)
```

### Key layers

| Layer | Location | Responsibility |
|---|---|---|
| Shared types & constants | `src/shared/` | `ChatMessage`, `Preference`, `SessionData`, WebSocket event envelopes, category definitions |
| React UI | `src/client/` | Chat panel, profile dashboard, design tokens, WebSocket/chat/preferences context |
| Express server | `src/server/` | HTTP routes, WebSocket gateway, event routing |
| Agent | `src/server/agent/` | Bedrock Converse API wrapper, preference extraction via tool-use, session orchestration |
| Persistence | `src/server/persistence/` | In-memory store + conversation context window management |
| Extraction | `src/server/extraction/` | Preference extractor + category mapper |

---

## Preference categories

Valentin tracks eight categories:

| Category | What it captures |
|---|---|
| `food` | Cuisines, dietary preferences, favourite restaurants |
| `hobbies` | Activities, sports, creative pursuits |
| `music` | Genres, artists, concert preferences |
| `travel` | Dream destinations, travel style |
| `gifts` | Wish-list items, preferred gift types |
| `love_language` | How they give and receive love |
| `important_dates` | Birthdays, anniversaries, milestones |
| `personality_traits` | Temperament, social style, values |

---

## Tech stack

| Concern | Choice |
|---|---|
| Frontend | React 19 + TypeScript (Vite) |
| Backend | Express 5 + `ws` WebSocket server |
| LLM | AWS Bedrock — Claude 3 Haiku (`anthropic.claude-3-haiku-20240307-v1:0`) |
| Unit tests | Vitest + React Testing Library |
| E2E tests | Playwright (Chromium, Firefox, WebKit) |
| Language | TypeScript strict mode throughout |

---

## Getting started

### Prerequisites

- Node.js ≥ 20
- AWS credentials with Bedrock access (`us-east-1` by default)

### Install

```bash
npm install
```

### Run in development

**You need TWO separate terminal windows/tabs running simultaneously:**

#### Terminal 1 — Start the backend server

```bash
npm run dev:server
```

Wait for the output:
```
[server] Valentin backend listening on http://localhost:3001
```

#### Terminal 2 — Start the frontend dev server

```bash
npm run dev
```

Wait for the output:
```
VITE v6.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
```

Then open **http://localhost:5173** in your browser.

**Alternative (less reliable):** Run both together in one terminal:

```bash
npm run dev:full
```

### Build for production

```bash
npm run build
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `AWS_REGION` | `us-east-1` | AWS region for Bedrock |
| `BEDROCK_MODEL_ID` | `anthropic.claude-3-haiku-20240307-v1:0` | Bedrock model ID |
| `PORT` | `3001` | Express server port |

---

## Testing

```bash
# Unit + component tests (single run, no watch)
npm test -- --run

# E2E tests (requires the dev server to be running)
npx playwright test
```

Test coverage spans:

- **Shared utilities** — validators, error classes, barrel exports
- **Design tokens** — token presence and value correctness
- **React components** — render, interaction, accessibility attributes
- **Hooks** — state transitions for chat and WebSocket
- **Server** — event routing, orchestrator, Bedrock client, preference extractor, in-memory store
- **E2E** — onboarding flow, connection recovery, responsive layout

---

## Project status

### Done ✅

- Full-stack skeleton: React client + Express/ws server
- Shared type system: `ChatMessage`, `Preference`, `SessionData`, WebSocket event envelopes
- AWS Bedrock integration (Converse API) with retry logic
- Async preference extraction pipeline via Bedrock tool-use
- In-memory persistence: session store + conversation context window
- WebSocket gateway: session-scoped broadcast, ping/pong, reconnection banner
- Complete UI: chat panel, profile dashboard, mobile-responsive layout, typing indicator
- Design system: warm-romantic token set (colors, spacing, typography, breakpoints)
- Error boundaries, custom error hierarchy, input validation
- Unit test suite (Vitest + RTL) covering all layers
- E2E test suite (Playwright) for critical user flows

### Planned / in progress 🚧

- Real AWS AgentCore SDK integration (currently stubbed — `StubAgentCoreAdapter`)
- Persistent storage backend (replace `InMemoryStore` with DynamoDB or similar)
- Session persistence across page reloads
- Export / share the Partner Profile as a PDF or shareable link
- Multi-session support with a session list view
- Richer preference history UI (timeline of changes per preference)
- Production HTTP server entry point (current `TODO(yellow)` in `src/server/index.ts`)
- Deployed environment (CI/CD pipeline wiring)
