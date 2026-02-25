# Contributing to hAIvemind

> hAIvemind builds itself — but contributions are welcome.

## Quick Start

```bash
git clone git@github.com:MrUnreal/hAIvemind.git && cd hAIvemind
npm install                    # installs server + client deps
cp .env.example .env           # configure environment
npm run dev                    # http://localhost:5173
```

## Development

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start server + client (hot-reload) |
| `npm run dev:mock` | Demo mode — no Copilot CLI needed |
| `npm test` | Run all Playwright tests |
| `npm run build:client` | Production client build |

## Code Style

- **ESM only** — `import`/`export`, never `require()`
- **2-space indent**, single quotes
- Server logic goes in `server/services/`, HTTP in `server/routes/`
- Client composables in `client/src/composables/`, components in `client/src/components/`
- New WebSocket message types must be defined in `shared/protocol.js` first

## Commit Messages

```
type(scope): short description

- Bullet points for each change
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`

## Testing

- Every new feature needs tests
- Test files go in `tests/` as `*.spec.js`
- Run relevant test file before committing: `npx playwright test tests/your-file.spec.js`
- Framework: [Playwright Test](https://playwright.dev/docs/test-intro)

## Architecture Rules

| Rule | Details |
|------|---------|
| Thin entry point | `server/index.js` stays under 200 lines — wiring only |
| Module boundaries | Routes = HTTP, Services = logic, WS = real-time |
| Shared state | Cross-module refs via `server/state.js`, no globals |
| Protocol-first | Define message types in `shared/protocol.js` before use |
| Test isolation | Each test file is self-contained — no shared state |

## Filing Issues

- **Bugs**: Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template
- **Features**: Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template
- Include environment info, logs, and reproduction steps

## Pull Requests

1. Fork the repo and create a branch from `master`
2. Make your changes (one feature per PR)
3. Add tests
4. Ensure all tests pass
5. Submit a PR using the [PR template](.github/pull_request_template.md)

## Project Layout

See [docs/project-structure.md](docs/project-structure.md) for a full file-by-file reference.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
