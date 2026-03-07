---
title: "Test Plan: US-1.7 Table-Level Diffs"
story: edgar-diff-vok
created: "2026-03-07"
status: draft
---

# Test Plan: US-1.7 Table-Level Diffs

## Overview

This test plan covers the table-level diff pipeline: `grid-normalizer.ts`, `table-matcher.ts`, and `table-differ.ts`, plus their integration into the diff engine via `diffTables()`.

### Key Types Under Test

From implementation design (`src/diff/types.ts`):

```typescript
type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

interface DiffRange { old?: SourceLocation; new?: SourceLocation; }

interface CellDiff {
  row: number; col: number;
  changeType: ChangeType;
  oldValue?: string; newValue?: string;
  oldNumericValue?: number; newNumericValue?: number;
  sourceMapping: DiffRange;
}

interface RowDiff {
  oldRowIndex?: number; newRowIndex?: number;
  changeType: ChangeType;
  cellDiffs: CellDiff[];
}

interface TableDiff {
  changeType: ChangeType;
  oldTable?: Table; newTable?: Table;
  rowDiffs: RowDiff[];
  cellDiffs: CellDiff[];  // flat convenience list derived from rowDiffs
  sourceMapping: DiffRange;
  summary: {
    rowsAdded: number; rowsRemoved: number;
    rowsModified: number; rowsUnchanged: number;
    cellsChanged: number;
  };
}

interface NormalizedCell { cell: TableCell; isOrigin: boolean; }
interface NormalizedGrid {
  cells: (NormalizedCell | null)[][];
  rowCount: number; colCount: number; table: Table;
}

interface TableMatch { oldTable: Table; newTable: Table; similarity: number; }
interface TableMatchResult { matched: TableMatch[]; added: Table[]; removed: Table[]; }
```

From `src/types.ts`:

```typescript
interface Table extends SourceMapped { type: 'table'; rows: TableRow[]; }
interface TableRow extends SourceMapped { cells: TableCell[]; isHeader: boolean; }
interface TableCell extends SourceMapped {
  text: string; numericValue?: number; colspan: number; rowspan: number;
}
```

---

## 1. BDD Acceptance Criteria (Property-Based)

All acceptance criteria are implemented as **property-based tests** in `tests/acceptance/table-differ.acceptance.test.ts`, following the same pattern as `table-extractor.acceptance.test.ts`.

### Generator: `generateTablePair()`

A new generator function `generateTablePair(mutation)` in `tests/acceptance/table-diff-generator.ts` produces pairs of `Table` objects with controlled mutations. It:

1. Calls the existing `generateTable()` to create a base table
2. Parses the base table via `parseFiling()` to get a real `Table` object
3. Applies a specified mutation to produce the "new" table
4. Returns `{ oldTable, newTable, expectedMutation }` with metadata about what changed

**Mutation types** (one per AC scenario):
- `'none'` — identical copy (AC-7)
- `'cell-values'` — randomly change N cell values in place (AC-2)
- `'add-rows'` — append 1-3 rows at random positions (AC-3)
- `'remove-rows'` — remove 1-3 rows at random positions (AC-3)
- `'add-columns'` — append 1-2 columns to each row (AC-4)
- `'remove-columns'` — remove 1-2 columns from each row (AC-4)
- `'mixed'` — combine cell changes + row adds/removes (general)

**Table list generator** `generateTableListPair(scenario)`:
- `'matched'` — same count, headers preserved (AC-1)
- `'shifted'` — insert a new table at start of new list (AC-1 position shift)
- `'added'` — new list has extra table (AC-5)
- `'removed'` — old list has extra table (AC-6)
- `'unchanged'` — identical lists (AC-7)

Each scenario generates N=200 test cases (configurable via `TABLE_DIFF_TEST_COUNT` env var).

### AC-1: Tables matched by position and header similarity

```
property: table matching invariants (N=200)
  Generator: generateTableListPair('matched' | 'shifted' | 'added' | 'removed')
  For each generated pair:
    P1: Every matched pair has similarity >= threshold (0.70)
    P2: matched.length + added.length = newTables.length
    P3: matched.length + removed.length = oldTables.length
    P4: No table appears in both matched and added/removed
    P5: When headers are identical, similarity === 1.0
    P6: When a table is inserted at position 0, the original tables still match correctly
```

