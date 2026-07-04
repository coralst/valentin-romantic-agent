# Agent Branch Visualization Guide

This guide explains how to visually differentiate agent branches and PRs using colors, labels, and naming conventions.

## Agent Color Scheme

Each agent type has a designated color for visual consistency across GitHub labels, documentation, and diagrams:

| Agent | Color | Hex Code | Branch Prefix | Emoji |
|-------|-------|----------|---------------|-------|
| 👔 Master Agent | Purple | `#7B68EE` | `feat/master-` | 👔 |
| 🏗️ System Architect | Orange | `#FF8C00` | `feat/architect-` | 🏗️ |
| ⚛️ Frontend Dev | Blue | `#1E90FF` | `feat/frontend-` | ⚛️ |
| 🔧 Backend Dev | Green | `#32CD32` | `feat/backend-` | 🔧 |
| 🎨 UI Designer | Pink | `#FF69B4` | `feat/design-` | 🎨 |
| 🧪 QA Agent | Red | `#FF4500` | `feat/qa-` | 🧪 |

## 1. GitHub Labels Setup

### Creating Agent Labels

Use these commands to create agent-specific labels in your repository:

```bash
# Using GitHub CLI
gh label create "agent: master" --color "7B68EE" --description "Master Agent work"
gh label create "agent: architect" --color "FF8C00" --description "System Architect work"
gh label create "agent: frontend" --color "1E90FF" --description "Frontend Dev work"
gh label create "agent: backend" --color "32CD32" --description "Backend Dev work"
gh label create "agent: design" --color "FF69B4" --description "UI Designer work"
gh label create "agent: qa" --color "FF4500" --description "QA Agent work"
```

### Applying Labels to PRs

When master-agent creates PRs, automatically apply the corresponding agent label:

```markdown
## PR Creation Checklist
- [ ] Branch name includes agent prefix (e.g., `feat/frontend-chat-panel`)
- [ ] PR has agent label applied (e.g., `agent: frontend`)
- [ ] PR description includes agent emoji and name
```

## 2. Branch Naming Convention

### Format
```
<type>/<agent>-<feature-description>
```

### Examples
```
feat/master-pr-monitoring-coordination
feat/architect-event-driven-architecture
feat/frontend-message-history-component
feat/backend-websocket-gateway
feat/design-dark-mode-tokens
feat/qa-e2e-connection-recovery
```

### Benefits
- Immediately visible in network graph which agent owns each branch
- Sortable and filterable in GitHub branch list
- Machine-readable for automation scripts
- Consistent with existing TBD workflow

## 3. GitHub Network Graph Visualization

The network graph (`Insights → Network`) will show branches color-coded by their labels (if you use GitHub's label colors).

To see the graph with branch names:
```bash
git log --all --decorate --oneline --graph --color
```

Output example:
```
* 2a3b4c5 (origin/feat/frontend-chat-panel) feat(frontend): add MessageBubble component
| * 3c4d5e6 (origin/feat/backend-ws-gateway) feat(backend): implement WebSocket gateway
|/
* 4d5e6f7 (origin/main) docs: update README with agent workflow
```

## 4. PR Description Template

Each PR should include the agent identifier prominently:

```markdown
## 👔 Master Agent — [Feature Name]

**Branch**: feat/master-pr-coordination
**Agent**: Master Agent
**Quality Signal**: 🟢 Green

## Summary
[What this PR does]

## Related
- Resolves #42
- Depends on: feat/architect-spec-approval (#41)
```

## 5. Visual Workflow Diagram

```
main
 │
 ├──► feat/architect-event-system (🏗️ orange)
 │     │
 │     └──► merged to main ✓
 │
 ├──► feat/frontend-chat-panel (⚛️ blue)
 │     │
 │     └──► awaiting review
 │
 ├──► feat/backend-ws-gateway (🔧 green)
 │     │
 │     └──► in progress
 │
 └──► feat/design-tokens (🎨 pink)
       │
       └──► in progress
```

## 6. Using Labels in GitHub Queries

Filter PRs by agent:
```
is:pr label:"agent: frontend"
is:pr label:"agent: backend" is:open
```

Filter issues by agent assignment:
```
is:issue label:"agent: qa" is:open
```

## 7. Automation Script (Optional)

Create a script to auto-apply labels based on branch name:

```bash
#!/bin/bash
# .kiro/scripts/auto-label-pr.sh

BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
AGENT=$(echo "$BRANCH_NAME" | cut -d'/' -f2 | cut -d'-' -f1)

case $AGENT in
  "master") LABEL="agent: master" ;;
  "architect") LABEL="agent: architect" ;;
  "frontend") LABEL="agent: frontend" ;;
  "backend") LABEL="agent: backend" ;;
  "design") LABEL="agent: design" ;;
  "qa") LABEL="agent: qa" ;;
  *) echo "Unknown agent prefix: $AGENT"; exit 1 ;;
esac

# Apply label to the current PR
gh pr edit --add-label "$LABEL"
```

## 8. Hook Integration

Add a hook to automatically apply labels when PRs are created:

```json
{
  "name": "Auto-Label PR by Agent",
  "version": "1.0.0",
  "when": {
    "type": "userTriggered"
  },
  "then": {
    "type": "runCommand",
    "command": ".kiro/scripts/auto-label-pr.sh"
  }
}
```

## 9. Project Board Columns (Optional)

If using GitHub Projects, create columns by agent:

- 👔 Master Agent Review
- 🏗️ Architect Design
- ⚛️ Frontend Dev
- 🔧 Backend Dev
- 🎨 UI Design
- 🧪 QA Testing

## 10. Commit Message Convention

Include agent emoji in commit messages:

```
feat(frontend): ⚛️ add MessageBubble component
fix(backend): 🔧 resolve WebSocket reconnection issue
refactor(design): 🎨 extract color tokens to design system
test(qa): 🧪 add E2E test for connection recovery
```

## Benefits Summary

1. **Visual Clarity**: Instantly recognize which agent owns each branch in network graph
2. **Filtering**: Quickly filter PRs, issues, and branches by agent
3. **Project Tracking**: See agent workload distribution at a glance
4. **Automation**: Scripts can automatically route work based on branch names
5. **Documentation**: Commit history shows agent activity patterns
6. **Onboarding**: New team members immediately understand the agent structure

## Viewing Your Repository with This System

After implementing this:

1. **Network Graph** shows colored branches by agent prefix
2. **PR List** shows agent labels next to each PR title
3. **Branch List** shows agent prefix in branch names
4. **Commit History** shows agent emojis in commit messages
5. **Project Board** shows work organized by agent column
