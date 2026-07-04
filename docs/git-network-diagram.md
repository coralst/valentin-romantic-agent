# Git Network Diagram - Integration Branch Approach

This diagram shows how the GitHub network graph would look using the spec-based integration branch workflow.

## Legend
- `●` = Commit
- `→` = PR merge
- `║` = Branch continues
- `╔═╗` = PR opened
- `╚═╝` = PR merged

---

## Example: Two Specs in Parallel

```
main ●─────●─────●─────●─────●─────●─────●─────●─────●─────●───────●
     │     │     │     │     │     │     │     │     │     │       │
     │     │     │     │     │     │     │     │     │     │       │
     │   Issue #1: Chat Feature                │     │     │     Issue #2: User Profile
     │   Created                                │     │     │     Created
     │                                          │     │     │
     │                                          │     │     │
     └─── feat/chat-feature ●───●───●───●───●──┘     │     │
          (integration branch) │   │   │   │   │      │     │
          Spec: chat-feature   │   │   │   │   │      │     │
                               │   │   │   │   │      │     │
          ┌────────────────────┘   │   │   │   │      │     │
          │                        │   │   │   │      │     │
          │  feat/chat-frontend ●──┘   │   │   │      │     │
          │  (agent branch)     │      │   │   │      │     │
          │  Agent: frontend    ●──────┘   │   │      │     │
          │                     │          │   │      │     │
          │                  [PR #10]      │   │      │     │
          │                  frontend →    │   │      │     │
          │                  integration   │   │      │     │
          │                     │          │   │      │     │
          │                     ●──────────┘   │      │     │
          │                  (merged)          │      │     │
          │                                    │      │     │
          │  feat/chat-backend ●───●───────────┘      │     │
          │  (agent branch)     │   │                 │     │
          │  Agent: backend     │   │                 │     │
          │                     │   │                 │     │
          │                  [PR #11]                 │     │
          │                  backend →                │     │
          │                  integration              │     │
          │                     │                     │     │
          │                     ●─────────────────────┘     │
          │                  (merged)                       │
          │                                                 │
          │  feat/chat-design ●───●                         │
          │  (agent branch)    │   │                        │
          │  Agent: ui-design  │   │                        │
          │                    │   │                        │
          │                 [PR #12]                        │
          │                 design →                        │
          │                 integration                     │
          │                    │                            │
          │                    ●────────────────────────────┘
          │                 (merged)
          │
          │  All agent PRs merged!
          │  CI passes on integration branch
          │
          │              [PR #13] ← FINAL PR
          │              feat/chat-feature → main
          │              Resolves #1
          │              Reviewed by master-agent
          │
          └──────────────────────●
                              (merged to main)
                              Issue #1 closed
                              Branches deleted


          Meanwhile, spec 2 starts...

                                 feat/user-profile ●───●───●───●
                                 (integration branch) │   │   │
                                 Spec: user-profile   │   │   │
                                                      │   │   │
                          ┌───────────────────────────┘   │   │
                          │                               │   │
                          │  feat/profile-frontend ●──────┘   │
                          │  (agent branch)        │          │
                          │  Agent: frontend       ●──────────┘
                          │                        │
                          │                     [PR #20]
                          │                     frontend →
                          │                     integration
                          │                        │
                          │                        ●
                          │                     (merged)
                          │
                          │  feat/profile-backend ●───●
                          │  (agent branch)       │   │
                          │  Agent: backend       │   │
                          │                       │   │
                          │                    [PR #21]
                          │                    backend →
                          │                    integration
                          │                       │
                          │                       ●
                          │                    (merged)
                          │
                          │              [PR #22] ← FINAL PR
                          │              feat/user-profile → main
                          │              Resolves #2
                          │
                          └──────────────────────●
                                              (merged to main)
                                              Issue #2 closed
```

---

## Timeline View: Single Spec Lifecycle

