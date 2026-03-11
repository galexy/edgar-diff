# BQ6: Slim Down StructuredDiff Output — Implementation Design

## Problem

The current `StructuredDiff` output embeds full source objects (`FilingSection`, `Paragraph`, `Table`, `RawFiling` with `html`) at every level of the diff tree. A trivial change between two 10-K filings produces ~22 MB of JSON because every diff node carries the complete parsed content. Target: ~0.2 MB for typical diffs.

The source content is redundant — consumers already have the parsed documents and can look up any element via `sourceMapping` (the `DiffRange` containing `SourceLocation` offsets into the original HTML). The diff output should contain only **what changed** and **where to find it**, not the source content itself.

## Approach

**Strategy: Remove embedded source objects; keep diff data + source mappings.**

This is a breaking change to the public API. The approach is:

1. **Remove embedded source objects** from `SectionDiff`, `ParagraphDiff`, and `TableDiff` type definitions
2. **Strip the `html` field** from `RawFiling` at the top level, keeping only metadata (introduce `DiffFilingMetadata` type)
3. **Filter out unchanged elements** — unchanged paragraphs, tables, and table rows add no information to a diff and are the primary source of bloat
4. **Preserve all diff-meaningful data** — `changeType`, `wordChanges`, `cellDiffs`, `rowDiffs`, `sourceMapping`, `summary`

### Why not a separate "slim" mode?

A configuration flag (`{ slim: true }`) would double the type surface and test matrix. Since consumers can always reconstruct the embedded objects from the source documents + source mappings, there's no information loss. A clean break is simpler.

## Type Changes

### 1. `StructuredDiff` — strip `html` from filing references

**Before:**
```typescript
export interface StructuredDiff {
  oldFiling: RawFiling;       // includes html: string (megabytes)
  newFiling: RawFiling;       // includes html: string (megabytes)
  sectionDiffs: SectionDiff[];
  summary: { added: number; removed: number; modified: number; unchanged: number; reordered: number };
  generatedAt: Temporal.Instant;
}
```

**After:**
```typescript
export interface DiffFilingMetadata {
  accessionNumber: string;
  cik: string;
  formType: FormType;
  filingDate: Temporal.PlainDate;
  primaryDocumentFilename: string;
  fetchedAt: Temporal.Instant;
}

export interface StructuredDiff {
  oldFiling: DiffFilingMetadata;   // no html field
  newFiling: DiffFilingMetadata;   // no html field
  sectionDiffs: SectionDiff[];
  summary: { added: number; removed: number; modified: number; unchanged: number; reordered: number };
  generatedAt: Temporal.Instant;
}
```

`DiffFilingMetadata` is `Omit<RawFiling, 'html'>` as a named type. It lives in `diff/types.ts` alongside the other diff types, with `FormType` imported from `client/types.ts`.

**Naming note:** There is an existing `FilingMetadata` in `client/types.ts` (lines 69-74) used internally for EFTS search results with a different shape (`formType: string`, `filingDate: string`). The diff-specific type is named `DiffFilingMetadata` to avoid confusion. Since they live in different modules (`client/types.ts` vs `diff/types.ts`), there is no import-level collision.

### 2. `SectionDiff` — remove embedded sections

**Before:**
```typescript
export interface SectionDiff {
  id: string;
  heading: string;
  changeType: ChangeType;
  oldSection?: FilingSection;     // REMOVE
  newSection?: FilingSection;     // REMOVE
  paragraphDiffs: ParagraphDiff[];
  tableDiffs: TableDiff[];
  subsectionDiffs: SectionDiff[];
  sourceMapping: DiffRange;
}
```

**After:**
```typescript
export interface SectionDiff {
  id: string;
  heading: string;
  changeType: ChangeType;
  paragraphDiffs: ParagraphDiff[];  // only changed paragraphs
  tableDiffs: TableDiff[];          // only changed tables
  subsectionDiffs: SectionDiff[];
  sourceMapping: DiffRange;
}
```

### 3. `ParagraphDiff` — remove embedded paragraphs

**Before:**
```typescript
export interface ParagraphDiff {
  changeType: ChangeType;
  oldParagraph?: Paragraph;     // REMOVE
  newParagraph?: Paragraph;     // REMOVE
  wordChanges?: WordChange[];
  sourceMapping: DiffRange;
}
```

