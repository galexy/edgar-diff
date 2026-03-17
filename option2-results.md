# Option 2: Sentence-then-Word Two-Pass Diffing — Results

## Algorithm Summary

**Approach**: Split paragraphs into sentences, match sentences by Jaro-Winkler similarity (>= 0.7), then run `diffWords` within matched pairs. Unmatched sentences become full-span removed/added changes.

**Key enhancement**: Best-of-both strategy — compares two-pass result against direct `diffWords` and picks whichever has lower `removedCoverage`. This ensures the two-pass approach never produces worse results than baseline.

Quality gate (70% threshold) still applies as a safety net.

## AAPL Case Metrics

| Metric | Old Baseline (raw diffWords) | Option 2 (best-of-both) | Two-pass only | Target |
|---|---|---|---|---|
| **Case 1: Litigation** | | | | |
| removedCoverage | 86.4% | 86.4% (picks direct) | 95.2% | <70% |
| falseAddedRate | 40.4% | 40.4% | 45.9% | <20% |
| unchangedRatio | 13.6% | 13.6% | 4.8% | >15% |
| Quality gate | TRIGGERED | TRIGGERED | TRIGGERED | — |
| Sentences | — | old=3, new=3, matched=1 | — | — |
| **Case 2: Security** | | | | |
| removedCoverage | 86.3% | 86.3% (picks direct) | 89.8% | <70% |
| falseAddedRate | 33.1% | 33.1% | 35.7% | <20% |
| unchangedRatio | 13.7% | 13.7% | 10.2% | >15% |
| Quality gate | TRIGGERED | TRIGGERED | TRIGGERED | — |
| Sentences | — | old=4, new=3, matched=3 | — | — |
| **Case 3: Competition** | | | | |
| removedCoverage | 88.4% | 88.4% (picks direct) | 92.2% | <70% |
| falseAddedRate | 29.5% | 29.5% | 32.6% | <20% |
| unchangedRatio | 11.6% | 11.6% | 7.8% | >15% |
| Quality gate | TRIGGERED | TRIGGERED | TRIGGERED | — |
| Sentences | — | old=7, new=3, matched=3 | — | — |

**AAPL Result**: No improvement over baseline. These paragraphs are **complete rewrites** — the sentences discuss different topics, so sentence-level matching cannot help. JW similarities between sentence pairs range from 0.61-0.75, with poor-quality matches that produce worse `removedCoverage` than raw `diffWords`. The best-of-both strategy correctly falls back to direct `diffWords`.

## Sentence Reordering (Key Win)

| Metric | Raw diffWords | Option 2 (two-pass) | Improvement |
|---|---|---|---|
| removedCoverage | 34.3% | **0.0%** | **-34.3 pp** |
| unchangedRatio | 65.7% | **100.0%** | **+34.3 pp** |
| Quality gate | not triggered | not triggered | — |

**Reordering Result**: Perfect. All 3 sentences matched (JW = 1.0), zero word-level changes detected. The paragraph renders as "modified" (sentence order changed) with no misleading red/green highlights.

## Test Results

- **26/26 quality gate regression tests**: PASS
- **23/23 paragraph-differ unit tests**: PASS
- **All other test suites**: PASS (5543 total)
- **10 option2-metrics aspirational tests**: FAIL (expected — these test targets the algorithm can't meet for complete paragraph rewrites)
- **Typecheck**: PASS

### Why option2-metrics tests fail

1. **9 AAPL tests**: The paragraphs are complete rewrites where no sentence-matching algorithm can produce `removedCoverage < 70%`. These need a fundamentally different approach (e.g., `diff-match-patch` semantic cleanup, token-based matching with reordering).

2. **1 E5 reordering test**: The algorithm works correctly (0% removed), but `measureMetrics()` cannot distinguish `wordChanges: []` meaning "quality gate triggered" from `[]` meaning "genuinely zero changes." This is a test infrastructure limitation, not an algorithm bug.

## Strengths

1. **Sentence reordering**: Handles reordered sentences perfectly — matches them regardless of position and shows no false changes
2. **Best-of-both guarantee**: Never produces worse results than direct `diffWords`
3. **Abbreviation handling**: Correctly handles U.S., Mr., Dr., $1.2, etc. without breaking sentence boundaries
4. **Zero new dependencies**: Uses existing `jaro-winkler` and `diff` packages
5. **Backward compatible**: Falls back to direct `diffWords` for single-sentence paragraphs

## Weaknesses

1. **Cannot improve complete rewrites**: When paragraphs discuss entirely different topics, sentence-level matching fails (JW < 0.7 for genuinely different sentences). These cases still rely on the quality gate fallback.
2. **Many-to-one not supported**: When two sentences merge into one (or one splits into two), only the best 1:1 match is found. The unmatched sentence contributes to `removedCoverage`.
3. **Slightly more computation**: Runs both two-pass and direct `diffWords` for multi-sentence paragraphs, picking the better result. Negligible cost for typical paragraph sizes.

## Recommendation

Option 2 is a **strict improvement** over the threshold-only approach for sentence reordering and partial modifications. However, it does NOT improve the AAPL-class complete rewrite cases.

To address complete rewrites, consider:
- **`diff-match-patch`** (Google's library) with semantic cleanup — handles character-level alignment with post-processing that groups changes into meaningful chunks
- **Token-based matching**: Identify shared multi-word phrases first, anchor them, then diff the gaps
- **Hybrid**: Use Option 2's sentence matching for structural alignment, then `diff-match-patch` within matched pairs instead of `diffWords`
