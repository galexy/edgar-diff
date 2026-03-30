# Root Cause Analysis: htmlparser2 source-mapping test timeout (edgar-diff-lyb2)

## Bug Summary

The test `all indices within bounds for real 10-K filing` in `htmlparser2-source-mapping.test.ts` times out at 5000ms on CI, requiring a timeout increase to 15000ms. The test parses a 1.5MB AAPL 2024 10-K filing and validates source index bounds for every DOM node.

## Reproduction Steps

1. Run the test: `cd libs/edgar-diff-lib && npx vitest run tests/unit/htmlparser2-source-mapping.test.ts`
2. Observe the `all indices within bounds for real 10-K filing` test takes ~650ms locally
3. On CI (slower CPU), this exceeds the default 5000ms vitest timeout

## Expected vs Actual Behavior

- **Expected**: Test completes within the default 5000ms timeout
- **Actual**: Test exceeds 5000ms on CI; had to increase timeout to 15000ms to pass

## Root Cause

**The bottleneck is ~101,000 vitest `expect()` calls in a tight loop, not parsing or tree traversal.**

The test iterates over all 20,204 DOM nodes and calls 5 `expect()` assertions per node:

```typescript
for (const node of nodes) {
  expect(node.startIndex).toBeGreaterThanOrEqual(0);   // 1
  expect(node.startIndex).toBeLessThanOrEqual(html.length); // 2
  expect(node.endIndex).toBeGreaterThanOrEqual(0);     // 3
  expect(node.endIndex).toBeLessThanOrEqual(html.length);   // 4
  // assertDefined (plain throw, negligible)
  expect(node.startIndex).toBeLessThanOrEqual(node.endIndex); // 5
}
```

This produces **101,020 `expect()` invocations**. Each `expect()` call has fixed overhead: creating matcher objects, tracking assertion state, building potential error messages, and integrating with vitest's test runner. This overhead dominates the test duration.

### Profiling Data (local machine)

| Phase | Time | % of total |
|---|---|---|
| `parseDocument()` (htmlparser2) | 27.4ms | 4.2% |
| `collectNodes()` (tree traversal) | 2.2ms | 0.3% |
| **`expect()` assertion loop** | **615.5ms** | **95.4%** |
| **Total** | **645.1ms** | |

The actual work (parsing 1.5MB HTML + walking 20,204 nodes + checking bounds) takes **~30ms**. The remaining **~616ms** is pure vitest `expect()` overhead.

### Standalone profiling (no vitest)

Running the same parse + collect + boundary check logic as plain JS (no `expect()`) completes in **29.6ms** — a 22x speedup.

### CI scaling

On CI with 3-8x slower CPUs (shared runners, resource contention), the per-`expect()` overhead scales linearly:
- Local: ~6.1us per `expect()` x 101,020 = ~616ms
- CI (3x slower): ~18us per `expect()` x 101,020 = ~1.8s
- CI (8x slower): ~49us per `expect()` x 101,020 = ~5.0s (timeout!)

Additional CI factors that increase overhead: code coverage instrumentation, concurrent test suites, memory pressure.

## Evidence

1. **Profiling instrumentation** added to the test confirmed 95.4% of time in the assertion loop
2. **Standalone Node.js script** performing identical parse + collect + check without `expect()` completes in 29.6ms
3. **Comparison test**: The `parsing is deterministic` test parses the same file twice but only loops `expect()` over 100 nodes (200 calls) — it completes in 38ms
4. **The `multibyte fixture` test** uses the same pattern but on a 1.4KB file (few nodes) — completes in 7ms
5. No application code (`content-extractor.ts`, `section-extractor.ts`) is involved in this test — only `htmlparser2.parseDocument()` and the test's own `collectNodes()` helper

## Affected Area

Only the single test case `all indices within bounds for real 10-K filing` in `libs/edgar-diff-lib/tests/unit/htmlparser2-source-mapping.test.ts` (line 289). No production code is affected.

The `malformed HTML` tests use the same loop-of-expects pattern but on tiny inputs (< 10 nodes), so they're not affected.

## Recommended Fix

Refactor the assertion loop to do bulk validation in plain JS, then assert once on the result:

```typescript
it('all indices within bounds for real 10-K filing', async () => {
  const html = await readFile(join(FIXTURES_DIR, '10k-aapl-2024.html'), 'utf-8');
  const doc = parse(html);
  const nodes = collectNodes(doc);
  expect(nodes.length).toBeGreaterThan(1000);

  // Validate all bounds in a single pass — report first violation if any
  const violation = nodes.find(
    (node) =>
      node.startIndex == null ||
      node.endIndex == null ||
      node.startIndex < 0 ||
      node.startIndex > html.length ||
      node.endIndex < 0 ||
      node.endIndex > html.length ||
      node.startIndex > node.endIndex,
  );
  expect(violation).toBeUndefined();
});
```

This reduces expect() calls from **101,020 to 2**, bringing the test from ~650ms to ~30ms locally and well within the default 5000ms timeout on CI.

If diagnostic output on failure is desired, the violation node can be described in a custom error message:

```typescript
if (violation) {
  const { startIndex, endIndex, type } = violation;
  throw new Error(
    `Bound violation: ${type} node at [${startIndex}, ${endIndex}] (html.length=${html.length})`
  );
}
```

The timeout override (`{ timeout: 15000 }`) can then be removed entirely.

## Risk Assessment

- **Scope of fix**: Single test file, one test case (line 289-302)
- **Regression risk**: Minimal — the test's logical coverage is identical; only the assertion strategy changes. A failing bound would still be caught.
- **Related issues**: The `malformed HTML` tests (line 242-251) use the same loop pattern but on tiny inputs — no action needed. However, the pattern could be normalized for consistency.
