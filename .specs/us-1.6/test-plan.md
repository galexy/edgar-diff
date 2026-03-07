# US-1.6 Test Plan: Paragraph-Level Diffs Within Matched Sections

## Overview

This test plan covers the paragraph-level diffing module that operates within
already-matched sections. The module aligns paragraphs, detects additions,
deletions, and modifications, computes word-level diffs for modified paragraphs,
handles reordering via post-Myers move detection, and preserves source mappings
throughout.

**Modules under test:**
- `section-aligner.ts` -- Jaro-Winkler alignment of sections across two filings
- `paragraph-differ.ts` -- Myers diff for paragraph alignment, move detection post-pass, diffWords for word-level changes
- `diff-filings.ts` -- Top-level orchestrator (flattens sections, aligns, diffs, aggregates stats)
- Diff output types (`src/diff/types.ts`)

**Test infrastructure conventions** (from `tests/CLAUDE.md`):
- `vitest` with explicit imports (`describe`, `it`, `expect`)
- `makeRawFiling(html)` from `helpers/ground-truth.ts` for test RawFiling objects
- Inline HTML fixtures (< 30 lines) for unit tests
- Real filing fixtures in `tests/integration/fixtures/` for integration tests
- Property-based tests in `tests/acceptance/`

**Key type decisions reflected in tests:**
- `ParagraphChange.type`: `'added' | 'removed' | 'modified' | 'unchanged' | 'moved'`
- `WordChange`: `{ type, value }` -- no source offsets (paragraph-level source mappings suffice)
- `DiffStats` includes `moved` count; `TotalDiffStats` includes `totalMoved`
- Move detection threshold: JW > 0.85 on normalized text

---

## 1. BDD Acceptance Criteria

### AC-1: Paragraph alignment within matched sections

```gherkin
Scenario: Detect additions, deletions, and modifications
  Given two matched sections with paragraphs:
    | Base section          | Target section             |
    | "Revenue grew 5%."   | "Revenue grew 5%."         |
    | "Costs were stable."  | "Costs increased by 3%."   |
    |                       | "New risk factor emerged."  |
  When paragraph-level diff is computed
  Then the result contains:
    | paragraph              | status      |
    | "Revenue grew 5%."     | unchanged   |
    | "Costs were stable."   | modified    |
    | "New risk factor..."   | added       |

Scenario: Detect deletions
  Given base section has ["A", "B", "C"] and target has ["A", "C"]
  When paragraph-level diff is computed
  Then paragraph "B" is marked as deleted

Scenario: All paragraphs identical
  Given two sections with identical paragraphs ["X", "Y", "Z"]
  When paragraph-level diff is computed
  Then all paragraphs are marked unchanged and no word-level diffs are produced

Scenario: Empty base section (all additions)
  Given base section has no paragraphs and target has ["A", "B"]
  When paragraph-level diff is computed
  Then paragraphs "A" and "B" are marked as added

Scenario: Empty target section (all deletions)
  Given base section has ["A", "B"] and target has no paragraphs
  When paragraph-level diff is computed
  Then paragraphs "A" and "B" are marked as deleted
```

### AC-2: Word-level diffs for modified paragraphs

```gherkin
Scenario: Word-level changes within a modified paragraph
  Given base paragraph "Revenue increased by 10% in fiscal 2023."
  And target paragraph "Revenue increased by 15% in fiscal 2024."
  When word-level diff is computed
  Then the diff shows "10%" changed to "15%" and "2023" changed to "2024"
  And unchanged spans ("Revenue increased by", "in fiscal") are preserved

Scenario: Entire paragraph rewritten
  Given base paragraph "The company sells widgets."
  And target paragraph "We manufacture electronic components."
  When word-level diff is computed
  Then the diff contains removed and added spans covering the full text

Scenario: Minor punctuation change
  Given base paragraph "Revenue was $100M."
  And target paragraph "Revenue was $100M"
  When word-level diff is computed
  Then only the trailing period is marked as removed
```

### AC-3: Paragraph reordering detection

