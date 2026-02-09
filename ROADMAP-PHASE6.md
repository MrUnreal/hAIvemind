# Phase 6 Roadmap — hAIvemind

## Overview
Phase 5 (9 features) delivered: graceful shutdown, output summaries, workspace rollback, CLI mode, autopilot, distribution, dead code cleanup, plugin system, and backend/swarm REST. Phase 6 focuses on **production readiness, frontend completeness, and scalability**.

---

## 6.0 — Playwright Auto-Server & CI Pipeline (S)
Add `webServer` config to `playwright.config.js` to auto-start Express + Vite, GitHub Actions CI workflow, `npm test` script, and shared test fixture. Eliminates manual server management in tests.

## 6.1 — Environment Configuration & Structured Logging (M)
Add dotenv, structured logger (levels, timestamps, JSON mode), `.env.example`, CORS middleware. Make all config overridable via env vars or `.haivemind.config.json`.

## 6.2 — Template Gallery & Builder UI (S)
Template gallery dropdown in PromptInput, preview with variable forms, `POST /api/templates` endpoint for template creation. Currently templates exist on disk but have no UI.

## 6.3 — Real-Time Agent Output Streaming (M)
Implement throttled `AGENT_STREAM` emission (defined but never used), progressive terminal-style rendering in AgentDetail.vue, output search/filter, raw/summary toggle.

## 6.4 — Session Diff Viewer & Workspace Intelligence UI (M)
DiffViewer.vue for session diffs (endpoint exists, no UI), WorkspaceOverview.vue showing analysis data (tech stack, file tree). Preview changes before rollback.

## 6.5 — Plugin & Backend Management UI (M)
Plugins tab in SettingsPanel with enable/disable/reload toggles, Backends tab with active selection, per-backend config editing, swarm toggle with runner list.

## 6.6 — Autopilot Web UI (L)
REST endpoint `POST /api/projects/:slug/autopilot`, new protocol messages, AutopilotPanel.vue with cycle history, reasoning display, cost tracking, and stop button.

## 6.7 — Scoped WebSocket Channels & Session Persistence (L)
Per-project WebSocket subscriptions, periodic session state checkpointing for crash recovery, reduces unnecessary cross-project traffic.

## 6.8 — Server Decomposition (L)
Split server/index.js (~1600 LOC monolith) into routes/, services/, ws/ modules. Reduce index.js to ~150 lines of wiring.
