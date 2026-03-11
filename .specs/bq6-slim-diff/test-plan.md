---
title: "Test Plan: BQ6 Slim Down StructuredDiff Output"
story: edgar-diff-bq6
created: "2026-03-10"
status: revised
---

# Test Plan: BQ6 Slim Down StructuredDiff Output

## Overview

The StructuredDiff output currently embeds full source content objects at every level, causing 22MB JSON for trivial changes (target: ~0.2MB). This story removes embedded source objects while preserving diff data and source mappings.

### Changes Under Test

**Fields REMOVED from types:**

| Type | Removed Fields | Rationale |
|------|---------------|-----------|
| `SectionDiff` | `oldSection`, `newSection` (`FilingSection`) | Redundant — consumer can look up via `sourceMapping` offsets into original HTML |
| `ParagraphDiff` | `oldParagraph`, `newParagraph` (`Paragraph`) | Redundant — text is captured in `wordChanges`; location in `sourceMapping` |
| `TableDiff` | `oldTable`, `newTable` (`Table`) | Redundant — cell-level changes in `cellDiffs`; location in `sourceMapping` |

**Filtering changes (behavioral):**

- Unchanged paragraphs filtered from `paragraphDiffs[]` (in `makeSectionDiff()`)
- Unchanged tables filtered from `tableDiffs[]` (in `makeSectionDiff()`)
- Unchanged rows filtered from `rowDiffs[]` (in `diffTable()`)
- `oldFiling`/`newFiling`: changes from `RawFiling` to new `DiffFilingMetadata` type (same fields minus `html`)

**Filtering layering (important for test targeting):**

| What | Where filtered | `diffParagraphs()` returns | `diffFilings()` returns |
|------|---------------|---------------------------|------------------------|
| Unchanged paragraphs | `makeSectionDiff()` in diff-engine.ts | All entries (including unchanged) | Only changed entries |
| Unchanged tables | `makeSectionDiff()` in diff-engine.ts | N/A (`diffTables()` returns all) | Only changed entries |
| Unchanged rows | `diffTable()` in table-differ.ts | N/A | Only changed rows |

---

## 1. Existing Test Updates

This is the primary focus. The type changes will cause compile errors in tests that access removed fields. The behavioral changes (filtering) affect a smaller set of tests. All existing tests should continue to verify correct behavior after updates.

### 1.1 Unit Tests: `paragraph-differ.test.ts`

**Field access removals (compile errors):**

| Test | Line | Current Code | Update |
|------|------|-------------|--------|
| PD-U2 | 35 | `changes[1].newParagraph?.text` → `'B'` | Replace with `sourceMapping.new` check (verify offset exists) |
| PD-U3 | 45 | `removed[0].oldParagraph?.text` → `'B'` | Replace with `sourceMapping.old` check |
| PD-U6 | 82-91 | `m.oldParagraph`/`m.newParagraph` access | Remove property accesses; verify `wordChanges` is undefined for pure moves |
| PD-U7 | 107 | `c.oldParagraph?.text.includes('revenue growth')` | Replace with `c.wordChanges` content check (look for year change in wordChanges) |
| PD-U19 | 229 | `c.oldParagraph?.text === 'The sky is blue.'` | Remove — the assertion was checking move detection, which is already verified by `changeType` |

**No behavioral changes:** `diffParagraphs()` still returns unchanged entries — PD-U1, PD-U11, PD-U16, PD-U22, PD-U23 need NO changes.

### 1.2 Unit Tests: `diff-types.test.ts`

| Test | Line | Current Code | Update |
|------|------|-------------|--------|
| DT-U8 | 117 | `m.oldParagraph?.text === m.newParagraph?.text` | Replace with `m.wordChanges === undefined` (pure move = no word changes) |
| DT-U9 | 135 | `m.oldParagraph?.text !== m.newParagraph?.text` | Replace with `m.wordChanges !== undefined` (moved + modified = has word changes) |

DT-U1 through DT-U7 need NO changes (test sourceMapping invariants only).

