# Fix Plan: diffWords Misalignment Bug (edgar-diff-zkkk)

## Strategy

**Implement Option 1 from the RCA**: Threshold-based quality gate in `computeWordChanges()`.

After computing word-level diff via `diffWords()`, measure `removedCoverage` (fraction of old text marked as removed). If it exceeds a threshold (70%), discard the word-level diff and return an empty `WordChange[]` — this causes the paragraph to render as a full paragraph-level replacement instead of misleading word-level highlights.

## Files to Change

### `libs/edgar-diff-lib/src/diff/paragraph-differ.ts`
- Modify `computeWordChanges()` (lines 19-40):
  1. After computing `diffWords()` result and building the `WordChange[]` array, calculate `removedCoverage`
  2. If `removedCoverage > 0.70`, return empty array `[]`
  3. Otherwise return the computed word changes as normal

### No other files need changes
- `highlight-injector.ts` already handles empty `wordChanges` arrays (paragraph renders as full add/remove)
- Types don't change — `WordChange[]` can already be empty

## Regression Tests to Write

### Must-fail tests (prove the bug exists before fix):
1. **The 3 AAPL reproduction cases** — quality target assertions from the existing repro test
2. **Threshold boundary test** — a synthetic paragraph pair right at the 70% boundary
3. **Short paragraph edge case** — 2-3 word paragraphs where diffWords works fine (should NOT trigger fallback)
4. **Identical paragraphs** — should produce empty wordChanges (no regression)
5. **Single word change** — minor edit should still produce word-level diff (no regression)

### Corner cases the tester should explore:
- Paragraphs where word order is shuffled but content is the same
- Paragraphs with only whitespace/formatting differences
- Very long paragraphs (1000+ words) with small edits
- Paragraphs where only punctuation differs
- Empty string edge cases
- Paragraphs that share phrases but in different order
- Unicode text with special characters
- Paragraphs where the new text is a subset of the old (or vice versa)

## Order of Operations
1. Tester writes regression tests that FAIL on current code
2. Coder implements the threshold gate
3. Tests must pass after fix
4. All existing tests must still pass