```gherkin
Scenario: Two paragraphs swapped (pure move)
  Given base section ["A: Risk of fire.", "B: Risk of flood."]
  And target section ["B: Risk of flood.", "A: Risk of fire."]
  When paragraph-level diff is computed
  Then both paragraphs are marked as type "moved"
  And neither has wordChanges populated
  And no content is marked as added or deleted

Scenario: Reorder with modification (moved + wordChanges)
  Given base section ["Para A original text.", "Para B text."]
  And target section ["Para B text.", "Para A updated text."]
  When paragraph-level diff is computed
  Then "Para B text." is marked as moved without wordChanges
  And "Para A" is marked as moved with wordChanges showing "original" -> "updated"

Scenario: Large block move (5+ paragraphs shifted)
  Given base section with paragraphs [P1..P10]
  And target section with paragraphs [P6..P10, P1..P5]
  When paragraph-level diff is computed
  Then paragraphs are identified as moved, not as 10 deletions + 10 additions

Scenario: Dissimilar paragraphs not falsely matched as moves
  Given base section ["The sky is blue."] and target section ["Revenue grew 5%."]
  When paragraph-level diff is computed
  Then paragraphs are marked as deleted and added, not moved
  (JW similarity below 0.85 threshold)
```

### AC-4: Source mappings in diff output

```gherkin
Scenario: All change types include appropriate source mappings
  Given a diff result with added, deleted, modified, unchanged, and moved entries
  Then "added" entries have newSource with start < end
  And "deleted" entries have oldSource with start < end
  And "modified" entries have both oldSource and newSource with start < end
  And "unchanged" entries have both oldSource and newSource with start < end
  And "moved" entries have both oldSource and newSource with start < end

Scenario: Source mapping round-trip
  Given a diff entry for a modified paragraph in the target filing
  When the source location is used to slice the original HTML
  Then the slice contains the paragraph text
```

---

## 2. Unit Tests

### 2.1 `section-aligner.ts`

File: `tests/unit/section-aligner.test.ts`

| ID | Test | Rationale |
|----|------|-----------|
| SA-U1 | Identical section IDs produce 1:1 alignment | Happy path |
| SA-U2 | Sections with similar headings (Jaro-Winkler >= 0.75) are matched | Threshold validation |
| SA-U3 | Sections below threshold (JW < 0.75) remain unmatched | Threshold boundary |
| SA-U4 | Unmatched base sections appear as "removed" | Deletion detection |
| SA-U5 | Unmatched target sections appear as "added" | Addition detection |
| SA-U6 | Empty base sections array returns all target as added | Boundary |
| SA-U7 | Empty target sections array returns all base as removed | Boundary |
| SA-U8 | Both arrays empty returns empty alignment | Boundary |
| SA-U9 | Single section in each, matching | Minimal happy path |
| SA-U10 | Alignment is deterministic (same input = same output) | Correctness |
| SA-U11 | Case-insensitive heading matching ("RISK FACTORS" matches "Risk Factors") | Robustness |
| SA-U12 | Headings with minor wording changes still match (e.g., "Item 1A. Risk Factors" vs "Item 1A - Risk Factors") | Real-world variation |

### 2.2 `paragraph-differ.ts`

File: `tests/unit/paragraph-differ.test.ts`

| ID | Test | Rationale |
|----|------|-----------|
| PD-U1 | Identical paragraph lists produce all "unchanged" | Happy path |
| PD-U2 | Added paragraph at end detected | Addition |
| PD-U3 | Deleted paragraph from middle detected | Deletion |
| PD-U4 | Modified paragraph detected with word-level diff | Modification |
| PD-U5 | Multiple changes (add + delete + modify) in one section | Combined |
| PD-U6 | Two paragraphs swapped: detected as "moved", not add+delete | Reordering (AC-3) |
| PD-U7 | Moved paragraph with modification: type "moved" with wordChanges populated | Reorder + edit (AC-3) |
| PD-U8 | Empty base (all added) | Boundary |
| PD-U9 | Empty target (all deleted) | Boundary |
| PD-U10 | Both empty produces empty diff | Boundary |
| PD-U11 | Single paragraph, unchanged | Minimal |
| PD-U12 | Single paragraph, modified | Minimal |
| PD-U13 | Word-level diff identifies specific changed words | Granularity |
| PD-U14 | Word-level diff for numeric changes ("$100M" -> "$150M") | Financial text |
| PD-U15 | Word-level diff preserves unchanged spans | Completeness |
| PD-U16 | Paragraph with only whitespace differences treated as unchanged | Normalization |
| PD-U17 | Very similar paragraphs (1 word changed in 100) correctly identified as modified, not add+delete | Threshold |
| PD-U18 | Completely different paragraphs identified as delete+add, not modified | Threshold |
| PD-U19 | Move detection: dissimilar paragraphs (JW < 0.85) stay as removed+added | Move threshold boundary |
| PD-U20 | Move detection: near-threshold similarity (JW ~0.85) handled correctly | Move threshold edge |
| PD-U21 | DiffStats.moved count matches number of moved entries | Stats accuracy |
| PD-U22 | Table blocks emitted as TablePlaceholder, not diffed as paragraphs | Table handling |
| PD-U23 | Mixed paragraph+table blocks: tables appear as placeholders in correct positions | Interleaving |