```
Day 1 (Monday)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Issue #15 Created
  Title: "Add real-time notifications"
  Labels: feature, needs-spec
  
  Discussion:
  - Master-agent defines requirements
  - System-architect proposes technical design
  - Spec approved ✓

Branches Created:
  ✓ feat/notifications (integration branch from main)
  ✓ feat/notifications-frontend (from integration)
  ✓ feat/notifications-backend (from integration)
  ✓ feat/notifications-design (from integration)

Draft PRs Opened:
  ✓ PR #101: frontend → integration
  ✓ PR #102: backend → integration
  ✓ PR #103: design → integration


Day 2 (Tuesday)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Agents working in parallel:

  feat/notifications-frontend
    ● Add NotificationBell component
    ● Add NotificationList component
    ● Ready for Review (commented on PR #101)
  
  feat/notifications-backend
    ● Add WebSocket notification endpoint
    ● Add notification persistence layer
    
  feat/notifications-design
    ● Add notification color tokens
    ● Ready for Review (commented on PR #103)


Day 3 (Wednesday)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR Reviews & Merges:

  PR #103 (design → integration) MERGED ✓
    - Master-agent approved
    - CI passed
  
  PR #101 (frontend → integration) MERGED ✓
    - Master-agent approved
    - CI passed
    - QA-agent signed off
  
  feat/notifications-backend
    ● Add notification filtering logic
    ● Ready for Review (commented on PR #102)


Day 4 (Thursday)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Final Agent PR Merged:

  PR #102 (backend → integration) MERGED ✓
    - Master-agent approved
    - CI passed
    - All tests green

Integration Branch Status:
  feat/notifications
    ✓ All agent work merged
    ✓ CI passing on integration branch
    ✓ E2E tests passing
    ✓ No merge conflicts with main

Final PR Created:
  PR #104: feat/notifications → main
    Title: "Add real-time notifications"
    Body: "Resolves #15"
    Status: Ready for review
    Quality: 🟢 Green


Day 5 (Friday)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Final Merge to Main:

  PR #104 MERGED to main ✓
    - Master-agent final approval
    - CI passed
    - Issue #15 auto-closed
    - Branches deleted:
      × feat/notifications
      × feat/notifications-frontend
      × feat/notifications-backend
      × feat/notifications-design
```

---

## PR Relationships Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Issue #15: Add real-time notifications                       │
│ Status: Closed                                                │
│ Closed by: PR #104                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ "Resolves #15"
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ PR #104: feat/notifications → main                           │
│ Status: Merged                                                │
│ Type: Integration PR (final merge)                           │
│ Reviews: ✓ Master-agent approved                             │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
                              │ Depends on:
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ PR #101         │ │ PR #102         │ │ PR #103         │
│ frontend →      │ │ backend →       │ │ design →        │
│ integration     │ │ integration     │ │ integration     │
│                 │ │                 │ │                 │
│ Status: Merged  │ │ Status: Merged  │ │ Status: Merged  │
│ Agent: frontend │ │ Agent: backend  │ │ Agent: design   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Key Benefits Visualized

### 1. Parallel Work (Agents Don't Block Each Other)
```
Time →
      Day 1          Day 2          Day 3          Day 4
      ╔═══╗          ╔═══╗          ╔═══╗          ╔═══╗
      ║ F ║══════════║ F ║══════════║ F ║═══[DONE] ║   ║
      ╚═══╝          ╚═══╝          ╚═══╝          ╚═══╝
      ╔═══╗          ╔═══╗          ╔═══╗          ╔═══╗
      ║ B ║══════════║ B ║══════════║ B ║══════════║ B ║═[DONE]
      ╚═══╝          ╚═══╝          ╚═══╝          ╚═══╝
      ╔═══╗          ╔═══╗          ╔═══╗          ╔═══╗
      ║ D ║══════════║ D ║═══[DONE] ║   ║          ║   ║
      ╚═══╝          ╚═══╝          ╚═══╝          ╚═══╝

F = Frontend Agent   B = Backend Agent   D = Design Agent
```

