# Definition of Done

> Standards every feature must meet before it can be considered complete. These rules apply to both human-initiated and self-developed features.

## Acceptance Criteria

A feature is **done** when all of the following are true:

### 1. Code Quality
- [ ] No syntax errors — `node --check` passes on all modified `.js` files
- [ ] No import/export mismatches between modules
- [ ] ESM-only — no `require()`, no CommonJS
- [ ] Consistent style with the rest of the codebase (2-space indent, single quotes)

### 2. Functionality
- [ ] The feature works as described in its prompt/spec
- [ ] Server starts without errors (`node server/index.js`)
- [ ] Client builds without errors (`cd client && npx vite build`)
- [ ] No regressions — existing features still work

### 3. Verification
- [ ] Passes the orchestrator's verify step (test-driven verification)
- [ ] All follow-up fix tasks (if any) are resolved within 3 verify-fix rounds
- [ ] Server-side changes: endpoint responds correctly (manual or automated test)
- [ ] Client-side changes: component renders without console errors

### 4. Integration
- [ ] New WebSocket message types added to `shared/protocol.js`
- [ ] New REST endpoints documented in code comments
- [ ] New components imported and wired in parent components
- [ ] New server modules imported in `server/index.js`

### 5. Documentation
- [ ] Feature listed in README features section (if user-facing)
- [ ] Roadmap updated (moved from Planned → Completed in `docs/roadmap.md`)
- [ ] Complex logic has inline comments explaining intent

---

## Self-Development Rules

When hAIvemind develops its own features:

### Planning Phase
1. **Planner mode required** — Every self-dev feature starts with T3 research (`usePlanner: true`)
2. **Planner can reject** — If recommendation is `defer` or `redesign`, stop and report why
3. **Scope control** — Each self-dev session targets ONE feature. No bundling.

### Execution Phase
4. **Agents get full context** — `--add-dir` points to the repo root so agents can see existing code
5. **Parallel by default** — Independent tasks must not have artificial dependencies
6. **Retry & escalate** — Failed agents retry with model escalation (T0 → T0 → T1 → T2 → T3)

### Verification Phase
7. **Test-driven** — Verifier must attempt `node --check` on all changed files at minimum
8. **3 rounds max** — Verify-fix loop runs up to 3 rounds, then reports remaining issues
9. **No silent failures** — Every issue must be logged and reported to the client

### Post-Completion
10. **Git commit** — All changes committed with a descriptive message
11. **Roadmap update** — Feature moved from Planned to Completed in `docs/roadmap.md`
12. **Self-test** — After committing, the server should start cleanly and the client should build

---

## Quality Tiers

Not every task needs the same rigor. Quality expectations scale with impact:

| Tier | Scope | Testing | Review |
|------|-------|---------|--------|
| **Critical** | Core orchestration, agent spawning, WebSocket protocol | Full verification + manual smoke test | Human review before merge |
| **Standard** | New features, UI components, REST endpoints | Automated verify-fix loop | Auto-merge if verification passes |
| **Minor** | Config changes, docs, templates, style fixes | Syntax check only | Auto-merge |

---

## Self-Reflection

After each self-development session, the orchestrator should capture:

1. **What worked** — Which tasks completed on first try, which models sufficed
2. **What failed** — Which tasks needed retries, what issues verification caught
3. **Time profile** — Planning time vs. execution time vs. verification time
4. **Cost profile** — How many premium model calls were needed
5. **Lessons** — Patterns to avoid, prompt improvements, decomposition strategies

This data feeds into persistent skills and improves future self-development sessions.
