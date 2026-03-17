# Option 2: Sentence-then-Word Two-Pass Diffing — Test Results

**Tested by**: tester-2
**Date**: 2026-03-16

## Algorithm Summary

**Approach**: Split paragraphs into sentences, match sentences by Jaro-Winkler similarity (>= 0.7), then run `diffWords` within matched pairs. Unmatched sentences become full-span removed/added changes.

**Best-of-both strategy**: Compares two-pass result against direct `diffWords` and picks whichever has lower `removedCoverage`. This guarantees Option 2 **never produces worse results** than baseline.

Quality gate (70% threshold) still applies as a safety net.

## Test Results Summary

| Suite | Tests | Result |
|---|---|---|
| Quality gate regression (word-diff-quality-gate.test.ts) | 26/26 | PASS |
| Paragraph differ (diff-engine.test.ts + paragraph tests) | 23/23 | PASS |
| Option 2 metrics (option2-metrics.test.ts) | 21/21 | PASS |
| All other test suites | 5476/5476 | PASS |
| **Total** | **5546/5546** | **ALL PASS** |

## AAPL Quality Metrics (Complete Rewrites)

These paragraphs are **complete rewrites** — the sentences discuss entirely different topics (word overlap 16-27%), so sentence-level matching cannot help.

| Metric | Case 1 (Litigation) | Case 2 (Security) | Case 3 (Competition) | Target |
|---|---|---|---|---|
| **Raw diffWords removedCoverage** | 86.4% | 86.3% | 88.4% | <70% |
| **Option 2 removedCoverage** | 86.4% | 86.3% | 88.4% | <70% |
| **Quality gate** | TRIGGERED | TRIGGERED | TRIGGERED | — |
| **Word overlap** | 26.7% | 21.9% | 16.4% | — |
| **Best-of-both delta** | 0.0 pp | 0.0 pp | 0.0 pp | — |

**AAPL Verdict**: No improvement over baseline. Quality gate correctly triggers for all 3 cases (paragraph-level fallback). The two-pass approach's best-of-both strategy picks direct `diffWords` because the two-pass actually performs *worse* on these complete rewrites. **This is the correct behavior — Option 2 does no harm.**

**Key question answer**: Does two-pass produce `removedCoverage < 70%` AND `falseAddedRate < 20%` for the AAPL cases? **NO.** These cases need a fundamentally different approach.

## Sentence Reordering (Key Win)

| Scenario | Raw diffWords | Option 2 | Improvement |
|---|---|---|---|
| **3 sentences reordered** | 34.3% removed | **0.0% removed** | **-34.3 pp (perfect)** |
| **4 sentences: 2 reordered + 1 modified** | 38.1% removed | **12.7% removed** | **-25.4 pp** |

**Reordering Verdict**: This is Option 2's primary value. For reordered sentences:
- All sentences matched by JW similarity = 1.0
- Zero false word-level changes
- Without two-pass, raw `diffWords` would show 34% of text as "removed" with misleading highlights

## Edge Case Results

| Test | Description | removedCoverage | Result |
|---|---|---|---|
| E1 | Single-sentence paragraphs | N/A (word diff) | PASS — degrades gracefully to diffWords |
| E2 | No sentence boundaries (no periods) | N/A (word diff) | PASS — treated as single sentence |
| E3 | Abbreviations (U.S., Mr., Dr., $1.2) | 13.3% | PASS — abbreviations don't break sentence splitting |
| E4 | Very short sentences | 34.8% | PASS — sentences matched, word-level diff within |
| E5 | Sentence split into two | 41.9% | PASS — handled reasonably (<50%) |
| E6 | Two sentences merged into one | 18.0% | PASS — most words preserved |
| E7a | Both empty strings | unchanged | PASS |
| E7b | Empty old → non-empty new | handled | PASS |
| E7c | Non-empty old → empty new | handled | PASS |
| E8 | Many abbreviations stress test | 3.4% | PASS — only truly changed words highlighted |
| E9 | Only last sentence changes | 4.7% | PASS — 3 shared sentences untouched |
| E10 | Best-of-both guarantee | ≤ baseline | PASS — never worse across all cases |

### Notable Edge Case Details

- **E3 (abbreviations)**: `splitSentences()` correctly handles `U.S.`, `Mr.`, `Dr.`, `$1.2`, `E.U.` — only splitting at actual sentence boundaries. 13.3% removedCoverage for a paragraph where only 3 small changes were made.

- **E5 (sentence split)**: When one sentence is split into two, the 1:1 greedy matching can only match one of the new sentences. The unmatched sentence contributes to removedCoverage (41.9%). This is a known limitation of the 1:1 matching approach.

- **E8 (abbreviation stress test)**: `Co.`, `Rev.`, `Dr.`, `p.m.`, `U.S.`, `Dept.` all handled correctly. Only 3.4% removedCoverage for 4 small word changes — excellent precision.

- **E9 (last sentence change)**: 4.7% removedCoverage — the 3 identical shared sentences are correctly matched and produce zero word changes. Only the last sentence's word diff contributes to coverage.

## Issues Found

1. **No issues in the implementation itself.** All existing tests pass, all edge cases handled correctly.

2. **Limitation (not a bug)**: Option 2 cannot improve complete paragraph rewrites (AAPL cases). The sentence-level matching correctly fails to find good matches when the topics are completely different.

3. **Limitation (not a bug)**: Many-to-one sentence matching (split/merge) is handled but not optimal — only the best 1:1 match is used, leaving unmatched fragments as full-span changes.

## Overall Assessment

### Is this approach viable?

**YES, as a strict improvement over the baseline.** Option 2:

1. **Never makes things worse** — best-of-both strategy guarantees `removedCoverage(option2) <= removedCoverage(baseline)`
2. **Dramatically improves sentence reordering** — 34.3% → 0.0% removedCoverage
3. **Improves partial modifications** — 38.1% → 12.7% for reorder + modification
4. **Handles all edge cases correctly** — abbreviations, empty strings, single sentences, no-period text
5. **Zero dependency changes** — uses existing `jaro-winkler` and `diff` packages
6. **All 5546 tests pass** — no regressions

### What it doesn't solve

The AAPL-class complete paragraph rewrites still trigger the quality gate (86-88% removedCoverage). These need a fundamentally different algorithm like `diff-match-patch` or token-based matching with reordering.

### Recommendation

Ship Option 2 as-is. It's safe (never worse), measurably better for structural changes, and handles edge cases well. Follow up with a better algorithm (diff-match-patch or token-based) for the AAPL-class complete rewrite cases.
