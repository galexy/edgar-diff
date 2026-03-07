# edgar-diff-lib

SEC Filing Diff Library — core library for fetching, parsing, and diffing SEC EDGAR filings.

## Test Tiers

This library has three test tiers with different run conditions:

### 1. Unit + Integration + E2E (fixture-based) — DEFAULT
```bash
npx vitest run
```
- **When to run**: Every code change. This is the inner dev/test loop.
- **What it covers**: Unit tests, integration tests against committed fixture files, fixture-based e2e pipeline tests.
- **Network**: None. All tests use local fixtures or mocks.
- **Speed**: ~25 seconds.

### 2. Live E2E — BEFORE COMPLETION
```bash
npx vitest run --config vitest.live.config.ts
```
- **When to run**: Before claiming a story is done. Before creating a PR. After final fixes.
- **What it covers**: Real HTTP requests to SEC EDGAR (`efts.sec.gov`, `www.sec.gov`). Fetches real filings, parses them, validates output end-to-end.
- **Network**: Required. Hits real SEC EDGAR APIs.
- **Speed**: ~30-60 seconds (network-dependent).
- **Do NOT run** during the normal edit-test cycle — saves time and avoids unnecessary EDGAR traffic.

### 3. Acceptance (Property-Based) — CI / EVERY CHANGE
```bash
npx vitest run tests/acceptance/
```
- **When to run**: Every change / CI. These are the BDD acceptance tests.
- **What it covers**: Property-based tests implementing BDD acceptance criteria from the test plan. Uses randomly generated HTML structures to verify structural invariants.

## Key Commands

```bash
# Default test run (unit + integration + fixture e2e)
npx vitest run

# Live e2e (hits real EDGAR)
npx vitest run --config vitest.live.config.ts

# Type check
npx tsc --noEmit

# Single test file
npx vitest run tests/unit/parser.test.ts
```

## Module Boundaries

- `client/` — No dependency on `parser/` or `diff/`
- `parser/` — Imports only from `client/types`
- `diff/` — Imports only from `parser/types` (future)
- `src/index.ts` — Sole public surface
