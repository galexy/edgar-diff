---
title: "US-1.7: Table-Level Diffs — Implementation Design"
story: edgar-diff-vda.8
created: "2026-03-07"
status: draft
---

# US-1.7: Compute Table-Level Diffs — Implementation Design

## 1. Approach

Table-level diffing proceeds in four phases:

### Phase 1: Table Matching (`table-matcher.ts`)

Match tables between old and new filing sections. Within each matched section pair (already aligned by the section-aligner), tables at the same ordinal position are candidate matches. Confirm matches using Jaro-Winkler similarity on concatenated header-row text (threshold >= 0.70). Tables that fail header similarity are treated as removed + added pairs.

**Algorithm:**
1. For each matched `SectionDiff`, extract `Table` blocks from `oldSection.blocks` and `newSection.blocks`.
2. Build a similarity matrix: for each (oldTable[i], newTable[j]), compute `jaroWinkler(headerText(oldTable[i]), headerText(newTable[j]))`.
3. Apply a position-weighted greedy match: prefer same-ordinal matches, then fall back to best similarity above threshold.
4. Unmatched old tables are `removed`; unmatched new tables are `added`.

**Why hybrid position + similarity:** Tables in SEC filings are typically in a stable order within sections (e.g., the balance sheet always precedes the income statement within Item 8). Position gives strong signal; header similarity confirms and handles edge cases where tables are reordered or renamed.

### Phase 2: Grid Normalization (`grid-normalizer.ts`)

Expand `colspan` and `rowspan` into a flat rectangular grid so that every (row, col) coordinate maps to exactly one logical cell. This enables direct positional comparison.

**Algorithm:**
1. Determine grid dimensions: total rows = `table.rows.length`; total columns = max logical width accounting for all colspans.
2. Create a 2D array `grid[row][col]` of cell references.
3. Walk each row's cells in order. For each cell, find the next unoccupied column in the current row. Fill `grid[row..row+rowspan-1][col..col+colspan-1]` with a reference to this cell.
4. Return a `NormalizedGrid` with the flat grid and dimensions.

### Phase 3: Row Alignment

Before cell-by-cell comparison, align rows between the old and new grids. Rows may be added, removed, or reordered.

**Algorithm:**
1. Compute a fingerprint for each row: concatenation of normalized cell text values, pipe-delimited.
2. Use `diffArrays` from the `diff` npm package on the old and new row fingerprint arrays.
3. The diff output gives aligned row pairs (unchanged/modified) plus added/removed rows.
4. For unchanged rows, no cell diffs are needed. For modified rows, proceed to Phase 4.

### Phase 4: Cell-by-Cell Diff

For each pair of aligned rows, compare cells at each column position in the normalized grids.

**Algorithm:**
1. Walk columns 0..max(oldCols, newCols).
2. If column exists only in new grid: column added. Only in old: column removed.
3. If both exist, compare cell text:
   - Identical text: `unchanged`.
   - Different text: `modified`. If both have `numericValue`, include both values for magnitude-change detection.
4. Emit a `CellDiff` for every cell that is not `unchanged`.
5. Aggregate into a `TableDiff` with overall `changeType` based on whether any cells changed.

---

## 2. Files to Create/Modify

### New Files

| File | Responsibility |
|---|---|
| `src/diff/types.ts` | `ChangeType`, `DiffRange`, `CellDiff`, `RowDiff`, `TableDiff` types |
| `src/diff/table-matcher.ts` | Match tables across old/new sections by position + header similarity |
| `src/diff/grid-normalizer.ts` | Expand colspan/rowspan into a flat `NormalizedGrid` |
| `src/diff/table-differ.ts` | Orchestrate row alignment + cell-by-cell diff for a matched table pair |
| `src/diff/index.ts` | Barrel exports for the diff module |

### Modified Files

| File | Change |
|---|---|
| `src/index.ts` | Add `export * from './diff/index.js'` for public API surface |

**Note:** `src/diff/` does not exist yet and must be created.

---

## 3. Interfaces and Types