### AC-2: Cell-by-cell diffs for matched tables

```
property: cell diff correctness on value mutations (N=200)
  Generator: generateTablePair('cell-values')
  For each generated pair:
    P1: changeType is 'modified' (since cells were mutated)
    P2: summary.cellsChanged >= 1
    P3: Every cellDiff has changeType 'modified' with both oldValue and newValue set
    P4: cellDiff row/col indices are within grid bounds
    P5: Cells NOT in the mutation set have changeType 'unchanged' in their rowDiff
    P6: summary.rowsModified counts match rows containing changed cells

property: identical tables produce unchanged diff (N=200)
  Generator: generateTablePair('none')
  For each generated pair:
    P1: changeType is 'unchanged'
    P2: summary.cellsChanged is 0
    P3: All rowDiffs have changeType 'unchanged'
    P4: cellDiffs flat list is empty
```

### AC-3: Added and removed rows

```
property: row addition detection (N=200)
  Generator: generateTablePair('add-rows')
  For each generated pair:
    P1: changeType is 'modified'
    P2: summary.rowsAdded >= 1
    P3: Each added RowDiff has newRowIndex set, oldRowIndex undefined
    P4: summary.rowsAdded + summary.rowsRemoved + summary.rowsModified + summary.rowsUnchanged
        = max(oldGrid.rowCount, newGrid.rowCount)

property: row removal detection (N=200)
  Generator: generateTablePair('remove-rows')
  For each generated pair:
    P1: changeType is 'modified'
    P2: summary.rowsRemoved >= 1
    P3: Each removed RowDiff has oldRowIndex set, newRowIndex undefined
```

### AC-4: Added and removed columns

```
property: column addition detection (N=200)
  Generator: generateTablePair('add-columns')
  For each generated pair:
    P1: changeType is 'modified'
    P2: cellDiffs contain entries at column indices >= old grid colCount
    P3: Those cellDiffs have changeType 'added' with newValue set, oldValue undefined

property: column removal detection (N=200)
  Generator: generateTablePair('remove-columns')
  For each generated pair:
    P1: changeType is 'modified'
    P2: cellDiffs contain entries at column indices >= new grid colCount
    P3: Those cellDiffs have changeType 'removed' with oldValue set, newValue undefined
```

### AC-5: Added table (only in new filing)

```
property: added table detection (N=200)
  Generator: generateTableListPair('added')
  For each generated pair:
    P1: Result contains at least one TableDiff with changeType 'added'
    P2: Added TableDiffs have newTable set, oldTable undefined
    P3: Added TableDiffs have empty rowDiffs and cellDiffs
```

### AC-6: Removed table (only in old filing)

```
property: removed table detection (N=200)
  Generator: generateTableListPair('removed')
  For each generated pair:
    P1: Result contains at least one TableDiff with changeType 'removed'
    P2: Removed TableDiffs have oldTable set, newTable undefined
    P3: Removed TableDiffs have empty rowDiffs and cellDiffs
```

### AC-7: Unchanged tables

```
property: unchanged table detection (N=200)
  Generator: generateTableListPair('unchanged')
  For each generated pair:
    P1: All TableDiffs have changeType 'unchanged'
    P2: sourceMapping.old and sourceMapping.new are both populated
    P3: All summary.cellsChanged are 0
```

### Structural invariants (all mutations)

```
property: structural invariants hold for any table pair (N=200)
  Generator: generateTablePair(random mutation type)
  For each generated pair:
    P1: diffTable never throws
    P2: rowDiff row/col indices are within grid bounds
    P3: summary counts are internally consistent:
        rowsAdded + rowsRemoved + rowsModified + rowsUnchanged = total rows
    P4: cellDiffs flat list === flatMap of rowDiffs[].cellDiffs (no duplicates, no missing)
    P5: changeType is 'unchanged' iff summary.cellsChanged === 0
    P6: All sourceMapping offsets valid where present (start < end, within range)
```

---

## 2. Unit Tests

Three separate test files, one per module, following the implementation design's file structure.

### 2.1 Grid Normalization (`tests/unit/grid-normalizer.test.ts`)

Tests for `normalizeGrid(table: Table): NormalizedGrid`.

