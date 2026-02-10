# Copilot Instructions — hAIvemind

> These are standing orders for any Copilot session working on this codebase. Follow them automatically — don't wait to be asked.

---

## Pre-Commit Checklist

Before every `git commit`, run through this list. **Do not commit until all applicable items are done.**

### 1. README Sync
- [ ] **Test count badge** — Update `Tests-XXX_passing` badge to match actual test count (`grep -r "test(" tests/ | wc -l` or run `npm test` and count)
- [ ] **LOC stat** — If code was added/removed significantly, update the "11K+ lines" claim in the hero quote
- [ ] **Features table** — If a new user-facing feature was added, add a one-liner row to the Features table. Keep it to ONE line per feature. No emoji walls.
- [ ] **Architecture diagram** — If modules were added/removed/renamed in `server/routes/`, `server/services/`, or `server/ws/`, update the module counts in the Architecture mermaid diagram and the Server Module Map `<details>` section
- [ ] **Status table** — If a new phase or sub-phase was completed, update the Status table at the bottom. All phases show as complete with a short description.
- [ ] **Keep it short** — README must stay under 200 lines. If an update pushes it over, cut something else.

### 2. Roadmap Sync
- [ ] Mark completed features as ✅ in `docs/roadmap.md`
- [ ] Never leave a shipped feature showing 🔄 or ❌

### 3. Docs Accuracy
- [ ] If server modules changed, verify `docs/project-structure.md` still matches
- [ ] If architecture changed, verify `docs/architecture.md` still matches

### 4. Test Hygiene
- [ ] New features get tests. No exceptions.
- [ ] Run the relevant test file(s) before committing — don't commit blind
- [ ] If test files were added, update the "20 test files" count in README Status section

---

## Style Rules (Always Apply)

### README Style
- **Short and punchy.** No prose paragraphs. Use tables, one-liners, arrows (→).
- **One mermaid diagram per concept.** Flow diagram for the pipeline, sequence diagram for the protocol, architecture diagram for the stack. Don't duplicate.
- **Scannable.** A developer should get the value prop in 10 seconds of scrolling.
- **No emoji dumps.** Max 1 emoji per table row or heading. No emoji-per-feature lists.
- **Badges over words.** If something can be a shield.io badge, make it one.
- **Stats are concrete.** "429 tests" not "comprehensive test suite". "11K lines" not "large codebase".
- **Collapsible details for deep info.** Use `<details>` for module maps, file listings, etc.

### Code Style
- ESM only — no `require()`, no CommonJS
- 2-space indent, single quotes
- Descriptive commit messages with scope: `feat(5.7):`, `fix:`, `docs:`, `refactor:`, `ci:`, `test:`
- One feature per commit. Don't bundle unrelated changes.

### Commit Messages
```
type(scope): short description

- Bullet points explaining what changed
- One bullet per logical change
- Include test count if tests were added
```

### Mermaid Diagrams
- Use emoji labels in nodes for visual scanning: 🧠 🐝 🧪 🔧 💬 🤝
- Style key nodes with fill colors (orchestrator=gold, verify=blue, human=orange, chat=green)
- Keep diagrams under 20 nodes. Simplify, don't exhaustify.
- Use `&` merge syntax where possible to reduce edge clutter

---

## Self-Evolution Protocol

hAIvemind builds itself. This isn't a tagline — it's how the project actually works. Every Copilot session IS the hAIvemind developing itself. Act accordingly.

### Roadmap-Driven Development
- All work comes from `docs/roadmap.md`. Before starting a new feature, check the roadmap for the next uncompleted item.
- Phases are sequential: Foundation → 1 (Reliability) → 2 (Intelligence) → 3 (Extensibility) → 4 (Hardening) → 5 (Autonomy) → 6 (Production) → 7+.
- Sub-phases (e.g. 6.0, 6.1, … 6.8) are completed in order within a phase.
- When a sub-phase ships, mark it ✅ in the roadmap **in the same commit**.
- When all sub-phases of a phase ship, update the README Status table.
- If you finish everything on the roadmap, **propose new phases** with concrete sub-features — don't stop.

### Self-Improvement Mindset
- After completing a feature, look for opportunities: dead code cleanup, test gaps, doc drift, performance wins.
- If a commit reveals a pattern that should be automated, suggest adding it as a roadmap item.
- Prefer refactoring that makes the next feature easier over gold-plating the current one.
- When touching a module, leave it cleaner than you found it (boy scout rule).

### Feature Lifecycle
1. **Pick** — Next uncompleted item from `docs/roadmap.md`
2. **Plan** — If complex, research the codebase first. Identify affected files, risks, approach.
3. **Build** — Implement with tests. One feature per commit.
4. **Verify** — Run relevant test file(s). Fix failures before committing.
5. **Document** — Update README (if user-facing), roadmap (always), architecture docs (if structure changed).
6. **Ship** — Commit with scoped message, push with the push protocol.

### Decomposition Principles
- When a feature touches 3+ files, plan the changes before coding.
- Prefer small, focused modules over monoliths. `server/index.js` is 141 lines of wiring — keep it that way.
- New server capabilities go in `server/routes/`, `server/services/`, or `server/ws/` — not in index.js.
- New client features get their own component or composable. Don't bloat existing files.

### Model Tiering Awareness
- hAIvemind uses `T0 → T0 → T1 → T2 → T3` escalation. Free models first, premium only when needed.
- When writing orchestration logic, respect this pattern. Don't hardcode premium models.
- Cost tracking is a feature, not an afterthought.

### Self-Narrative
Every commit message, README line, and doc update should reinforce:
- **"Built by hAIvemind itself"** — the platform develops its own features
- **Concrete numbers** — test counts, LOC, module counts, phase counts
- **Zero manual code** — maintain this claim by never breaking the chain
- **Progress is visible** — stats in README badges, phases in Status table, features in roadmap

---

## Architecture Principles

These are non-negotiable constraints for the codebase:

| Principle | Rule |
|-----------|------|
| **Thin entry point** | `server/index.js` stays under 200 lines — pure wiring, no logic |
| **Module boundaries** | Routes handle HTTP, services handle business logic, WS handles real-time |
| **Shared state** | Cross-module refs go through `server/state.js`, never globals |
| **Protocol-first** | New message types must be defined in `shared/protocol.js` before use |
| **Client composables** | Reusable logic lives in `client/src/composables/`, not in components |
| **Test isolation** | Each test file is self-contained — no shared state between test files |
| **Git worktree safety** | Self-dev sessions use isolated worktrees, never the main working tree |

---

## Push Protocol

Always push with this pattern (cleans up stale tags):
```powershell
git tag -l "haivemind/*" | ForEach-Object { git tag -d $_ } | Out-Null; git push https://github.com/MrUnreal/hAIvemind.git master 2>&1
```

---

## CI Policy

- CI workflow (`.github/workflows/ci.yml`) is **manual dispatch only** (`workflow_dispatch`)
- Do NOT add `push` or `pull_request` triggers — tests are long and burn billing
- Tests are run on-demand via GitHub Actions → Run workflow

---

## Quick Reference

| What | Where |
|------|-------|
| Server entry | `server/index.js` (141 lines, thin wiring) |
| Routes | `server/routes/` (7 modules) |
| Services | `server/services/` (4 modules) |
| WebSocket | `server/ws/` (3 modules) |
| Shared state | `server/state.js` |
| Client entry | `client/src/App.vue` |
| Tests | `tests/` (20 files, 429 tests, Playwright) |
| Roadmap | `docs/roadmap.md` |
| Architecture | `docs/architecture.md` |
| Definition of Done | `docs/definition-of-done.md` |
