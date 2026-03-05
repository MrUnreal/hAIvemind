---
applyTo: "shared/**"
---

# Shared Code Rules

## Protocol-First (Architecture Principle)

- **New message types must be defined in `shared/protocol.js` before use.**
- Every WS/event message type gets a constant: `export const MSG = { ... }`
- Name pattern: `DOMAIN_ACTION` → e.g., `SUPERVISOR_ALERT`, `SESSION_COMPLETE`
- Both server and client import from `shared/protocol.js` — single source of truth

## Schema Discipline (Rule 24)

- Protocol messages are agent boundaries — typed schemas at every boundary
- Define the exact shape of data for each message type
- Schema violations are contract failures, not recoverable errors
- Changes to shared protocol affect both server and client — verify both sides

## When Editing Protocol

1. Add the new constant to `shared/protocol.js`
2. Add server handler (in `server/ws/` or `server/routes/`)
3. Add client handler (in `client/src/composables/` or components)
4. Add tests that verify the message flow end-to-end
5. Update `docs/architecture.md` if it's a new message category