**After:**
```typescript
export interface ParagraphDiff {
  changeType: ChangeType;
  wordChanges?: WordChange[];
  sourceMapping: DiffRange;
}
```

### 4. `TableDiff` — remove embedded tables

**Before:**
```typescript
export interface TableDiff {
  changeType: ChangeType;
  oldTable?: Table;             // REMOVE
  newTable?: Table;             // REMOVE
  rowDiffs: RowDiff[];
  cellDiffs: CellDiff[];
  sourceMapping: DiffRange;
  summary: { rowsAdded: number; rowsRemoved: number; rowsModified: number; rowsUnchanged: number; cellsChanged: number };
}
```

**After:**
```typescript
export interface TableDiff {
  changeType: ChangeType;
  rowDiffs: RowDiff[];          // only changed rows
  cellDiffs: CellDiff[];        // derived from changed rowDiffs only
  sourceMapping: DiffRange;
  summary: { rowsAdded: number; rowsRemoved: number; rowsModified: number; rowsUnchanged: number; cellsChanged: number };
}
```

### 5. Types NOT changed

- `ChangeType` — unchanged
- `DiffRange` / `SourceLocation` — unchanged (these are the key to source lookups)
- `CellDiff` — unchanged (already contains only diff data + sourceMapping)
- `RowDiff` — unchanged (already contains only diff data)
- `WordChange` — unchanged
- `NormalizedGrid`, `NormalizedCell`, `TableMatch`, `TableMatchResult` — internal types, unchanged
- `RawFiling` — unchanged (it's a client type; we just stop referencing it from diff output)

## Files to Modify

### 1. `libs/edgar-diff-lib/src/diff/types.ts` — Type definitions

**Changes:**
- Add `DiffFilingMetadata` interface (new type, ~7 lines)
- Add `import type { FormType } from '../client/types.js'` for `DiffFilingMetadata`
- Remove `oldSection?` / `newSection?` from `SectionDiff`
- Remove `oldParagraph?` / `newParagraph?` from `ParagraphDiff`
- Remove `oldTable?` / `newTable?` from `TableDiff`
- Update `StructuredDiff.oldFiling` / `newFiling` from `RawFiling` to `DiffFilingMetadata`
- Remove unused imports: `FilingSection`, `Paragraph`, `Table` (no longer referenced)
- Keep `TableCell` import (still used by `NormalizedCell`)

### 2. `libs/edgar-diff-lib/src/diff/diff-engine.ts` — Orchestrator

**Changes:**

a) **Add `toDiffFilingMetadata()` helper:**
```typescript
function toDiffFilingMetadata(filing: RawFiling): DiffFilingMetadata {
  return {
    accessionNumber: filing.accessionNumber,
    cik: filing.cik,
    formType: filing.formType,
    filingDate: filing.filingDate,
    primaryDocumentFilename: filing.primaryDocumentFilename,
    fetchedAt: filing.fetchedAt,
  };
}
```

b) **Update `makeSectionDiff()` return value:**
- Remove `oldSection` and `newSection` properties from the returned object
- Filter `paragraphDiffs` to exclude `changeType === 'unchanged'` (filtering happens HERE, not in `diffParagraphs()`)
- Filter `tableDiffs` to exclude `changeType === 'unchanged'` (filtering happens HERE, not in `diffTables()`)

```typescript
// In makeSectionDiff():
const allParagraphDiffs = options.match ? diffParagraphs(options.match) : [];
const paragraphDiffs = allParagraphDiffs.filter(pd => pd.changeType !== 'unchanged');

// ... compute tableDiffs via diffTables() ...
tableDiffs = tableDiffs.filter(td => td.changeType !== 'unchanged');
```

c) **Update `diffFilings()` return value:**
- Replace `oldDoc.filing` with `toDiffFilingMetadata(oldDoc.filing)`
- Replace `newDoc.filing` with `toDiffFilingMetadata(newDoc.filing)`

d) **Update imports:**
- Add `DiffFilingMetadata` import from `./types.js`
- Add `RawFiling` import from `../client/types.js` (for the helper parameter type)

