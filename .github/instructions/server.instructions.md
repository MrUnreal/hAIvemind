---
applyTo: "server/**"
---

# Server Code Rules

## Architecture Constraints (Non-Negotiable)

- **`server/index.js`** stays under 200 lines — pure wiring, no logic
- **Routes** (`server/routes/`) handle HTTP only — no business logic
- **Services** (`server/services/`) handle business logic — no HTTP concerns
- **WebSocket** (`server/ws/`) handles real-time — all WS message handling here
- **Shared state** goes through `server/state.js` — never use globals
- **New capabilities** go in `routes/`, `services/`, or `ws/` — not in index.js

## Module Patterns

- ESM only — `import`/`export`, no `require()`
- 2-space indent, single quotes
- New message types must be defined in `shared/protocol.js` before use
- Environment config goes in `server/config.js`
- Prefer small, focused modules — if a file exceeds ~300 lines, consider splitting

## Multi-Agent Engineering (Rules 24-25)

hAIvemind orchestrates multiple AI agents. When working on orchestration code:

- **Typed schemas at boundaries.** Define exact data shapes between orchestrator, agents, and supervisor.
- **Design for failure first.** Every agent call can fail, timeout, or return garbage. Build retry logic and circuit breakers.
- **Validate at boundaries.** Check inputs before passing to agents; don't rely on downstream handling.
- **Log intermediate state.** What each agent received, decided, and produced — without this, debugging multi-agent failures is impossible.
- **Expect retries and partial failures.** Non-deterministic by nature. Design for idempotency.

## Model Tiering

- Escalation pattern: T0 → T0 → T1 → T2 → T3
- Free models first, premium only when needed
- Don't hardcode premium models in orchestration logic
- Cost tracking is a feature

## Key Files

| File | Role |
|------|------|
| `server/index.js` | Entry point — Express wiring only |
| `server/state.js` | Shared state singleton |
| `server/config.js` | Environment configuration |
| `server/orchestrator.js` | Task orchestration |
| `server/agentManager.js` | Agent lifecycle |
| `server/taskRunner.js` | Task execution |
| `server/services/taskSupervisor.js` | Real-time agent monitoring |
| `shared/protocol.js` | Message type definitions |
