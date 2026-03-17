# Root Cause Analysis: `diffWords` Misalignment Bug

**Issue:** edgar-diff-zkkk / GitHub #75
**Date:** 2026-03-16
**Status:** Root cause confirmed via reproduction tests

## Bug Summary

`diffWords()` from the `diff` npm package (v8.0.3) produces suboptimal word-level alignments for modified paragraphs, causing the old panel to appear as a solid wall of red (86-88% removed) and the new panel to show false "added" highlights on 37-43% of words that already existed in the old text.

## Reproduction Steps

1. Run the reproduction test:
   ```bash
   cd libs/edgar-diff-lib
   npx vitest run tests/unit/diff/word-diff-misalignment.repro.test.ts
   ```
2. Observe: 9 quality-target tests FAIL, 6 [BROKEN] behavior-documenting tests PASS (3 for removedCoverage >80%, 3 for falseAddedRate >30%), and 3 [BROKEN] tests for unchangedRatio <10% also FAIL (actual is 11-14%, not <10%).

## Expected vs Actual Behavior

- **Expected**: Modified paragraphs show targeted word-level insertions and deletions. Shared phrases like "government investigations", "the Company", "indemnified third party" remain unhighlighted. The old panel shows surgical removals, not a wall of red.
- **Actual**: Nearly all old text is marked as removed. New text has spurious "added" highlights on common words. The diff is visually indistinguishable from a full paragraph replacement, defeating the purpose of word-level diffing.

## Root Cause

**`diffWords()` uses a sequential LCS (Myers diff) algorithm that processes word tokens left-to-right.** When paragraphs have significant structural changes — reordered sentences, mid-sentence insertions, or substantial rewording — the algorithm "loses sync" early and cascades into alternating remove/add chunks with only tiny common fragments found.

### Detailed Code Trace

1. **Entry point**: `pairRemovedAdded()` at `paragraph-differ.ts:102-133` pairs adjacent `removed`+`added` paragraphs as `modified` and calls `computeWordChanges(oldText, newText)` at line 120.

2. **`computeWordChanges()`** at `paragraph-differ.ts:19-40` calls `diffWords(oldText, newText)` (line 20) from the `diff` npm package v8.0.3. The `diff` library:
   - Tokenizes text by splitting on word boundaries (whitespace, punctuation)
   - Runs Myers diff algorithm on the resulting token array
   - Returns `Change[]` with `added`, `removed`, and unchanged spans

3. **The alignment problem**: For structurally different paragraphs, the sequential LCS finds only tiny common tokens (articles, prepositions, punctuation). Example from Case 1 (litigation paragraph):
   - 20 unchanged chunks found, but mostly fragments: `"The "`, `"Company "`, `", "`, `" and "`, `" that "`, `" in "`, `" of "`
   - Largest meaningful matches: `"in the future"` (14 chars), `", the Company "` (14 chars), `" the Company"` (12 chars)
   - Total unchanged: 121 chars out of 888 (13.6%) — when word overlap between the texts is 38-54%
   - Phrases like "government investigations", "indemnified third party" exist in both texts but the LCS alignment path misses them

4. **The `WordChange[]` array** carries these poor offsets through to:
   - `ParagraphDiff.wordChanges` in the diff output
   - `applyHighlightsToSection()` in `highlight-injector.ts:250-304` which filters by side and calls `injectWordHighlights()` to wrap text in `<del>`/`<ins>` elements
   - The UI renders the old panel as nearly all `<del>` (red strikethrough) and the new panel with scattered `<ins>` tags on words that already existed

### Why the LCS Algorithm Fails Here

The Myers diff algorithm finds the **longest common subsequence** scanning left-to-right. This works well for minor edits (a few words changed) but fails for structural rewrites because:

1. **Early desynchronization**: When the first few words differ, the algorithm's alignment point shifts, causing it to miss downstream matches that a human would easily spot.
2. **Greedy token matching**: Small common tokens (articles, prepositions) get matched at the wrong positions, consuming alignment slots that should anchor larger shared phrases.
3. **No backtracking for better overall alignment**: Once a match is consumed, it can't be reconsidered even if a later position would yield a better global alignment.

## Evidence

### Measured Metrics (from reproduction test)

| Metric | Case 1 (Litigation) | Case 2 (Security) | Case 3 (Competition) |
|--------|--------------------|--------------------|---------------------|
| removedCoverage | 86.4% | 86.3% | 88.4% |
| falseAddedRate | 43.0% | 41.2%* | 36.6% |
| unchangedRatio | 13.6% | 13.7% | 11.6% |
| Word overlap (actual) | ~38-54% | ~38-54% | ~38-54% |