### 2.3 `diff-filings.ts`

File: `tests/unit/diff-filings.test.ts`

| ID | Test | Rationale |
|----|------|-----------|
| DF-U1 | `diffFilings()` with two simple StructuredDocuments produces FilingDiffResult | Happy path |
| DF-U2 | Subsection flattening: nested sections are treated as top-level for alignment | Flattening behavior |
| DF-U3 | Stats aggregation: TotalDiffStats sums correctly across all section diffs | Stats correctness |
| DF-U4 | `DiffOptions.similarityThreshold` overrides default 0.75 | Options |
| DF-U5 | Added sections appear in `addedSections` with correct SectionSummary | Addition reporting |
| DF-U6 | Removed sections appear in `removedSections` with correct SectionSummary | Removal reporting |

### 2.4 Type contracts

File: `tests/unit/diff-types.test.ts`

| ID | Test | Rationale |
|----|------|-----------|
| DT-U1 | Every "added" entry has newSource, no oldSource | Contract |
| DT-U2 | Every "removed" entry has oldSource, no newSource | Contract |
| DT-U3 | Every "modified" entry has both oldSource and newSource | Contract |
| DT-U4 | Every "unchanged" entry has both oldSource and newSource | Contract |
| DT-U5 | Every "moved" entry has both oldSource and newSource | Contract |
| DT-U6 | Source locations satisfy start >= 0 and start < end | Invariant |
| DT-U7 | "modified" entries always have wordChanges populated | Contract |
| DT-U8 | "moved" entries without text change have no wordChanges | Contract |
| DT-U9 | "moved" entries with text change have wordChanges populated | Contract |

---

## 3. Integration Tests

File: `tests/integration/paragraph-differ.integration.test.ts`

Uses real filing fixtures via `helpers/ground-truth.ts`.

| ID | Test | Rationale |
|----|------|-----------|
| PD-I1 | AAPL FY2023 vs FY2024: Item 1 (Business) diff produces reasonable change count | End-to-end quality |
| PD-I2 | MSFT FY2023 vs FY2024: Item 1A (Risk Factors) diff detects modifications | Cross-year diff |
| PD-I3 | Same filing diffed against itself: all paragraphs unchanged, stats.moved === 0 | Identity property |
| PD-I4 | Source mappings from diff output slice to correct HTML substrings | Round-trip validation |
| PD-I5 | Cross-module: `parseFiling()` output feeds directly into `diffFilings()` | Pipeline integration |
| PD-I6 | Sections with only tables (no paragraphs): diff produces empty paragraph changes, only TablePlaceholders | Table-only sections |
| PD-I7 | Sections with mixed tables and paragraphs: paragraphs diffed, tables emitted as placeholders | Content type filtering |
| PD-I8 | All diff entries reference valid source locations within the HTML bounds | Source mapping bounds |

---

## 4. Acceptance Tests (Property-Based)

File: `tests/acceptance/paragraph-differ.acceptance.test.ts`

### 4.1 Alignment invariants

| ID | Property | Check |
|----|----------|-------|
| PA-A1 | Random section pairs: alignment is deterministic | Same input => same output across 100 iterations |
| PA-A2 | Alignment accounts for all sections | Every base section is either matched or "removed"; every target section is either matched or "added" |
| PA-A3 | No section appears in multiple matches | 1:1 mapping constraint |

### 4.2 Diff completeness

| ID | Property | Check |
|----|----------|-------|
| PA-A4 | Every base paragraph appears in exactly one diff entry (removed, modified, unchanged, or moved) | No data loss |
| PA-A5 | Every target paragraph appears in exactly one diff entry (added, modified, unchanged, or moved) | No data loss |
| PA-A6 | Diff entry count >= max(base.length, target.length) | Lower bound |
| PA-A7 | DiffStats fields sum to total paragraph change count | Stats consistency |

### 4.3 Source mapping invariant

| ID | Property | Check |
|----|----------|-------|
| PA-A8 | All changes reference valid source locations (start >= 0, start < end) | No invalid offsets |