e) **`toDiffFilingMetadata()` is independently testable:**
- Input: `RawFiling` with large `html` string
- Output: `DiffFilingMetadata` with all metadata fields, `html` key **absent** (not just `undefined`)
- Should have a direct unit test in `diff-engine.test.ts`

### 3. `libs/edgar-diff-lib/src/diff/paragraph-differ.ts` — Paragraph diffing

**Changes:**

Remove all `oldParagraph` / `newParagraph` assignments from `ParagraphDiff` construction. This affects:

- `diffParagraphPair()` — unchanged case (lines 44-55): remove `oldParagraph` and `newParagraph`
- `diffParagraphPair()` — removed case (lines 57-63): remove `oldParagraph`
- `diffParagraphPair()` — added case (lines 65-73): remove `newParagraph`
- `pairRemovedAdded()` — modified case (lines 95-104): remove `oldParagraph` and `newParagraph`
- `detectMoves()` — moved entries (lines 159-164 and 241-249): remove `oldParagraph` and `newParagraph`

**Important:** The paragraph objects are still _read_ internally during diffing (for `.text` and `.source`). Only the output assignments are removed. Internal variable references (`oldPara`, `newPara`, `changes[i].oldParagraph`) remain valid during computation — we just don't include them in the returned `ParagraphDiff`.

**Implementation note:** Since `oldParagraph`/`newParagraph` are removed from the type, existing code that reads `changes[i].oldParagraph` in `pairRemovedAdded` and `detectMoves` will need refactoring. These functions build intermediate `ParagraphDiff` arrays, then transform them. Currently `pairRemovedAdded` reads `changes[i].oldParagraph` and `changes[i+1].newParagraph` to extract text for word-change computation. Similarly `detectMoves` reads `.oldParagraph` and `.newParagraph` to extract text for Jaro-Winkler comparison.

**Refactoring approach:** Change the internal representation to carry paragraphs through the pipeline, then strip them at the boundary. Introduce a local `InternalParagraphDiff` type:

```typescript
interface InternalParagraphDiff extends ParagraphDiff {
  /** Carried through the pipeline for intermediate computation; stripped before return. */
  _oldParagraph?: Paragraph;
  _newParagraph?: Paragraph;
}
```

All internal functions (`diffParagraphPair`, `pairRemovedAdded`, `detectMoves`) work with `InternalParagraphDiff`. The public `diffParagraphs()` function strips `_oldParagraph` / `_newParagraph` before returning.

**Note on filtering:** `diffParagraphs()` does NOT filter unchanged entries — it returns the complete set of paragraph diffs (including `changeType: 'unchanged'`). Unchanged paragraph filtering happens in `makeSectionDiff()` in `diff-engine.ts`. This keeps `diffParagraphs()` as a pure diff function that's independently testable.

```typescript
export function diffParagraphs(match: SectionMatch): ParagraphDiff[] {
  const oldParagraphs = extractParagraphs(match.oldSection.blocks);
  const newParagraphs = extractParagraphs(match.newSection.blocks);
  const internal = diffParagraphPair(oldParagraphs, newParagraphs);
  // Strip internal fields but keep all entries (including unchanged)
  return internal.map(({ _oldParagraph, _newParagraph, ...diff }) => diff);
}
```

### 4. `libs/edgar-diff-lib/src/diff/table-differ.ts` — Table diffing

**Changes:**

Remove all `oldTable` / `newTable` assignments from `TableDiff` construction:

- `diffTable()` — empty tables case (line 121-122): remove `oldTable`, `newTable`
- `diffTable()` — final return (lines 251-252): remove `oldTable`, `newTable`
- `diffTables()` — added tables (line 277): remove `newTable`
- `diffTables()` — removed tables (line 289): remove `oldTable`

Additionally, **filter unchanged rows** from `rowDiffs` inside `diffTable()`:

- In `diffTable()`, after computing `rowDiffs`, filter out rows where `changeType === 'unchanged'`
- The `summary` counts must still reflect the original counts (computed before filtering)
- The `cellDiffs` flat list is derived from the filtered `rowDiffs` (only changed cells)

