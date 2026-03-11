# Root Cause Analysis: edgar-diff-t9w

## Section aligner fails to match most AAPL 10-K sections between consecutive years

### Symptom

Running `examples/diff-simple.ts` (default: AAPL 2023 vs 2024) produces:
- 20 sections marked as "added"
- 0 sections marked as "removed"
- 3 sections marked as "modified" (Items 1, 1A, 7)
- 0 sections marked as "unchanged"

Expected: most of the 23 standard 10-K sections matched as "modified" or "unchanged", since Apple files the same standard items every year.

### Root Cause

**The integration fixture `10k-aapl-2023.html` is an 835-byte stub, not a real AAPL 2023 10-K filing.**

The stub contains only 3 sections (Items 1, 1A, 7) with one-sentence placeholder content each. The 2024 fixture (`10k-aapl-2024.html`) is a full 1.52MB real filing with all 23 standard 10-K items.

The section aligner correctly matches the 3 sections present in both filings (Items 1, 1A, 7 → "modified"). The remaining 20 sections exist only in the 2024 filing → correctly marked as "added". The aligner is working correctly; **it is the test fixture that is wrong**.

### How the Stub Was Introduced

The stub was created in commit `b996a47` ("fix(tests): resolve unhandled promise rejections in retry tests") as a minimal HTML fixture for **edgar-client integration tests** (HTTP fetch/retry testing). It was never intended to serve as a complete filing for section alignment or diff testing.

The `examples/diff-simple.ts` script was later written to default to `fixturePath('10k-aapl-2023.html')` and `fixturePath('10k-aapl-2024.html')`, not knowing the 2023 fixture was a stub.

### Why It Wasn't Caught

1. **Section alignment integration tests** (`tests/integration/diff/section-alignment.integration.test.ts`) use the **spike fixtures** (`spikes/diff-algorithm/fixtures/apple-fy2023.htm`), not the integration fixtures. Those tests pass with 100% alignment.
2. **No test exercises the integration fixture** `10k-aapl-2023.html` for section alignment.
3. **The example script** is not part of the test suite — it's a demo that was only run manually.

### Verification

Running the example script with the full spike fixtures produces the correct result:
```
added: 0, removed: 0, modified: 20, unchanged: 3, reordered: 0
```

### Recommended Fix

1. **Replace the stub** `10k-aapl-2023.html` with the real AAPL 2023 10-K filing HTML fetched from EDGAR (or copy from the spike fixture `apple-fy2023.htm`).
2. **Add ground truth metadata** `meta-10k-aapl-2023.json` with expected section items.
3. **Add an integration test** that validates the integration fixture `10k-aapl-2023.html` has the expected number of sections (prevents future regression).

### Risk Assessment

- **Low risk**: The fix is a fixture data issue, not a code change.
- **No algorithm changes needed**: The section aligner, parser, and diff engine all work correctly.
- **Related pattern**: Check if other integration fixtures are also stubs (e.g., `10k-tsla-2023.html` was created in the same commit).

### Affected Files

| File | Issue |
|------|-------|
| `libs/edgar-diff-lib/tests/integration/fixtures/10k-aapl-2023.html` | 835-byte stub, not a real filing |
| `libs/edgar-diff-lib/tests/integration/fixtures/10k-tsla-2023.html` | Likely also a stub (created in same commit) |
| `examples/diff-simple.ts` | Uses the stub fixture as default input |
