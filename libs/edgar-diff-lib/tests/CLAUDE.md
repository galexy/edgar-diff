# Test Directory Structure

## Tiers

| Directory | Runs by default | Network | When to run |
|-----------|----------------|---------|-------------|
| `unit/` | Yes | No | Every change |
| `integration/` | Yes | No | Every change |
| `e2e/` | Yes | No | Every change (uses fixtures, not network) |
| `e2e-live/` | **No** | **Yes** | Before claiming done, before PR, after final fixes |
| `acceptance/` | Yes | No | Every change / CI |

## Running live tests

```bash
# From libs/edgar-diff-lib/:
npx vitest run --config vitest.live.config.ts
```

Live tests hit real SEC EDGAR APIs. They verify the full fetch-parse pipeline against real filings. Do not run them in the inner dev/test loop — only when you need to prove the system works end-to-end.

## Fixture conventions

- **Unit tests**: Inline HTML fixtures (< 30 lines) inside test files.
- **Integration tests**: Real filing HTML in `integration/fixtures/`. Ground truth in `meta-10k-{ticker}-{year}.json`.
- **E2E (fixture)**: Use the same fixtures as integration tests via `helpers/ground-truth.ts`.
- **E2E-live**: No fixtures. Fetches directly from EDGAR.

## Test style

- Always import `{ describe, it, expect }` from `vitest` explicitly.
- Use `vitest` globals for `vi.fn()`, `vi.useFakeTimers()`, etc.
- Use `makeRawFiling(html)` from `helpers/ground-truth.ts` to create test `RawFiling` objects.