```typescript
// Compute summary BEFORE filtering (counts must reflect full picture)
const allRowDiffs = rowDiffs; // computed as before
const rowsAdded = allRowDiffs.filter(rd => rd.changeType === 'added').length;
const rowsRemoved = allRowDiffs.filter(rd => rd.changeType === 'removed').length;
const rowsModified = allRowDiffs.filter(rd => rd.changeType === 'modified').length;
const rowsUnchanged = allRowDiffs.filter(rd => rd.changeType === 'unchanged').length;

// Filter AFTER summary
const changedRowDiffs = allRowDiffs.filter(rd => rd.changeType !== 'unchanged');
const cellDiffs = changedRowDiffs.flatMap(rd => rd.cellDiffs);
const cellsChanged = cellDiffs.length;

return {
  changeType,
  rowDiffs: changedRowDiffs,
  cellDiffs,
  sourceMapping,
  summary: { rowsAdded, rowsRemoved, rowsModified, rowsUnchanged, cellsChanged },
};
```

**Note on table-level filtering:** `diffTables()` does NOT filter unchanged tables — it returns the complete set (including `changeType: 'unchanged'`). Table-level filtering happens in `makeSectionDiff()` in `diff-engine.ts`. This is consistent with the paragraph-differ approach.

Also, in `diff-engine.ts` `makeSectionDiff()` — the inline `TableDiff` objects for added/removed sections (lines 59-66 and 68-75) currently include `newTable: table` and `oldTable: table`. Remove these assignments.

### 5. `libs/edgar-diff-lib/src/diff/index.ts` — Barrel exports

**Changes:**
- Export `DiffFilingMetadata` type from `./types.js`

### 6. `libs/edgar-diff-lib/src/index.ts` — Public API re-exports

**Changes:**
- Export `DiffFilingMetadata` type (add to the diff type re-exports)

### 7. Test files — Update assertions

Multiple test files reference `oldSection`, `newSection`, `oldParagraph`, `newParagraph`, `oldTable`, `newTable` in their assertions. These all need updating:

| Test file | Changes needed |
|-----------|---------------|
| `tests/unit/diff-filings.test.ts` | Remove assertions on `oldSection`/`newSection`, `oldFiling.html`/`newFiling.html`; update to `DiffFilingMetadata` shape |
| `tests/unit/diff/diff-engine.test.ts` | Same as above |
| `tests/unit/paragraph-differ.test.ts` | Remove assertions on `oldParagraph`/`newParagraph`; verify `sourceMapping` instead |
| `tests/unit/table-differ.test.ts` | Remove assertions on `oldTable`/`newTable`; verify unchanged rows are filtered out |
| `tests/integration/diff-pipeline.integration.test.ts` | Update end-to-end assertions |
| `tests/integration/table-differ.integration.test.ts` | Update table diff assertions |
| `tests/integration/paragraph-differ.integration.test.ts` | Update paragraph diff assertions |
| `tests/acceptance/diff/section-diff.acceptance.test.ts` | Update section diff assertions |
| `tests/acceptance/table-differ.acceptance.test.ts` | Update table diff assertions |
| `tests/acceptance/paragraph-differ.acceptance.test.ts` | Update paragraph diff assertions |
| `tests/e2e/diff/diff-pipeline.e2e.test.ts` | Update end-to-end assertions |
| `tests/e2e/examples.e2e.test.ts` | Update if examples reference removed fields |

### 8. Example scripts — `examples/*.ts`

Any example scripts that reference `oldSection`, `newSection`, `oldParagraph`, `newParagraph`, `oldTable`, `newTable`, or `result.oldFiling.html` must be updated.

## Data Flow

```
diffFilings(oldDoc, newDoc, options?)
  │
  ├── alignSections(oldDoc.sections, newDoc.sections)
  │     → { matched, added, removed }
  │
  ├── For each matched section (in new-filing order):
  │     makeSectionDiff(changeType, { oldSection, newSection, match })
  │       ├── diffParagraphs(match)
  │       │     → ParagraphDiff[] (unchanged paragraphs already excluded)
  │       ├── extractTables(old/new blocks)
  │       ├── diffTables(oldTables, newTables)
  │       │     → TableDiff[] (unchanged rows already filtered within each)
  │       ├── Filter out unchanged paragraphDiffs  ← NEW
  │       └── Filter out unchanged tableDiffs      ← NEW
  │
  ├── For each added section:
  │     makeSectionDiff('added', { newSection })
  │       └── Tables → TableDiff[] with changeType: 'added' (no oldTable/newTable)
  │
  ├── For each removed section:
  │     makeSectionDiff('removed', { oldSection })
  │       └── Tables → TableDiff[] with changeType: 'removed' (no oldTable/newTable)
  │
  ├── buildSummary(sectionDiffs)   ← unchanged
  │
  └── Return StructuredDiff {
        oldFiling: toDiffFilingMetadata(oldDoc.filing),   ← NEW: stripped
        newFiling: toDiffFilingMetadata(newDoc.filing),   ← NEW: stripped
        sectionDiffs,                                  ← slimmed
        summary,
        generatedAt
      }
```