*All three cases have removedCoverage >80% and falseAddedRate >30%, confirming the pattern.

### Raw `diffWords` Output (Case 1 — abbreviated)

```
[ ] "The "                    (4 chars)
[-] "outcome of litigation…"  (131 chars)  ← entire first clause removed
[ ] "Company "                (8 chars)   ← finds 1 word
[-] "or an indemnified…"      (95 chars)  ← misses "indemnified third party"
[+] "is subject to…"          (28 chars)
[ ] ", "                      (2 chars)
[-] "the Company's results…"  (35 chars)
[+] "legal proceedings"       (17 chars)
[ ] " and "                   (5 chars)
[-] "financial condition…"    (23 chars)
[+] "government invest…"      (25 chars)  ← "govt investigations" marked as ADDED
[ ] " that "                  (6 chars)
... 20+ more alternating [-]/[+] with tiny [ ] fragments ...
```

Note: "government investigations" appears in BOTH texts but is marked as removed from old and added to new — the algorithm never found it as a common match.

## Affected Area

- **Primary**: `libs/edgar-diff-lib/src/diff/paragraph-differ.ts` — `computeWordChanges()` function (lines 19-40)
- **Downstream (read-only, no changes needed)**: `apps/web/src/lib/highlight-injector.ts` — renders the broken word changes
- **Scope**: All `modified` and `moved` (with text changes) paragraph diffs across any filing comparison

## Recommended Fix

### Option 1: Threshold-based fallback to paragraph-level diff (Least invasive)

If `removedCoverage > threshold` (e.g., 70%), discard the word-level diff and return an empty `WordChange[]` array, causing the paragraph to render as a full paragraph-level `added`/`removed` pair. This is honest — the paragraphs ARE substantially different, and showing no word-level highlights is better than showing misleading ones.

**Pros**: ~5 lines of code, zero dependency changes, no risk of regression in good diffs
**Cons**: Loses word-level detail for cases where a better algorithm could find it

### Option 2: Better diff algorithm (Most impactful)

Replace `diffWords` with an algorithm that handles structural rewrites better:
- **`diff-match-patch`** (Google's library): Uses a character-level diff with semantic cleanup pass that groups changes into meaningful chunks. Better at finding matches when text is reordered.
- **Two-pass approach**: First diff at sentence level to establish anchor points, then diff words within matched sentences.
- **Token-based with reordering**: Identify shared multi-word phrases first, anchor them, then diff the gaps.

**Pros**: Best quality outcome, handles all rewrite patterns
**Cons**: More code, new dependency or significant implementation effort

### Option 3: Post-processing quality gate (Middle ground)

Run `diffWords` as-is, then measure `removedCoverage`. If above threshold, either:
- Fall back to paragraph-level (same as Option 1)
- Re-run with a different algorithm (combine with Option 2)

**Pros**: Preserves good diffs from `diffWords`, only triggers alternative path for bad ones
**Cons**: Slightly more complex, two code paths to maintain

### Recommendation

**Start with Option 1** (threshold fallback) as an immediate quality improvement — it's safe, simple, and eliminates the worst visual artifacts. Then implement **Option 2** as a follow-up for higher-quality word-level diffs on rewritten paragraphs.

The threshold should be calibrated against the reproduction test cases:
- Current broken: 86-88% removed coverage
- A threshold of 70% would catch all three cases
- Quality target tests define the bar: <70% removedCoverage, <20% falseAddedRate, >15% unchangedRatio

## Risk Assessment

- **Scope of fix**: Option 1 touches only `computeWordChanges()` in `paragraph-differ.ts` (~5 lines). Option 2 would also touch `paragraph-differ.ts` but more extensively.
- **Regression risk**: Low for Option 1 — paragraphs with good word-level diffs won't be affected (their removedCoverage is well below 70%). Option 2 has moderate risk as it changes the diff algorithm.
- **Related issues**: The same `diffWords` call is used for `moved` paragraphs with text changes (line 269 in `detectMoves`). Any fix to `computeWordChanges` will also improve moved-paragraph diffs.
- **Testing**: The reproduction test provides concrete pass/fail criteria. Existing tests in `paragraph-differ.test.ts` and `diff-engine.test.ts` cover the happy path and should be verified after any fix.
