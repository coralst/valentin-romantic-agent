<!--
  Title format:  <type>(<scope>): <summary>
  Branch format: <type>/<agent>-<feature>   e.g. feat/backend-demo-seed

  Pick your persona header below, delete the rest, and apply the matching
  `agent: *` label. See docs/METHODOLOGY.md for the full workflow.

  👔 Master Agent      🏗️ System Architect   ⚛️ Frontend Dev
  🔧 Backend Dev       🎨 UI Designer        🧪 QA Agent
-->

## 🔧 Backend Dev — <feature name>

**Agent**: Backend Dev
**Spec**: `.kiro/specs/<spec-name>/`
**Resolves**: #

### Summary

<!-- What this PR does and why. Prose, not a checklist. Name the actual
     files and the trade-offs you made. -->

### Ownership boundary

<!-- Confirm you stayed inside your scope. See docs/METHODOLOGY.md#the-team.
     If you needed a change outside your boundary, say so and name the agent
     who should own it — do not reach across. -->

- [ ] Only modified files within my ownership boundary

### Tests

<!-- What you added or changed, and what it covers. -->

- [ ] Unit / component tests
- [ ] E2E (or: not user-facing)
- [ ] `npm test` passes locally
- [ ] `npm run lint` passes locally

### Domain notes

<!-- Delete the sections that don't apply to your agent. -->

**🔧 Backend** — input validation, auth checks, error handling, no secrets in logs:

**⚛️ Frontend** — ARIA labels, keyboard nav, semantic HTML, loading/error/empty states:

**🎨 Design** — contrast ratios, focus states, reduced-motion, breakpoints tested:

**🧪 QA** — browsers covered, flows validated, a11y checks performed:

**🏗️ Architect** — contracts changed, boundaries affected, migration impact:

### Open questions / `TODO(yellow)`

<!-- Anything deliberately deferred, with a link to the follow-up. -->

---

<!--
  Review loop reminder (docs/METHODOLOGY.md#the-engine-orchestrator-led-not-event-led):
  • Sub-agents: reply in prose, then tag @master-agent to hand the turn back.
    Do NOT approve or merge your own PR.
  • Master: you post the terminal message. The pre-merge-conversation-gate hook
    blocks the merge unless you hold the last word with a valid
    APPROVED-BY-MASTER-AGENT token, no tagged agent is left hanging, and CI is green.
-->