## Filtering Logic

### Filtering layering

Filtering happens at specific architectural boundaries, separating diff algorithm concerns from output assembly:

| What's filtered | Where | Why |
|----------------|-------|-----|
| Unchanged paragraphs | `makeSectionDiff()` in `diff-engine.ts` | Output assembly concern, not diff algorithm |
| Unchanged tables | `makeSectionDiff()` in `diff-engine.ts` | Same — `diffTables()` returns the complete picture |
| Unchanged rows | `diffTable()` in `table-differ.ts` | Part of `TableDiff` construction (rows are internal to a table) |
| `html` field | `toDiffFilingMetadata()` in `diff-engine.ts` | Stripped when building `StructuredDiff` |

**Key principle:** `diffParagraphs()` and `diffTables()` remain complete diff functions — they return **all** entries including unchanged. Filtering unchanged paragraphs and tables is applied at the `SectionDiff` assembly point in `makeSectionDiff()`. This keeps the diff algorithms pure and testable independently.

Row filtering is different: it happens inside `diffTable()` because rows are internal to a `TableDiff` — they're part of the `TableDiff` construction, not a separate assembly step.

### Unchanged paragraphs

In `makeSectionDiff()`, after calling `diffParagraphs(match)`:

```typescript
const allParagraphDiffs = options.match ? diffParagraphs(options.match) : [];
const paragraphDiffs = allParagraphDiffs.filter(pd => pd.changeType !== 'unchanged');
```

`diffParagraphs()` itself still returns unchanged entries (with `oldParagraph`/`newParagraph` stripped via `InternalParagraphDiff`). This means unit tests for `diffParagraphs()` can verify the complete diff result without needing to go through `diffFilings()`.

### Unchanged tables

In `makeSectionDiff()`, after computing `tableDiffs`:

```typescript
tableDiffs = tableDiffs.filter(td => td.changeType !== 'unchanged');
```

`diffTables()` itself still returns unchanged tables (with `oldTable`/`newTable` stripped). Filtering is applied at the `SectionDiff` level.

### Unchanged rows within tables

In `diffTable()` in `table-differ.ts`, filter rows after computing summary:

```typescript
// 1. Compute row diffs as before (including unchanged)
// 2. Compute summary counts from all rows
// 3. Filter to only changed rows
const changedRowDiffs = rowDiffs.filter(rd => rd.changeType !== 'unchanged');
// 4. Derive cellDiffs from changed rows only
const cellDiffs = changedRowDiffs.flatMap(rd => rd.cellDiffs);
```

The `summary.rowsUnchanged` count is preserved — consumers know how many rows were unchanged even though they're not in the output.

### Reordered sections

Sections with `changeType: 'reordered'` are NOT filtered — they represent a meaningful change (position change). Only `'unchanged'` entries are filtered. This applies at all levels: paragraphs with `'moved'` changeType and tables with `'modified'` changeType are all preserved.

### Added/removed sections

For added and removed sections, all child elements have non-unchanged change types (`'added'` or `'removed'`), so filtering has no effect. These are already correct.

## Public API Impact

### Breaking changes for consumers of `diffFilings()`