### 2. Safe Integration (Test Before Main Merge)
```
┌───────────────────────────────────────────────────────────┐
│ Integration Branch (feat/notifications)                    │
│                                                             │
│ ✓ All agent code merged here first                         │
│ ✓ CI runs on the combined code                             │
│ ✓ E2E tests validate the complete feature                  │
│ ✓ Master-agent reviews the integrated result               │
│                                                             │
│ If something breaks → fix in integration branch            │
│ Main stays clean ✓                                         │
└───────────────────────────────────────────────────────────┘
                              │
                              │ Only merge when everything works
                              ▼
                    ┌─────────────────┐
                    │   main branch    │
                    │ Always deployable│
                    └─────────────────┘
```

### 3. Clear Ownership & Review Flow
```
┌──────────────┐
│ Master-Agent │  ← Orchestrates everything
└──────┬───────┘
       │
       │ Creates Issue #X
       │ Creates integration branch
       │ Creates agent branches
       │ Opens all Draft PRs
       │
       ├─────────────┬──────────────┬────────────────┐
       ▼             ▼              ▼                ▼
┌──────────┐  ┌──────────┐  ┌──────────┐    ┌──────────┐
│ Frontend │  │ Backend  │  │ UI Design│    │ QA Agent │
│  Agent   │  │  Agent   │  │  Agent   │    │          │
└────┬─────┘  └────┬─────┘  └────┬─────┘    └────┬─────┘
     │             │              │                │
     │ Works on    │ Works on     │ Works on       │ Runs E2E
     │ PR #101     │ PR #102      │ PR #103        │ tests on
     │             │              │                │ integration
     │             │              │                │ branch
     ▼             ▼              ▼                │
     └─────────────┴──────────────┴────────────────┘
                   │
                   │ All merge to integration first
                   ▼
          ┌─────────────────┐
          │  Integration     │
          │     Branch       │
          │  CI ✓  E2E ✓     │
          └────────┬─────────┘
                   │
                   │ Master-agent final review
                   ▼
          ┌─────────────────┐
          │   main branch    │
          └─────────────────┘
```

---

## Real GitHub Network Graph Appearance

When viewing this in GitHub's network graph (Insights → Network), you would see:

```
* ─────●────── main (deployable)
│       │
│       └──●──●──●──● feat/notifications (integration)
│          │  │  │  │
│          │  │  │  └──●──● feat/notifications-frontend (PR #101)
│          │  │  │
│          │  │  └──●──●──● feat/notifications-backend (PR #102)
│          │  │
│          │  └──●──● feat/notifications-design (PR #103)
│          │
│          └── All merge back to integration, then to main
│
└─────●────── main (new deployable state)
```

Each vertical line represents a branch, each `●` is a commit, and the converging lines show PR merges.

---

## Comparison: Old vs New Approach

### Old Approach (Direct to Main)
```
main ●────●────●────●────●────●
     │    │    │    │    │    │
     │    └──●─┘    │    │    │  feat/frontend (PR #10)
     │              └──●─┘    │  feat/backend (PR #11)
     │                        └──●─┘  feat/design (PR #12)

❌ Risk: If backend merges before frontend is ready,
         frontend might break on next pull from main
```

### New Approach (Integration Branch)
```
main ●──────────────────────────────●
     │                              │
     └──●──●──●──●──●──●────────────┘  feat/notifications (integration)
        │  │  │  │  │  │
        │  │  │  │  │  └──●──●──●  feat/notifications-design (PR #103)
        │  │  │  │  │
        │  │  │  │  └──●──●──●──●  feat/notifications-backend (PR #102)
        │  │  │  │
        │  │  │  └──●──●──●  feat/notifications-frontend (PR #101)

✓ Benefit: All work merges to integration first
           Only one final merge to main when everything works
```

