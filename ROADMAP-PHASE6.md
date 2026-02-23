# Phase 6 Roadmap — hAIvemind

## Overview
Phase 5 (9 features) delivered: graceful shutdown, output summaries, workspace rollback, CLI mode, autopilot, distribution, dead code cleanup, plugin system, and backend/swarm REST. Phase 6 focuses on **production readiness, frontend completeness, and scalability**.

---

## 6.0 — Playwright Auto-Server & CI Pipeline (S) ✅
Add `webServer` config to `playwright.config.js` to auto-start Express + Vite, GitHub Actions CI workflow, `npm test` script, and shared test fixture. Eliminates manual server management in tests.
**Commit:** `886f79c` — 16 tests

## 6.1 — Environment Configuration & Structured Logging (M) ✅
Added `server/logger.js` (levels, timestamps, colored/JSON modes), `.env.example`, built-in `.env` loader in `config.js`, `env()`/`envInt()`/`envBool()` helpers. All config overridable via `HAIVEMIND_*` env vars. Replaced all 36 `console.*` calls in `server/index.js`.
**Commit:** `8d09c5d` — 24 tests

## 6.2 — Template Gallery & Builder UI (S) ✅
`TemplateGallery.vue` dropdown in PromptInput, template preview with variable forms and stack badges, `/api/project-templates` endpoint for browsing and creating templates from the UI.
**Commit:** `0dfffac` — 16 tests

## 6.3 — Real-Time Agent Output Streaming (M) ✅
Throttled `AGENT_STREAM` emission (150ms batches) in `agentManager.js`, progressive terminal-style rendering in `AgentDetail.vue`, output search/filter with highlight, raw/summary toggle.
**Commit:** `505debb` — 18 tests

## 6.4 — Session Diff Viewer & Workspace Intelligence UI (M) ✅
`DiffViewer.vue` with per-file unified diffs (syntax-highlighted), `WorkspaceOverview.vue` showing tech stack/file tree/conventions, rollback preview before confirming. Enhanced `getSnapshotDiff()` with per-file patches.
**Commit:** `972e50b` — 26 tests

## 6.5 — Plugin & Backend Management UI (M) ✅
Plugins tab in SettingsPanel with enable/disable/reload toggles per plugin. Backends tab with active backend selector, per-backend config, swarm toggle with runner cards and capacity display.
**Commit:** `c5b8169` — 22 tests

## 6.6 — Autopilot Web UI (L) ✅
REST endpoints (`POST /api/projects/:slug/autopilot/start|stop`), Protocol messages (`AUTOPILOT_*`), `AutopilotPanel.vue` with cycle history, reasoning display, cost tracking, start/stop controls. Integrated in App.vue sidebar.
**Commit:** `8a2509c` — 25 tests

## 6.7 — Scoped WebSocket Channels & Session Persistence (L) ✅
Per-project WS subscriptions (`subscribe:project`/`unsubscribe:project`), `broadcastGlobal()` for system-wide messages, `server/checkpoint.js` for periodic session state persistence, crash recovery on startup.
**Commit:** `5bf6341` — 35 tests

## 6.8 — Server Decomposition (L) 🔄
Split `server/index.js` (~1600 LOC monolith) into `routes/`, `services/`, `ws/` modules. Reduce index.js to ~150 lines of wiring. **In progress.**