```typescript
// ── src/diff/types.ts ──

/** Re-export shared types used by consumers */
import type { SourceLocation, Table, TableRow, TableCell } from '../types.js';

export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface DiffRange {
  old?: SourceLocation;
  new?: SourceLocation;
}

export interface CellDiff {
  /** Row index in the normalized grid (0-based). */
  row: number;
  /** Column index in the normalized grid (0-based). */
  col: number;
  changeType: ChangeType;
  oldValue?: string;
  newValue?: string;
  /** Numeric values when both cells are numeric (for magnitude-change detection). */
  oldNumericValue?: number;
  newNumericValue?: number;
  sourceMapping: DiffRange;
}

export interface RowDiff {
  /** Row index in the respective grid. */
  oldRowIndex?: number;
  newRowIndex?: number;
  changeType: ChangeType;
  cellDiffs: CellDiff[];
}

export interface TableDiff {
  changeType: ChangeType;
  oldTable?: Table;
  newTable?: Table;
  rowDiffs: RowDiff[];
  /** Flat list of all cell-level changes (convenience accessor, derived from rowDiffs). */
  cellDiffs: CellDiff[];
  sourceMapping: DiffRange;
  summary: {
    rowsAdded: number;
    rowsRemoved: number;
    rowsModified: number;
    rowsUnchanged: number;
    cellsChanged: number;
  };
}

// ── src/diff/grid-normalizer.ts ──

export interface NormalizedCell {
  /** Reference to the original TableCell. */
  cell: TableCell;
  /** Whether this grid position is the "origin" of the cell (top-left of its span). */
  isOrigin: boolean;
}

export interface NormalizedGrid {
  cells: (NormalizedCell | null)[][];
  rowCount: number;
  colCount: number;
  /** Original table reference. */
  table: Table;
}

// ── src/diff/table-matcher.ts ──

export interface TableMatch {
  oldTable: Table;
  newTable: Table;
  similarity: number;
}

export interface TableMatchResult {
  matched: TableMatch[];
  added: Table[];
  removed: Table[];
}
```

---

## 4. Data Flow

```
Section-aligned filing pair
       |
       v
┌─────────────────────┐
│   table-matcher.ts   │  Extract Table blocks from matched sections;
│                       │  match by position + Jaro-Winkler on headers
└──────────┬────────────┘
           |
           v
    TableMatch[] + added[] + removed[]
           |
           v
┌─────────────────────────┐
│   grid-normalizer.ts     │  For each matched pair, expand colspan/rowspan
│                           │  into flat NormalizedGrid for old and new
└──────────┬──────────────┘
           |
           v
    (NormalizedGrid_old, NormalizedGrid_new)
           |
           v
┌─────────────────────────┐
│   table-differ.ts        │  1. Compute row fingerprints
│                           │  2. Align rows via diffArrays
│                           │  3. Cell-by-cell comparison on aligned rows
│                           │  4. Detect column additions/removals
└──────────┬──────────────┘
           |
           v
      TableDiff[]
```

The `diff-engine.ts` orchestrator (already planned in architecture) will call `matchTables()` per section pair, then `diffTable()` per matched pair, and assemble the results into `SectionDiff.tableDiffs`.

---

## 5. Dependencies

| Package | Usage | Already in package.json? |
|---|---|---|
| `diff` (^8.0.3) | `diffArrays` for row alignment by fingerprint | Yes |
| `jaro-winkler` (^0.2.8) | Header text similarity for table matching | Yes |

No new dependencies required.

---

## 6. Key Function Signatures

```typescript
// grid-normalizer.ts
export function normalizeGrid(table: Table): NormalizedGrid;

// table-matcher.ts
export function matchTables(
  oldTables: Table[],
  newTables: Table[],
  options?: { similarityThreshold?: number },
): TableMatchResult;

// table-differ.ts
export function diffTable(
  oldTable: Table,
  newTable: Table,
): TableDiff;

export function diffTables(
  oldTables: Table[],
  newTables: Table[],
): TableDiff[];
```

`diffTables` is the main entry point called by the diff engine. It internally calls `matchTables` then `diffTable` for each matched pair, and produces `TableDiff` entries for added/removed tables as well.

---

## 7. Edge Cases

