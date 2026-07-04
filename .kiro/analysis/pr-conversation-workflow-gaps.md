# PR Conversation Workflow — Gap Analysis

## Current State vs. Desired State

### Current Workflow (Valentin Project)
**Problem**: PRs are mostly one-way communication
1. Agent creates PR
2. Agent comments "Ready for Review"
3. Master-agent posts single review comment (with ✅/⚠️/❌ items)
4. PR gets merged immediately (no back-and-forth)

**Result**: No iterative discussion, no agent responses to feedback, no learning loop

### Desired Workflow (Next Project)
**Goal**: Full conversational PR review until merge or close
1. Agent creates PR → comments "Ready for Review"
2. Master-agent posts review with blocking ❌ issues
3. **Agent responds** to each ❌ item (explains, clarifies, or commits fix)
4. Master-agent reviews new commits, posts follow-up feedback
5. **Multi-round conversation** continues until all blockers resolved
6. Final approval → merge

---

## GitHub MCP Server Capabilities

Based on the available tools in Kiro, here's what's **supported**:

### ✅ Supported (Already Available)

| Capability | Tool | Usage |
|------------|------|-------|
| Create Issue | `mcp_github_create_issue` | Planning phase |
| List Issues | `mcp_github_list_issues` | Check for related work |
| Get Issue Details | `mcp_github_get_issue` | Read planning thread |
| Comment on Issue | `mcp_github_add_issue_comment` | Spec discussion |
| Create Branch | `mcp_github_create_branch` | Start feature work |
| Create PR | `mcp_github_create_pull_request` | Open Draft PR |
| Get PR Details | `mcp_github_get_pull_request` | Read PR state |
| List PRs | `mcp_github_list_pull_requests` | Find open PRs |
| **Comment on PR** | `mcp_github_add_issue_comment` | **Add general PR comments** |
| Get PR Files | `mcp_github_get_pull_request_files` | See changed files |
| Get PR Reviews | `mcp_github_get_pull_request_reviews` | Check review status |
| Get PR Comments | `mcp_github_get_pull_request_comments` | Read review thread |
| **Create Review** | `mcp_github_create_pull_request_review` | **Post line-specific feedback** |
| Merge PR | `mcp_github_merge_pull_request` | Final merge |
| Update PR Branch | `mcp_github_update_pull_request_branch` | Sync with main |

### ❌ Missing / Limitations

| Capability | Status | Workaround |
|------------|--------|------------|
| Reply to specific review comment | ❌ Not directly supported | Use `add_issue_comment` with reference to comment ID |
| Edit existing comment | ❌ Not available | Post new comment, clarify "updating previous comment" |
| Request changes review | ✅ Supported via `create_pull_request_review` with `event: "REQUEST_CHANGES"` | Already available |
| Approve PR | ✅ Supported via `create_pull_request_review` with `event: "APPROVE"` | Already available |
| Dismiss review | ❌ Not available | Not critical — just post new review |
| Add reviewers | ❌ Not directly shown | May need manual assignment |
| Mark conversation as resolved | ❌ Not available | Use comment like "✅ Resolved: [explanation]" |

---

## What's Needed for Conversational PRs

### 1. Agent PR Monitoring Loop

**Current Gap**: Agents don't monitor their PRs after "Ready for Review"

**Solution**: Add to each agent's prompt:

```markdown
## PR Monitoring Protocol

After commenting "Ready for Review", you MUST:

1. Wait for master-agent's review (use `mcp_github_get_pull_request_comments`)
2. When master-agent posts ❌ blocking issues:
   - For each ❌ item, reply with:
     - Acknowledgment ("Good catch")
     - Explanation of approach OR commit that fixes it
     - Reference commit SHA if you pushed a fix
3. Push fixes, comment "@master-agent — Ready for re-review" with summary
4. Repeat steps 1-3 until master-agent approves
5. Do NOT close or merge your own PR

### Comment Format for Responding to Feedback

**🔧 Backend Dev** — Response to Review

@master-agent Thanks for the review!

❌ Input validation missing on /api/session endpoint
→ Fixed in commit abc1234 — added Zod schema validation

❌ Error logs leak internal stack traces
→ Fixed in commit def5678 — wrapped errors, return generic messages

⚠️ Consider adding rate limiting
→ Acknowledged — added TODO(yellow) for follow-up PR

Ready for re-review.
```