### 1.3 Unit Tests: `table-differ.test.ts`

**Field access removals:**

| Test | Line | Current Code | Update |
|------|------|-------------|--------|
| `diffTables` added | 280-281 | `result[0].newTable` === table | Replace with `!('newTable' in result[0])` and `sourceMapping.new` check |
| `diffTables` removed | 290 | `result[0].oldTable` === table | Replace with `!('oldTable' in result[0])` and `sourceMapping.old` check |

**Behavioral changes (unchanged row filtering):**

| Test | Current Behavior | New Behavior |
|------|-----------------|-------------|
| `identical rows => all unchanged` | `rowDiffs` has entries with `changeType: 'unchanged'` | `rowDiffs === []` (all filtered out) |
| `row fingerprint uses pipe-delimited...` | `rowDiffs[0].changeType === 'unchanged'` | `rowDiffs === []` |
| `identical text => unchanged, not in cellDiffs` | `cellDiffs.length === 0` | Same, but also `rowDiffs === []` |
| `all cells identical` | `changeType === 'unchanged'`, `cellsChanged === 0` | Same, but also `rowDiffs === []` |
| `empty table vs empty table` | `rowDiffs === []` | Same (no change) |
| `summary counts are consistent` | rowsAdded + rowsRemoved + rowsModified + rowsUnchanged = total | Same (summary computed before filtering) |
| `cellDiffs derived from rowDiffs` | `td.cellDiffs === td.rowDiffs.flatMap(...)` | Still holds (unchanged rows had empty cellDiffs anyway) |

### 1.4 Unit Tests: `diff-filings.test.ts`

| Test | Update |
|------|--------|
| DF-U1 | `result.oldFiling` is now `DiffFilingMetadata` — verify `accessionNumber`, `cik`, `formType` exist, `html` does NOT exist |
| All DF-U* | Any `result.oldFiling.html` or `result.newFiling.html` access must be removed |

### 1.5 Integration Tests: `diff-pipeline.integration.test.ts`

| Test | Line | Current Code | Update |
|------|------|-------------|--------|
| I-DP-5 | 213 | `result.oldFiling === oldDoc.filing` (reference equality) | Change to value equality: `result.oldFiling.accessionNumber === oldDoc.filing.accessionNumber` etc. Verify `!('html' in result.oldFiling)` |
| I-DP-7 | 309-320 | `td.oldTable` / `td.newTable` assertions | Replace with `!('oldTable' in td)` / `!('newTable' in td)` and `sourceMapping` checks |
| I-DP-8 | 347-377 | `td.oldTable`/`td.newTable` pattern | Replace with absence checks; same structure otherwise |

**Filtering additions to existing tests:** Add assertions to existing I-DP tests that verify unchanged paragraphs/tables are not present in the output. For example, in I-DP-6 (multi-section), verify that `paragraphDiffs` and `tableDiffs` only contain non-unchanged entries.

### 1.6 E2E Tests: `diff-pipeline.e2e.test.ts`

| Test | Update |
|------|--------|
| E2E-2 | `result.oldFiling.html` no longer exists — update serialization test. Verify `!('html' in parsed.oldFiling)` |
| E2E-4 (self-diff) | Add: all `paragraphDiffs === []` and `tableDiffs === []` (unchanged content now filtered) |
| E2E-T5 | Verify `!('oldTable' in parsedTd)` / `!('newTable' in parsedTd)` after round-trip |
| E2E-T6 (self-diff) | Add: all `paragraphDiffs === []` and `tableDiffs === []` |

### 1.7 Example Scripts: `examples/*.ts`

Review each example script for references to removed fields:

| Script | Status |
|--------|--------|
| `diff-simple.ts` | Uses only kept fields (`sd.paragraphDiffs`, `sd.tableDiffs`, `sd.changeType`). **No code changes needed.** JSON output will be dramatically smaller. |
| `diff-with-tables.ts` | Uses only kept fields (`td.summary`, `td.cellDiffs`, `cd.oldNumericValue`). **No code changes needed.** |
| `diff-structural.ts` | Uses only kept fields. **No code changes needed.** |
| `diff-to-json.ts` | Uses `JSON.stringify(result)`. **No code changes needed.** Output will be ~100x smaller. |