```
describe('normalizeGrid')
  it('simple table (no spans) produces 1:1 grid with all isOrigin=true')
  it('colspan=2 fills two adjacent columns with same cell ref; only first isOrigin=true')
  it('rowspan=2 fills two adjacent rows at same column; only first isOrigin=true')
  it('combined colspan=2 rowspan=2 fills a 2x2 block; only top-left isOrigin=true')
  it('grid dimensions: colCount = max logical width across all rows')
  it('irregular rows (different cell counts) padded with null in missing positions')
  it('empty table (0 rows) => rowCount=0, colCount=0, empty cells array')
  it('header-only table normalizes like any other table')
  it('overlapping spans (malformed HTML) clamp to grid bounds, skip occupied cells')
  it('single-cell table => 1x1 grid')
  it('colspan exceeding row width is clamped to remaining columns')
  it('rowspan exceeding table height is clamped to remaining rows')
```

### 2.2 Table Matching (`tests/unit/table-matcher.test.ts`)

Tests for `matchTables(oldTables, newTables, options?): TableMatchResult`.

```
describe('matchTables')
  it('same-count tables with identical headers matched by position, similarity=1.0')
  it('same-count tables with similar headers matched (e.g., year column change)')
  it('position-weighted: same-ordinal match preferred over higher-similarity non-ordinal')
  it('different-count tables: extra new table in added[], extra old in removed[]')
  it('no-header tables matched by position only')
  it('completely different headers (below 0.70 threshold) => all added + removed')
  it('custom similarityThreshold option is respected')
  it('empty old tables => all new tables are added')
  it('empty new tables => all old tables are removed')
  it('both empty => matched=[], added=[], removed=[]')
  it('single table in each list with matching headers => one match')
  it('header text is concatenated from all header rows for similarity')
```

### 2.3 Table Differ (`tests/unit/table-differ.test.ts`)

Tests for `diffTable(oldTable, newTable): TableDiff` and `diffTables(oldTables, newTables): TableDiff[]`.

#### Row Alignment (via fingerprints + diffArrays)

```
describe('row alignment')
  it('identical rows => all RowDiff changeType unchanged')
  it('inserted row in the middle => RowDiff with changeType added, newRowIndex set')
  it('removed row in the middle => RowDiff with changeType removed, oldRowIndex set')
  it('modified row (same position, different content) => changeType modified with cellDiffs')
  it('all rows different => all modified')
  it('row fingerprint uses pipe-delimited normalized cell text')
```

#### Cell Comparison

```
describe('cell comparison')
  it('identical text => unchanged, not in cellDiffs (flat list)')
  it('different text => modified with oldValue and newValue')
  it('empty vs non-empty => modified')
  it('numeric value change populates oldNumericValue and newNumericValue')
  it('numeric formatting change (same numericValue, different text) => unchanged')
  it('whitespace/nbsp normalized before comparison')
  it('non-origin cells in spans are skipped (no double-counting)')
```

#### Column Changes

```
describe('column detection')
  it('new grid has more columns => extra cols are added cells')
  it('old grid has more columns => extra cols are removed cells')
  it('same column count, different values => modified cells')
```

#### Numeric Diff

```
describe('numeric diff')
  it('$100 -> $120: modified, oldNumericValue=100, newNumericValue=120')
  it('$100 -> ($100): modified, sign change reflected in numeric values')
  it('em-dash (0) vs $0: unchanged (both numericValue=0)')
  it('"1,000" vs "1000": unchanged (same numericValue, formatting only)')
  it('non-numeric to numeric: modified, oldNumericValue undefined')
```

#### diffTables orchestration

```
describe('diffTables')
  it('calls matchTables then diffTable for each match')
  it('added tables have changeType added, empty rowDiffs/cellDiffs')
  it('removed tables have changeType removed, empty rowDiffs/cellDiffs')
  it('summary counts are consistent: rowsAdded + rowsRemoved + rowsModified + rowsUnchanged = total rows')
  it('cellDiffs (flat) is derived from rowDiffs (no duplicates, no missing)')
```

---

## 3. Integration Tests (`tests/integration/table-differ.integration.test.ts`)

### 3.1 Parse and Diff Two HTML Tables End-to-End

