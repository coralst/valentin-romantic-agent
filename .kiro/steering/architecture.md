---
inclusion: fileMatch
fileMatchPattern: "src/shared/**,src/client/**,src/server/**"
---

# Architecture Guidelines

Loaded conditionally when touching core structure files. These rules supplement the system-architect agent's decisions.

## Project Structure

```
src/
├── client/                          — Frontend (React + Vite)
│   ├── components/                  — UI components (frontend-dev owns)
│   │   └── __tests__/               — Component tests
│   ├── hooks/                       — Custom React hooks (frontend-dev owns)
│   │   └── __tests__/               — Hook tests
│   ├── context/                     — React context providers (frontend-dev owns)
│   ├── design-system/               — Design tokens & global styles (ui-designer owns)
│   ├── App.tsx                      — Root component (frontend-dev owns)
│   └── main.tsx                     — Entry point (frontend-dev owns)
├── server/                          — Backend (Node.js + Express)
│   ├── api/                         — HTTP routes, WebSocket gateway, event router (backend-dev owns)
│   │   └── __tests__/
│   ├── agent/                       — AgentCore adapter, Bedrock client, orchestrator (backend-dev owns)
│   │   └── __tests__/
│   ├── extraction/                  — Preference extractor, category mapper (backend-dev owns)
│   │   └── __tests__/
│   ├── persistence/                 — Storage interface, in-memory store, conversation memory (backend-dev owns)
│   │   └── __tests__/
│   ├── index.ts                     — Server entry point (backend-dev owns)
│   └── dev-server.ts                — Dev server wiring (backend-dev owns)
├── shared/                          — Shared types, constants, utils (system-architect owns)
│   ├── interfaces/                  — Interface contracts (message, preference, session, ws-events)
│   ├── constants/                   — Shared constants & enums
│   ├── validation/                  — Validation utilities
│   ├── errors/                      — Custom error classes
│   └── index.ts                     — Barrel export
e2e/                                 — E2E tests (qa-agent owns)
├── tests/                           — Playwright test files
└── fixtures/                        — Page objects & helpers
```

## File Ownership Boundaries

Each agent has clear file ownership. Agents must NOT modify files outside their domain:

| Agent | Owns | Does NOT touch |
|-------|------|----------------|
| system-architect | `src/shared/` | Client components, server routes, design tokens |
| frontend-dev | `src/client/components/`, `src/client/hooks/`, `src/client/context/`, `src/client/App.tsx`, `src/client/main.tsx` | Server code, shared types, design tokens |
| backend-dev | `src/server/api/`, `src/server/agent/`, `src/server/extraction/`, `src/server/persistence/`, `src/server/index.ts`, `src/server/dev-server.ts` | Client components, shared types, design tokens |
| ui-designer | `src/client/design-system/` | Server code, component logic, shared types |
| qa-agent | `e2e/`, `playwright.config.ts` | Source code (`src/`) |

## Dependency Direction

```
client/components → client/hooks → client/context → shared/
client/design-system → (standalone, consumed by components)
server/api → server/agent → server/extraction → shared/
server/api → server/persistence → shared/
```

Dependencies flow inward toward `shared/`. Never create circular dependencies.

## Interface Contract Rules

- All contracts live in `src/shared/interfaces/`
- Backend and frontend both import from shared types — single source of truth
- Changing a contract requires system-architect approval
- Breaking changes to contracts must be documented in an ADR
- Use discriminated unions for API response types (success/error)

## Configuration

- Use environment variables for secrets (never commit them)
- Provide sensible defaults for development
- Validate config at startup — fail fast on missing required values