**Verification:** Run all example scripts after implementation and confirm exit code 0 + expected output.

---

## 2. New Tests (Recommended Additions)

These are genuinely new tests for behavior that didn't exist before. Kept to a minimum — only tests that cover new functionality not already captured by updated existing tests.

### 2.1 Unchanged Filtering (NEW behavior — `diff-engine.test.ts`)

These test the filtering that `makeSectionDiff()` now performs. No existing test covers this because filtering is entirely new.

```
it('DE-S1: unchanged paragraphs filtered from matched section output')
  - Section with 3 paragraphs: 2 unchanged, 1 modified
  - diffFilings() → sectionDiff.paragraphDiffs.length === 1
  - The single entry has changeType 'modified'

it('DE-S2: unchanged tables filtered from matched section output')
  - Section with 2 tables: 1 unchanged, 1 modified
  - diffFilings() → sectionDiff.tableDiffs.length === 1

it('DE-S3: section with all unchanged content → empty paragraphDiffs and tableDiffs')
  - Identical sections → sectionDiff.changeType === 'unchanged'
  - paragraphDiffs === [] and tableDiffs === []
  - Section still appears in sectionDiffs (sections are NOT filtered)

it('DE-S4: summary counts computed before filtering (unchanged count preserved)')
  - Table with 3 rows: 1 unchanged, 1 modified, 1 added
  - summary.rowsUnchanged === 1 (counted), but rowDiffs.length === 2 (unchanged row filtered)
```

**Why keep:** Filtering is entirely new behavior. If filtering breaks (e.g., accidentally filters `'moved'` paragraphs), these tests catch it. No existing test exercises this path.

### 2.2 DiffFilingMetadata (NEW type — `diff-engine.test.ts`)

```
it('DE-S5: oldFiling/newFiling are DiffFilingMetadata (no html)')
  - diffFilings result
  - Assert !('html' in result.oldFiling) && !('html' in result.newFiling)
  - Assert accessionNumber, cik, formType, filingDate, primaryDocumentFilename, fetchedAt all present
  - Assert values match original RawFiling
```

**Why keep:** `DiffFilingMetadata` is a new type. If `toDiffFilingMetadata()` accidentally includes `html` or drops a field, this catches it. Cheap to write, high signal.

### 2.3 Output Size (E2E — `diff-pipeline.e2e.test.ts`)

```
it('E2E-S1: output JSON size is within target bounds')
  - parseFiling → diffFilings on Apple 10-K fixtures
  - JSON.stringify(result).length should be < 1MB (was ~22MB)
  - Log actual size for manual inspection
```

**Why keep:** This is the whole point of the story. If output is still 22MB after the changes, the story failed. One assertion that validates the goal.

---

## 3. Tests NOT Adding (Rationale)

These were in the previous draft but are being removed because they duplicate what updated existing tests already cover:

| Removed | Reason |
|---------|--------|
| SD-U1–U6 (type contract shape tests) | TypeScript compiler enforces removed fields don't exist. Runtime shape is verified implicitly by all updated tests that access the new API. |
| PD-S1–S8 (paragraph-differ slim tests) | Duplicates existing PD-U* tests after field access updates. The updated existing tests already verify the same behavior. |
| TD-S1–S9 (table-differ slim tests) | Mostly duplicates existing table-differ tests after updates. TD-S3/TD-S8 behavior is covered by updated existing row alignment tests. |
| JS-S1–S6 (JSON serialization) | Existing E2E-2 and E2E-T5 already test JSON round-trip. Updating those covers the slim shape. |
| I-S1–S9 (integration slim tests) | Existing I-DP-1 through I-DP-8 test the same pipeline. Updating those + adding filtering assertions is sufficient. |
| B-S1–S10 (boundary conditions) | Existing B-1 through B-8 test the same boundaries. Updating them for the new shape is sufficient. |
| E-S1–S5 (error conditions) | Existing E-1 through E-5 test the same error paths. No new error paths introduced. |
| E2E-S2–S8 | Existing E2E-1 through E2E-T7 cover these scenarios. Updating them is sufficient. |