```
describe('table diff integration')
  it('parses two inline HTML documents with financial tables, diffs end-to-end')
    - Build two HTML docs with Item 8 section + tables
    - parseFiling() both
    - Extract Table blocks from matched sections
    - Call diffTables()
    - Assert cellDiffs reflect actual value changes

  it('full diffFilings() pipeline produces tableDiffs in sectionDiff')
    - Two documents with Item 8 sections
    - diffFilings() (full pipeline)
    - Assert sectionDiff.tableDiffs is populated
```

### 3.2 Source Mapping Round-Trip

```
  it('cellDiff sourceMapping.old/new point to correct HTML ranges')
    - For modified cellDiffs, html.slice(source.start, source.end) contains cell text
    - Both old and new source locations are valid

  it('tableDiff sourceMapping covers the full <table> element')
    - html.slice(tableSource.start, tableSource.end) starts with '<table'
```

### 3.3 Multiple Tables Within a Section

```
  it('diffs multiple tables within a single matched section')
    - Old section: 2 tables, new section: 2 tables
    - Assert 2 TableDiffs with correct matching

  it('handles different table counts (1 old, 2 new)')
    - Assert one matched + one added
```

---

## 4. End-to-End Tests (`tests/e2e/table-differ.e2e.test.ts`)

Full pipeline: raw HTML filing -> parseFiling() -> diffFilings() -> verify tableDiffs.

```
describe('table diff e2e')
  it('full pipeline with committed fixture HTML files')
    - Load two fixture HTMLs from tests/integration/fixtures/
    - parseFiling() both, diffFilings()
    - Assert tableDiffs exist in sectionDiffs
    - Assert no exceptions thrown

  it('tableDiff summary counts are internally consistent')
    - For each tableDiff:
      rowsAdded + rowsRemoved + rowsModified + rowsUnchanged = total rows processed
      cellDiffs.length = summary.cellsChanged

  it('all cellDiff source mappings are valid')
    - sourceMapping.old (if present): start < end, within html.length
    - sourceMapping.new (if present): start < end, within html.length

  it('cellDiffs flat list matches rowDiffs contents')
    - tableDiff.cellDiffs deep-equals flatMap of rowDiff.cellDiffs
```

---

## 5. Boundary Conditions

Include within `tests/unit/table-differ.test.ts`:

```
describe('boundary conditions')
  it('empty table vs empty table => unchanged, rowDiffs=[], summary all zeros')
  it('empty table vs non-empty table => modified, all rows added')
  it('non-empty vs empty => modified, all rows removed')
  it('single-cell table diff')
  it('single-row table diff')
  it('header-only table (all isHeader=true) vs same => unchanged')
  it('very large table (100 rows x 10 cols) completes without error')
  it('all cells identical => unchanged, summary.cellsChanged=0')
  it('all cells different => modified, every cell in cellDiffs')
```

---

## 6. Error Conditions

```
describe('error conditions')
  it('malformed table (parser output with missing cells) still produces a diff')
  it('table with no header rows diffs correctly (position-based matching)')
  it('mismatched colspan/rowspan creating irregular grid handled gracefully')
    - grid-normalizer pads with null; differ treats null cells as empty
  it('table with cells exceeding grid bounds does not throw')
    - Spans clamped by normalizer
  it('differ never throws (per architecture: no recoverable failure paths)')
    - Fuzz with random Table objects, assert no exceptions
```

---

## 7. Performance Criteria

```
describe('performance')
  it('diffTable completes in <100ms for typical financial table (50 rows x 5 cols)')
    - Two tables with ~30% cell changes
    - Assert elapsed < 100ms

  it('diffTable completes in <500ms for large table (100 rows x 10 cols)')
    - Assert elapsed < 500ms

  it('matchTables completes in <50ms for N <= 20 tables')
    - 20 table pairs
    - Assert elapsed < 50ms

  it('normalizeGrid completes in <10ms for 50-row table with spans')
    - Assert elapsed < 10ms
```

---

## 8. Test Data: Fixtures and Helpers

### 8.1 Helper Functions

Create in `tests/helpers/table-diff-helpers.ts`:

