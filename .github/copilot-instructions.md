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

## Self-Narrative

This project is self-built. Every commit message, README line, and doc update should reinforce:
- **"Built by hAIvemind itself"** — the platform develops its own features
- **Concrete numbers** — test counts, LOC, module counts, phase counts
- **Zero manual code** — maintain this claim by never breaking the chain

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