| Change | Migration |
|--------|-----------|
| `StructuredDiff.oldFiling` / `newFiling` type changes from `RawFiling` to `DiffFilingMetadata` | Consumers accessing `.html` must get it from the original `StructuredDocument.filing.html` instead |
| `SectionDiff.oldSection` / `newSection` removed | Use `sourceMapping.old` / `sourceMapping.new` to locate section in source HTML |
| `ParagraphDiff.oldParagraph` / `newParagraph` removed | Use `sourceMapping` + `wordChanges` for diff content; use source document for full text |
| `TableDiff.oldTable` / `newTable` removed | Use `sourceMapping` for source location; use `cellDiffs` / `rowDiffs` for diff content |
| Unchanged paragraphs no longer in `paragraphDiffs[]` | Previously `paragraphDiffs` included `changeType: 'unchanged'` entries; now only changed items appear |
| Unchanged tables no longer in `tableDiffs[]` | Same as paragraphs |
| Unchanged rows no longer in `rowDiffs[]` | `summary.rowsUnchanged` still reports the count |
| New exported type `DiffFilingMetadata` | Available for import from the public API |

### Unchanged API surface

- `diffFilings()` function signature is unchanged (same parameters, same return type name)
- `ChangeType`, `DiffRange`, `SourceLocation` unchanged
- `CellDiff`, `RowDiff`, `WordChange` unchanged
- `buildSummary()` unchanged
- All summary statistics unchanged (counts are computed before filtering)

## Edge Cases

### 1. Section where all paragraphs and tables are unchanged

- `paragraphDiffs` becomes `[]` after filtering
- `tableDiffs` becomes `[]` after filtering
- `SectionDiff.changeType` remains `'unchanged'` (set by `classifySectionDiff`, not derived from child diffs)
- The section still appears in `sectionDiffs[]` — section-level change tracking is preserved

**Decision:** Unchanged _sections_ are NOT filtered from `sectionDiffs[]`. Section-level entries are small (just `id`, `heading`, `changeType`, `sourceMapping`, and empty arrays). Filtering them would remove useful information about the section inventory. The bloat comes from embedded content, not section entries.

### 2. Empty diff (identical filings)

- All sections get `changeType: 'unchanged'`
- All `paragraphDiffs` and `tableDiffs` are empty arrays
- `summary` is `{ added: 0, removed: 0, modified: 0, unchanged: N, reordered: 0 }`
- Output is a small JSON with N section stubs + metadata

### 3. Sections with only added or removed content

- Added section: all paragraphs are `changeType: 'added'`, all tables are `changeType: 'added'` — none are filtered
- Removed section: same with `changeType: 'removed'` — none are filtered
- No change in behavior; filtering only removes `'unchanged'` entries

### 4. Table with all rows unchanged (table-level changeType is 'unchanged')

- The table-level `changeType` is `'unchanged'`
- `diffTable()` returns a `TableDiff` with `changeType: 'unchanged'`
- This entire `TableDiff` is filtered out in `makeSectionDiff()` by the table-level filter
- `summary` still included in the `TableDiff` (but the whole object is gone) — this is fine, the table contributes nothing to the diff

### 5. Table with some unchanged rows and some changed rows

- `summary` counts all rows (including unchanged)
- `rowDiffs` contains only changed rows
- `cellDiffs` is derived from changed rows only
- Consumer can determine unchanged row count from `summary.rowsUnchanged`

### 6. `reordered` sections

