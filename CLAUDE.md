# Claude Code Project Instructions — hAIvemind

@AGENTS.md

## Claude-Specific Notes

- Use `@file` imports in CLAUDE.md to keep rules DRY — AGENTS.md is the canonical source.
- When using skills (`.claude/skills/`), each skill should be a focused, self-contained behavior.
- Prefer `/clear` between unrelated tasks to keep context clean.
- Use subagents for deep investigation that shouldn't pollute the main session context.
- Use the 4-phase workflow: **Explore → Plan → Implement → Commit**.

## hAIvemind Context

- This is a self-building AI coding orchestrator. Every session IS hAIvemind developing itself.
- All work comes from `docs/roadmap.md`. Check it before starting new features.
- ESM only — no `require()`. 2-space indent. Single quotes.
- New message types → `shared/protocol.js` before use.
- Run relevant tests before committing. New features always get tests.
- Push protocol: `git tag -l "haivemind/*" | ForEach-Object { git tag -d $_ } | Out-Null; git push https://github.com/MrUnreal/hAIvemind.git master 2>&1`
- CI is manual dispatch only — do NOT add push/PR triggers.

## Key Locations

| What | Where |
|------|-------|
| Server entry | `server/index.js` (thin wiring, <200 lines) |
| Routes | `server/routes/` |
| Services | `server/services/` |
| WebSocket | `server/ws/` |
| Shared state | `server/state.js` |
| Protocol | `shared/protocol.js` |
| Client | `client/src/App.vue` |
| Tests | `tests/` (Playwright) |
| Full rules | `.github/copilot-instructions.md` |