### 4.4 Generator

A factory function `generateParagraphPair()` creates random base/target `Paragraph[]` arrays with:
- Random text (1-5 sentences)
- Valid `SourceLocation` values (start < end, within a synthetic HTML document)
- Controlled mutations: random additions, deletions, modifications, and reorderings

A factory function `generateSectionPair()` creates `FilingSection` pairs with:
- Randomized headings with controlled similarity
- Random block arrays mixing Paragraphs and Tables
- Valid source mappings

Test count controlled by `DIFF_TEST_COUNT` env var (default: 200).

---

## 5. Boundary Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| BC-1 | 0 paragraphs in both sections | Empty diff result, all stats zero |
| BC-2 | 1 paragraph in base, 0 in target | Single "removed" entry |
| BC-3 | 0 paragraphs in base, 1 in target | Single "added" entry |
| BC-4 | 1 identical paragraph in each | Single "unchanged" entry |
| BC-5 | Section with only Table blocks (no paragraphs) | No ParagraphChange entries; only TablePlaceholder entries |
| BC-6 | Very large section (1000+ paragraphs) | Completes without crash, result has correct count |
| BC-7 | Identical documents (all sections match, all paragraphs unchanged) | All entries marked "unchanged", stats.moved === 0 |
| BC-8 | Completely different documents (no text overlap) | All base paragraphs "removed", all target "added" (JW < 0.85) |
| BC-9 | Single-word paragraphs | Diff still works correctly |
| BC-10 | Paragraphs with special characters (HTML entities, unicode) | Text correctly compared after normalization |

---

## 6. Error Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| EC-1 | Paragraph with empty text string | Treated as valid paragraph (may match other empty paragraphs) |
| EC-2 | Invalid source locations (start > end) on input | Does not crash; logs warning |
| EC-3 | Source location beyond HTML length on input | Does not crash; source mapping may be invalid but no exception |

---

## 7. Performance Criteria

| Metric | Target | How to measure |
|--------|--------|----------------|
| Single section-pair diff | < 50ms | `performance.now()` around diff call for sections with ~50 paragraphs |
| Full filing-pair diff | < 500ms | End-to-end `diffFilings()` on AAPL FY2023 vs FY2024 |
| Large filing diff | < 2000ms | Synthetic filing with 1000+ paragraphs per section |
| Memory stability | No OOM | 1000-paragraph sections complete without heap overflow |

Performance tests go in `tests/integration/paragraph-differ.integration.test.ts` with `it.skip` by default (enabled via `PERF_TESTS=1` env var).

---

## 8. Test Data Strategy

### Inline fixtures (unit tests)
- Hand-crafted `Paragraph` and `FilingSection` objects with explicit source locations
- Example:
  ```typescript
  const baseParagraphs: Paragraph[] = [
    { type: 'paragraph', text: 'Revenue grew 5%.', source: { start: 100, end: 130 } },
    { type: 'paragraph', text: 'Costs were stable.', source: { start: 131, end: 160 } },
  ];
  ```

### Factory functions (acceptance tests)
- `makeParagraph(text, startOffset)` -- creates a `Paragraph` with valid source mapping
- `makeSection(id, heading, paragraphs)` -- creates a `FilingSection` with valid source mapping wrapping the given paragraphs
- `generateParagraphPair()` -- random base/target paragraph arrays with controlled mutations
- `generateSectionPair()` -- random base/target section pairs

### Real fixture pairs (integration tests)
- AAPL FY2023 vs FY2024 (Workiva pattern)
- MSFT FY2023 vs FY2024 (DFIN pattern)
- JPM FY2023 vs FY2024 (non-bold pattern)
- XOM FY2012 vs FY2024 (legacy vs modern, maximal change detection)

---

## 9. File Layout

```
tests/
  unit/
    section-aligner.test.ts       # SA-U* tests (12)
    paragraph-differ.test.ts      # PD-U* tests (23)
    diff-filings.test.ts          # DF-U* tests (6)
    diff-types.test.ts            # DT-U* tests (9)
  integration/
    paragraph-differ.integration.test.ts  # PD-I* tests (8) + perf
  acceptance/
    paragraph-differ.acceptance.test.ts   # PA-A* property tests (8)
    diff-test-generator.ts               # Factory functions for random test data
  helpers/
    diff-fixtures.ts              # makeParagraph, makeSection helpers
```