### 2. Master-Agent Review Loop

**Current Gap**: Master-agent reviews once, then merges

**Solution**: Update master-agent prompt:

```markdown
## Iterative Review Protocol

After posting your initial review:

1. Monitor PR for agent responses (check daily or when notified)
2. Read agent's response comments
3. If agent pushed fixes:
   - Pull latest commits
   - Re-review the specific files mentioned
   - Post follow-up review (APPROVE or REQUEST_CHANGES)
4. Repeat until all ❌ items resolved
5. Final approval → merge

### Follow-Up Review Format

**👔 Master Agent** — Re-Review (Round 2)

@backend-dev Thanks for the quick fixes!

✅ Input validation looks good — Zod schemas cover all cases
✅ Error handling cleaned up
⚠️ One more thing: rate limiting TODO is fine for follow-up

Approved! Merging now.
```

### 3. Workflow Steering File Updates

**File**: `.kiro/steering/git-workflow.md`

**Updates Needed**:

```markdown
### Phase 3: Build & Review (Pull Request) — UPDATED

The PR is the "room" where coding and code review happen.

8. **Agents** work on their branches, pushing micro-commits incrementally
9. **Agents** comment "Ready for Review" on their PR when done
10. **Master-agent** posts review with line-specific feedback (APPROVE, REQUEST_CHANGES, or COMMENT)
11. **[NEW] If REQUEST_CHANGES**: Agent must respond to each ❌ blocking issue
    - Agent replies to review comments explaining approach OR commits fixes
    - Agent pushes new commits to address feedback
    - Agent comments "@master-agent — Ready for re-review" with summary
12. **[NEW] Master-agent re-reviews** new commits and agent responses
    - Posts follow-up review (may still REQUEST_CHANGES or APPROVE)
13. **[NEW] Repeat steps 11-12** until master-agent posts APPROVE review
14. **QA-agent** runs E2E tests against the branch and posts results on the PR (if applicable)
15. Agents push fixes until all ❌ blocking issues are resolved

### PR State Transitions

Draft PR → Ready for Review → REQUEST_CHANGES ↔ Re-review → APPROVE → Merge
                                     ↑__________________|
                                   (agent fixes + responds)
```

### 4. CI Integration Enhancements

**Current**: CI runs, master-agent checks status before merge

**Enhancement**: Add CI failure response protocol

```markdown
## CI Failure Protocol

When CI fails on your PR:

1. Read the CI logs (GitHub Actions tab)
2. Fix the failure (lint, test, or build issue)
3. Push the fix
4. Comment on PR: "CI fixed in commit xyz1234 — [describe fix]"
5. Wait for CI to re-run and pass
```

---

## Implementation Checklist

### Phase 1: Agent Prompts (All 5 agents)
- [ ] Add "PR Monitoring Protocol" section
- [ ] Add "Comment Format for Responding to Feedback"
- [ ] Add "CI Failure Protocol"
- [ ] Add instruction: "Check your PR daily until merged or closed"

### Phase 2: Master-Agent Prompt
- [ ] Add "Iterative Review Protocol" section
- [ ] Add "Follow-Up Review Format"
- [ ] Add instruction: "Monitor all open PRs, prioritize those with agent responses"
- [ ] Add decision tree: REQUEST_CHANGES vs. APPROVE vs. COMMENT

### Phase 3: Steering Files
- [ ] Update `git-workflow.md` Phase 3 with iterative review steps
- [ ] Add "PR State Transitions" diagram
- [ ] Add examples of multi-round review conversations

### Phase 4: Testing & Validation
- [ ] Create test scenario: PR with 3 rounds of feedback
- [ ] Verify agents respond correctly to REQUEST_CHANGES
- [ ] Verify master-agent re-reviews and posts follow-ups
- [ ] Verify conversation thread is coherent and professional

---

## Example: Full PR Conversation Flow

### Round 1: Initial Review

**Backend Dev**: "Ready for Review"

**Master Agent**: 
```
👔 Master Agent — Code Review

Good progress on the API endpoints!

✅ Route structure is clean
❌ Missing input validation on POST /api/preferences
❌ Error responses leak stack traces
⚠️ Consider adding rate limiting

Overall: 🟡 Yellow — REQUEST_CHANGES
```