- Sections with `changeType: 'reordered'` are NOT filtered (they're not `'unchanged'`)
- They still appear in `sectionDiffs[]` with their `paragraphDiffs` and `tableDiffs` (with unchanged children filtered per the standard rules)
- `buildSummary()` counts them in the `reordered` bucket — no change

### 7. `moved` paragraphs

- `ParagraphDiff` with `changeType: 'moved'` is NOT filtered (it's not `'unchanged'`)
- `sourceMapping` carries both old and new locations
- `wordChanges` is present if text also changed during the move
- The internal `InternalParagraphDiff` still carries the paragraphs through `detectMoves()` for Jaro-Winkler comparison, then strips them

### 8. Paragraph-differ internal refactoring safety

The `pairRemovedAdded()` and `detectMoves()` functions currently read `changes[i].oldParagraph` / `changes[i].newParagraph` during intermediate processing. The `InternalParagraphDiff` approach ensures these reads continue to work. The stripping happens only at the `diffParagraphs()` boundary — all internal functions work with the enriched type.

### 9. `DiffFilingMetadata.filingDate` serialization

`Temporal.PlainDate` serializes to ISO string (e.g., `"2023-11-03"`) via `toJSON()`. Same behavior as before — no change.

### 10. Very large diff (many modified sections)

Even with filtering, a diff where every section is modified will still include all paragraph word-changes and table cell-diffs. The bulk savings come from removing the source objects, not from filtering unchanged elements. For a typical 10-K with ~15 sections, the source content is ~95% of the JSON. Removing it achieves the 22 MB → 0.2 MB target.

## Migration Notes

This is a **breaking change** to the public API. Consumers must update:

### For `StructuredDiff.oldFiling` / `newFiling`

```typescript
// Before
const html = result.oldFiling.html;

// After — get html from the original document
const html = oldDoc.filing.html;
// Or use metadata from result
const accession = result.oldFiling.accessionNumber; // still available
```

### For `SectionDiff.oldSection` / `newSection`

```typescript
// Before
const heading = diff.oldSection?.heading;
const content = html.slice(diff.oldSection?.source.start, diff.oldSection?.source.end);

// After — heading is directly on the diff; use sourceMapping for location
const heading = diff.heading;
const content = html.slice(diff.sourceMapping.old?.start, diff.sourceMapping.old?.end);
```

### For `ParagraphDiff.oldParagraph` / `newParagraph`

```typescript
// Before
const oldText = paragraphDiff.oldParagraph?.text;

// After — use sourceMapping to locate in source HTML
const loc = paragraphDiff.sourceMapping.old;
const oldHtml = html.slice(loc?.start, loc?.end);
// Or use wordChanges for the text content of modifications
```

### For `TableDiff.oldTable` / `newTable`

```typescript
// Before
const oldRows = tableDiff.oldTable?.rows;

// After — use sourceMapping + cellDiffs/rowDiffs for diff content
const loc = tableDiff.sourceMapping.old;
```

### For unchanged element filtering

```typescript
// Before — check all paragraphs
for (const pd of sectionDiff.paragraphDiffs) {
  if (pd.changeType === 'unchanged') continue;
  // handle change
}

// After — all paragraphs in the array are changed
for (const pd of sectionDiff.paragraphDiffs) {
  // handle change (no unchanged entries to skip)
}
```

## Implementation Order

1. **Types first** — Update `diff/types.ts` (add `DiffFilingMetadata`, remove embedded source fields)
2. **Table differ** — Update `table-differ.ts` (remove `oldTable`/`newTable`, filter unchanged rows)
3. **Paragraph differ** — Update `paragraph-differ.ts` (introduce `InternalParagraphDiff`, strip at boundary)
4. **Diff engine** — Update `diff-engine.ts` (add `toDiffFilingMetadata`, filter unchanged paragraphs/tables, remove `oldSection`/`newSection`)
5. **Exports** — Update `diff/index.ts` and `src/index.ts` to export `DiffFilingMetadata`
6. **Tests** — Update all test files to match new types and filtering behavior
7. **Examples** — Update any example scripts

Steps 2 and 3 can be done in parallel. Step 4 depends on 1-3. Step 6 depends on 1-4.

## Summary of Changes

| File | Change | Estimated lines |
|------|--------|----------------|
| `diff/types.ts` | Add `DiffFilingMetadata`; remove 6 optional fields from 3 interfaces; update `StructuredDiff` | ~15 lines changed |
| `diff/diff-engine.ts` | Add `toDiffFilingMetadata()`; filter unchanged paragraphs/tables; remove `oldSection`/`newSection` from return | ~20 lines changed |
| `diff/paragraph-differ.ts` | Add `InternalParagraphDiff`; refactor internal functions; strip at boundary | ~30 lines changed |
| `diff/table-differ.ts` | Remove `oldTable`/`newTable`; filter unchanged rows; reorder summary computation | ~25 lines changed |
| `diff/index.ts` | Export `DiffFilingMetadata` | +1 line |
| `src/index.ts` | Re-export `DiffFilingMetadata` | +1 line |
| Test files (10+) | Update assertions for removed fields and filtering | ~200 lines across files |
| Example scripts | Remove references to embedded source objects | ~20 lines across files |

**Core production code**: ~90 lines changed across 4 files. Low algorithmic risk — this is a data-shape change, not an algorithm change. All diff algorithms remain identical.
