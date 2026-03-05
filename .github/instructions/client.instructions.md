---
applyTo: "client/**"
---

# Client Code Rules

## Vue 3 Patterns

- **Composables** for reusable logic — lives in `client/src/composables/`, not in components
- **Components** are single-responsibility — one feature per component
- Don't bloat existing components with unrelated features — create new ones
- Use Vue 3 Composition API (`<script setup>`)

## Code Style

- ESM only — no `require()`
- 2-space indent, single quotes
- Vite for bundling — config in `client/vite.config.js`

## WebSocket Integration

- Client connects to server WS at the configured port
- Message types from `shared/protocol.js` — always check protocol definitions match
- Handle connection drops gracefully — reconnect logic in composables

## Key Structure

| Path | Purpose |
|------|---------|
| `client/src/App.vue` | Application root |
| `client/src/composables/` | Reusable logic (composables) |
| `client/src/components/` | Vue components |
| `client/index.html` | HTML entry |
| `client/vite.config.js` | Build config |