```typescript
import type { Table, TableRow, TableCell, SourceLocation } from '../../src/types.js';

/** Build a Table object for testing (bypasses HTML parsing). */
function makeTable(rows: TableRow[], source?: SourceLocation): Table

/** Build a TableRow for testing. */
function makeTableRow(
  cells: TableCell[],
  opts?: { isHeader?: boolean; source?: SourceLocation }
): TableRow

/** Build a TableCell for testing. */
function makeTableCell(
  text: string,
  opts?: { numericValue?: number; colspan?: number; rowspan?: number; source?: SourceLocation }
): TableCell

/** Build a simple financial table with label column + value columns.
 *  Automatically populates numericValue via tryParseNumeric pattern. */
function makeFinancialTable(data: {
  headers: string[];
  rows: Array<{ label: string; values: string[] }>;
}): Table
```

### 8.2 Inline HTML Fixtures (Unit Tests)

Each unit test uses inline HTML strings under 30 lines:

```typescript
const oldTableHtml = `<table>
  <tr><th>Metric</th><th>2023</th></tr>
  <tr><td>Revenue</td><td>$100</td></tr>
  <tr><td>Income</td><td>$20</td></tr>
</table>`;

const newTableHtml = `<table>
  <tr><th>Metric</th><th>2024</th></tr>
  <tr><td>Revenue</td><td>$120</td></tr>
  <tr><td>Income</td><td>$20</td></tr>
</table>`;
```

### 8.3 Committed Fixture Files (Integration/E2E)

Reuse existing fixtures in `tests/integration/fixtures/`. Reuse `makeRawFiling(html)` from `tests/helpers/ground-truth.ts`.

### 8.4 Property-Based Acceptance Tests

File: `tests/acceptance/table-differ.acceptance.test.ts`
Generator: `tests/acceptance/table-diff-generator.ts`

Follows the same pattern as `table-extractor.acceptance.test.ts` + `table-html-generator.ts`:

**Generator design** (`generateTablePair(mutation)`):
1. Uses the existing `generateTable()` to create a base table HTML
2. Parses via `parseFiling(makeRawFiling(wrapInSection(html)))` to get a real `Table` object
3. Clones and applies the specified mutation to create the "new" `Table`
4. Returns `{ oldTable, newTable, expectedMutation }` with metadata about what was changed

**Mutation types:**
- `'none'` — deep clone, no changes → expect unchanged
- `'cell-values'` — randomly pick N cells and change their text/numericValue → expect modified cells
- `'add-rows'` — insert 1-3 new rows at random positions → expect added rows
- `'remove-rows'` — remove 1-3 rows at random positions → expect removed rows
- `'add-columns'` — append 1-2 columns to every row → expect added columns
- `'remove-columns'` — remove last 1-2 columns from every row → expect removed columns
- `'mixed'` — combine multiple mutations → expect modified table

**Table list generator** (`generateTableListPair(scenario)`):
- Generates pairs of `Table[]` for testing `matchTables()` / `diffTables()`:
  - `'matched'` — same count, same headers
  - `'shifted'` — insert new table at start of new list
  - `'added'` — new list has extra table
  - `'removed'` — old list has extra table
  - `'unchanged'` — identical lists

**Test count:** N=200 per scenario (configurable via `TABLE_DIFF_TEST_COUNT` env var).

Each AC scenario (section 1) maps to a `describe` block that pre-generates N test cases and uses `it.each()` to run property assertions, exactly as the existing table-extractor acceptance tests do.

---

## Module Interface Summary

| Module | File | Entry Point | Tested In |
|--------|------|-------------|-----------|
| Grid normalizer | `src/diff/grid-normalizer.ts` | `normalizeGrid(table): NormalizedGrid` | `tests/unit/grid-normalizer.test.ts` |
| Table matcher | `src/diff/table-matcher.ts` | `matchTables(old, new, opts?): TableMatchResult` | `tests/unit/table-matcher.test.ts` |
| Table differ | `src/diff/table-differ.ts` | `diffTable(old, new): TableDiff` | `tests/unit/table-differ.test.ts` |
| Orchestrator | `src/diff/table-differ.ts` | `diffTables(old[], new[]): TableDiff[]` | `tests/unit/table-differ.test.ts` |
| Diff engine integration | `src/diff/diff-engine.ts` | `diffFilings(oldDoc, newDoc): StructuredDiff` | `tests/integration/`, `tests/e2e/` |

All three modules (`grid-normalizer`, `table-matcher`, `table-differ`) export their functions directly and get dedicated unit test files. The `diffTables()` orchestrator is tested both in isolation and through the full pipeline.