| Case | Handling |
|---|---|
| **Empty tables** (no rows) | Match by position only (no header text). `diffTable` returns `unchanged` with empty `rowDiffs`. |
| **Header-only tables** (all rows are headers) | Treated normally; header rows participate in row alignment like any other row. |
| **Single-cell tables** | Grid normalization produces a 1x1 grid. Cell diff works as usual. |
| **Different row/column counts** | Row alignment via `diffArrays` handles different row counts naturally (added/removed rows). Column differences detected during cell comparison by iterating to `max(oldCols, newCols)`. |
| **Complex colspan/rowspan** | Grid normalizer fills all spanned positions. Comparison uses the origin cell's values; non-origin positions are skipped to avoid double-counting. |
| **Overlapping spans (malformed HTML)** | If a cell's span would overflow grid bounds, clamp to grid dimensions. If a position is already occupied, skip (log a parse warning). |
| **Numeric formatting changes** | When both cells have `numericValue` and the numeric values are equal but text differs (e.g., `"1,000"` vs `"1000"`), mark as `unchanged` (formatting-only). When numeric values differ, include both in `CellDiff` for magnitude analysis. |
| **Tables in one filing only** | Unmatched tables from `table-matcher` are emitted as `added` or `removed` `TableDiff` entries with no cell-level diffs. |
| **Whitespace / non-breaking space differences** | Normalize cell text (collapse whitespace, trim, replace `\u00a0` with space) before comparison, matching the existing `table-extractor.ts` normalization. |

---

## 8. Testing Strategy

### Unit Tests

| Test area | Key scenarios |
|---|---|
| `grid-normalizer` | Simple table (no spans); table with colspan=2; table with rowspan=3; combined colspan+rowspan; irregular/malformed spans clamped; empty table |
| `table-matcher` | Same-count tables matched by position; different-count tables matched by header similarity; no-header tables matched by position only; completely different tables all added/removed; threshold boundary cases |
| `table-differ` | Identical tables -> unchanged; single cell change; row added/removed; column added/removed; numeric formatting change (same value, different text); mixed changes across multiple rows |

### Integration Tests

- Parse two consecutive 10-K filings for the same company, extract tables, run `diffTables`, verify:
  - Known financial table is matched and diffed
  - Summary counts are sensible (not all-changed, not all-unchanged)
  - Source mappings are valid (offsets within HTML bounds)

### Fuzz / Property Tests

- Generate random tables with random colspan/rowspan values
- Assert: `normalizeGrid` never throws; grid dimensions are consistent; all origin cells are accounted for
- Generate pairs of random tables, run `diffTable`, assert: no exceptions; `cellDiffs` row/col are within grid bounds; summary counts are internally consistent

---

## 9. Design Clarifications

**Column addition/removal in CellDiff:** When a new table has more columns than old, cells in the extra columns get `changeType: 'added'` with `oldValue: undefined`, `newValue` set. Vice versa for removed columns (`changeType: 'removed'`, `oldValue` set, `newValue: undefined`). These CellDiffs are grouped under the corresponding `RowDiff` for the row they belong to.

**RowDiffs/cellDiffs for added/removed tables:** For `TableDiff` entries with `changeType: 'added'` or `'removed'`, `rowDiffs` and `cellDiffs` are empty arrays `[]` (not undefined). The `oldTable`/`newTable` reference carries the full table data; cell-level diffing is not meaningful for unmatched tables. Empty arrays simplify consumer code (no null checks).

**Row fingerprint format:** Fingerprints use pipe-delimited normalized cell text: `"Revenue|$100|$20"`. Empty cells produce empty segments: `"|Revenue||"`. No special handling — empty segments are intentional and preserve positional information for accurate alignment.

---

## 10. Open Questions

1. **Column alignment strategy:** Current design compares columns by position in the normalized grid. Should we also support column reordering detection (e.g., columns swapped between filings)? The architecture doc does not mention this. **Recommendation:** Defer column reordering to a future enhancement; positional comparison covers the common case for SEC financial tables where column order is stable (typically year columns in fixed positions).

2. **Nested tables:** SEC filings sometimes use nested tables for layout. Should the differ recurse into nested tables? **Recommendation:** The parser's `table-extractor` already handles this at the extraction level. If nested tables are extracted as separate `Table` blocks, they'll be matched independently. If they're part of a parent table's cells, the cell text comparison covers them. No special handling needed in the differ.

3. **Large table performance:** Some SEC filings have tables with 100+ rows (detailed financial schedules). Row alignment via `diffArrays` is O(ND) which should be acceptable for typical sizes. **Recommendation:** No optimization needed initially; add benchmarks in integration tests to catch regressions.
