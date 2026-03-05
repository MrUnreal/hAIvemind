---
applyTo: "tests/**"
---

# Test Code Rules

## Red/Green TDD (Rule 11)

- **Write tests before implementation** when possible. Confirm they fail first (red).
- Implement until tests pass (green). Minimum code needed.
- Start sessions by running existing tests to orient yourself.

## Test Hygiene

- **New features get tests. No exceptions.**
- Run the relevant test file(s) before committing — don't commit blind
- Each test file is self-contained — no shared state between test files
- Use Playwright test framework (`import { test, expect } from '@playwright/test'`)
- Server starts in `--mock` mode for tests (`node server/index.js --mock`)

## Quality Guards (Rule 18)

- **Watch for verbose/redundant tests.** Don't duplicate test logic — add assertions to existing tests when appropriate.
- **One test, one concern.** Each `test()` block verifies one behavior.
- **Descriptive test names.** Name should document the expected behavior.
- **Test edge cases.** Empty inputs, null values, error paths, boundary conditions.
- **Regression tests.** After fixing a bug, add a test that would have caught it.

## Test Design for Agents (Rule 14)

- Test output should be parseable — put `ERROR` on the same line as the reason
- Tests should be independently runnable: `npx playwright test tests/specific-file.spec.js`
- Keep tests fast — mock external services, avoid real network calls
- Stable selectors and assertions — no flaky tests

## Naming Convention

- Phase-based: `phase{N}-{feature}.spec.js`
- Example: `phase21-supervisor.spec.js`, `phase21-supervisor-integration.spec.js`

## Current Stats

- 78 test files, 1915 tests
- Update README badge when adding tests