### Round 2: Agent Response + Fixes

**Backend Dev**:
```
🔧 Backend Dev — Response to Review

@master-agent Thanks for the review!

❌ Missing input validation → Fixed in abc1234
   Added Zod schemas for all request bodies

❌ Stack traces in errors → Fixed in def5678
   Wrapped all errors, return generic messages to client

⚠️ Rate limiting → Added TODO(yellow) for separate PR
   Current scope is MVP, will tackle in hardening phase

Ready for re-review.
```

### Round 3: Master Re-Review

**Master Agent**:
```
👔 Master Agent — Re-Review (Round 2)

@backend-dev Excellent fixes!

✅ Zod validation covers all inputs
✅ Error handling is safe now
✅ Rate limiting TODO is acceptable

Overall: 🟢 Green — APPROVED
Merging now.
```

---

## Key Differences from Current Workflow

| Aspect | Current | Enhanced |
|--------|---------|----------|
| PR Comments | 2 (agent "ready", master review) | 4+ (multi-round) |
| Master Reviews | 1 (approve immediately) | 2-3+ (iterative) |
| Agent Response | None | Required for each ❌ |
| Conversation | Linear | Back-and-forth |
| Learning | Minimal | Agents see consequences of choices |
| Quality Gate | Binary (pass/fail) | Graduated (improve until ✅) |

---

## GitHub MCP Usage Patterns

### For Agents (After "Ready for Review")

```python
# Daily check for review feedback
pr = mcp_github_get_pull_request(owner, repo, pr_number)
comments = mcp_github_get_pull_request_comments(owner, repo, pr_number)

# Filter for master-agent reviews with REQUEST_CHANGES
blocking_reviews = [r for r in comments if r.author == "master-agent" and "❌" in r.body]

if blocking_reviews:
    # Read each ❌ item, fix, and respond
    for issue in extract_blocking_issues(blocking_reviews[-1]):
        # Fix code, push commit
        # Then reply
        mcp_github_add_issue_comment(
            owner, repo, pr_number,
            f"❌ {issue.title} → Fixed in commit {sha}\n{explanation}"
        )
```

### For Master-Agent (Monitoring PRs)

```python
# Check all open PRs for agent responses
prs = mcp_github_list_pull_requests(owner, repo, state="open")

for pr in prs:
    comments = mcp_github_get_pull_request_comments(owner, repo, pr.number)
    
    # Find agent's "Ready for re-review" comment
    if any("Ready for re-review" in c.body for c in comments):
        # Re-review the PR
        files = mcp_github_get_pull_request_files(owner, repo, pr.number)
        # Read changed files, assess fixes
        
        # Post follow-up review
        mcp_github_create_pull_request_review(
            owner, repo, pr.number,
            body="Re-review feedback...",
            event="APPROVE"  # or "REQUEST_CHANGES"
        )
```

---

## Recommendations

### Start Small
1. Implement for 1 agent (backend-dev) first
2. Run a test feature with 2-3 review rounds
3. Refine the conversation templates
4. Roll out to all agents

### Conversation Quality
- Agents should acknowledge feedback genuinely ("Good catch", "You're right")
- Master-agent should recognize effort ("Thanks for the quick fix")
- Keep it professional but warm (team vibe, not robotic)

### Tooling Enhancements (Optional Future Work)
- Build a PR monitoring dashboard (tracks review state per PR)
- Add GitHub webhook to notify agents of new reviews (push vs. pull)
- Create PR conversation templates (fill-in-the-blank responses)

---

## Success Metrics

How to know the conversational workflow is working:

1. **Average PR Comments**: Should increase from 2-3 to 6-10+
2. **Review Rounds**: Should see 2-3 rounds per PR (not just 1)
3. **Agent Learning**: Agents stop repeating same mistakes across PRs
4. **Code Quality**: Fewer bugs escape to main (caught in PR review)
5. **Conversation Quality**: Natural back-and-forth, not scripted

---

**Conclusion**: Your GitHub MCP tooling is **90% ready** for conversational PRs. The main gap is in **agent behavior**, not tooling. Agents need explicit instructions to monitor PRs and respond to feedback iteratively. Update agent prompts and git-workflow.md, and you'll have full PR conversations.