---

## 4. Existing Test Updates Summary (Checklist)

### Field access removals (compile errors after type change)

| # | Test | File | Fix |
|---|------|------|-----|
| 1 | DT-U8 | `diff-types.test.ts:117` | `m.oldParagraph?.text` → `m.wordChanges === undefined` |
| 2 | DT-U9 | `diff-types.test.ts:135` | `m.oldParagraph?.text` → `m.wordChanges !== undefined` |
| 3 | PD-U2 | `paragraph-differ.test.ts:35` | `newParagraph?.text` → `sourceMapping.new` check |
| 4 | PD-U3 | `paragraph-differ.test.ts:45` | `oldParagraph?.text` → `sourceMapping.old` check |
| 5 | PD-U6 | `paragraph-differ.test.ts:82` | Remove `m.oldParagraph`/`m.newParagraph` access |
| 6 | PD-U7 | `paragraph-differ.test.ts:107` | `oldParagraph?.text.includes(...)` → `wordChanges` check |
| 7 | PD-U19 | `paragraph-differ.test.ts:229` | Remove `oldParagraph?.text` access |
| 8 | I-DP-5 | `diff-pipeline.integration.test.ts:213` | Reference equality → value equality + no `html` |
| 9 | I-DP-7 | `diff-pipeline.integration.test.ts:309-320` | `td.oldTable`/`td.newTable` → absence checks |
| 10 | I-DP-8 | `diff-pipeline.integration.test.ts:347-377` | Same as I-DP-7 |
| 11 | table-differ added | `table-differ.test.ts:280-281` | `result[0].newTable` → absence check |
| 12 | table-differ removed | `table-differ.test.ts:290` | `result[0].oldTable` → absence check |

### Behavioral changes (filtering)

| # | Test | File | Fix |
|---|------|------|-----|
| 13 | row alignment: identical rows | `table-differ.test.ts` | `rowDiffs` now empty (unchanged rows filtered) |
| 14 | row alignment: fingerprint test | `table-differ.test.ts` | `rowDiffs[0].changeType` → `rowDiffs === []` |
| 15 | cell comparison: identical text | `table-differ.test.ts` | Add `rowDiffs === []` assertion |
| 16 | boundary: all cells identical | `table-differ.test.ts` | Add `rowDiffs === []` assertion |
| 17 | E2E-4 self-diff | `diff-pipeline.e2e.test.ts` | Add `paragraphDiffs === []`, `tableDiffs === []` |
| 18 | E2E-T6 self-diff | `diff-pipeline.e2e.test.ts` | Add `paragraphDiffs === []`, `tableDiffs === []` |

### DiffFilingMetadata migration

| # | Test | File | Fix |
|---|------|------|-----|
| 19 | DF-U1 | `diff-filings.test.ts` | Verify `DiffFilingMetadata` shape (no `html`) |
| 20 | E2E-2 | `diff-pipeline.e2e.test.ts:55` | Remove/update `html` serialization handling |

---

## 5. Implementation Design Alignment

Per `implementation-design.md`:

1. Fields removed from TypeScript interfaces (compiler enforces)
2. `DiffFilingMetadata` type in `diff/types.ts` (avoids collision with `client/types.ts:FilingMetadata`)
3. `toDiffFilingMetadata()` helper in `diff-engine.ts`
4. Filtering in `makeSectionDiff()` for paragraphs/tables
5. Unchanged row filtering in `diffTable()`, summary computed before filtering
6. `InternalParagraphDiff` for intermediate computation, stripped at `diffParagraphs()` boundary
