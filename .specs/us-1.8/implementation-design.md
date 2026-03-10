# US-1.8: Produce a Structured Diff Output — Implementation Design

## Overview

US-1.8 integrates the three sub-story outputs — section alignment (US-1.5), paragraph diffs (US-1.6), and table diffs (US-1.7) — into the `diffFilings()` orchestrator so that it produces a complete `StructuredDiff` with real table diffs instead of the current `tableDiffs: []` stub.

## Approach

The integration is surgical: only `diff-engine.ts` needs functional changes. The existing `diffTables()` function (from US-1.7) already accepts `Table[]` arrays and returns `TableDiff[]`. The work is:

1. **Extract tables from section blocks** — filter `FilingSection.blocks` for `type === 'table'`
2. **Call `diffTables()` for matched sections** — pass old/new table arrays
3. **Produce `TableDiff[]` for added/removed sections** — mark all tables as added or removed
4. **Add `generatedAt` serialization helper** — `Temporal.Instant` is not JSON-serializable by default
5. **Leave `subsectionDiffs: []`** — subsection diffing is out of scope for US-1.8 (see Open Questions)

## Files to Modify

### `libs/edgar-diff-lib/src/diff/diff-engine.ts` (primary)

**Changes:**

1. **Add import**: `import { diffTables } from './table-differ.js';`

2. **Add table extraction helper**:
   ```typescript
   function extractTables(blocks: ContentBlock[]): Table[] {
     return blocks.filter((b): b is Table => b.type === 'table');
   }
   ```
   This mirrors the existing `extractParagraphs()` pattern in `paragraph-differ.ts`.

3. **Add import for types**: `import type { ContentBlock, Table } from '../types.js';`

4. **Update `makeSectionDiff()`** — compute table diffs for matched sections:
   ```typescript
   function makeSectionDiff(
     changeType: SectionDiff['changeType'],
     options: {
       oldSection?: FilingSection;
       newSection?: FilingSection;
       match?: SectionMatch;
     },
   ): SectionDiff {
     // ... existing sourceMapping logic ...

     const paragraphDiffs = options.match ? diffParagraphs(options.match) : [];

     // NEW: Compute table diffs
     let tableDiffs: TableDiff[];
     if (options.match) {
       // Matched section — diff tables between old and new
       const oldTables = extractTables(options.match.oldSection.blocks);
       const newTables = extractTables(options.match.newSection.blocks);
       tableDiffs = diffTables(oldTables, newTables);
     } else if (options.newSection && !options.oldSection) {
       // Added section — all tables are added
       tableDiffs = extractTables(options.newSection.blocks).map(table => ({
         changeType: 'added' as const,
         newTable: table,
         rowDiffs: [],
         cellDiffs: [],
         sourceMapping: { new: table.source },
         summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
       }));
     } else if (options.oldSection && !options.newSection) {
       // Removed section — all tables are removed
       tableDiffs = extractTables(options.oldSection.blocks).map(table => ({
         changeType: 'removed' as const,
         oldTable: table,
         rowDiffs: [],
         cellDiffs: [],
         sourceMapping: { old: table.source },
         summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
       }));
     } else {
       tableDiffs = [];
     }

     return {
       id: section.id,
       heading: section.heading,
       changeType,
       oldSection: options.oldSection,
       newSection: options.newSection,
       paragraphDiffs,
       tableDiffs,         // was: []
       subsectionDiffs: [], // remains empty (out of scope)
       sourceMapping,
     };
   }
   ```

5. **Add `toJSON()` helper or document Temporal serialization** (see Open Question 1).

### `libs/edgar-diff-lib/src/diff/index.ts` (barrel exports — minor)

No changes needed. `diffTables` is already exported. The `TableDiff` type is already exported. All types are already publicly available.

### `libs/edgar-diff-lib/src/diff/types.ts` (no changes)

All required types (`TableDiff`, `SectionDiff`, `StructuredDiff`) are already defined with the correct shapes. No modifications needed.

### `libs/edgar-diff-lib/src/types.ts` (no changes)

`ContentBlock`, `Table`, `FilingSection` are already correctly defined.

## Interfaces and Types

### Existing types used (no changes needed)

| Type | File | Role |
|------|------|------|
| `StructuredDiff` | `diff/types.ts` | Top-level return of `diffFilings()` |
| `SectionDiff` | `diff/types.ts` | Already has `tableDiffs: TableDiff[]` |
| `TableDiff` | `diff/types.ts` | Output of `diffTables()` / `diffTable()` |
| `ContentBlock` | `types.ts` | `Paragraph \| Table` discriminated union |
| `Table` | `types.ts` | Input to `diffTables()` |
| `FilingSection` | `types.ts` | Has `blocks: ContentBlock[]` |

### New types: None

All types are already defined. The interface contracts between US-1.5/1.6/1.7 and US-1.8 are already in place. This is a pure wiring change.

## Data Flow

```
diffFilings(oldDoc, newDoc, options?)
  │
  ├── alignSections(oldDoc.sections, newDoc.sections)
  │     → { matched, added, removed }
  │
  ├── For each matched section (in new-filing order):
  │     makeSectionDiff(changeType, { oldSection, newSection, match })
  │       ├── diffParagraphs(match)           ← US-1.6 (existing)
  │       ├── extractTables(oldSection.blocks) ← NEW
  │       ├── extractTables(newSection.blocks) ← NEW
  │       └── diffTables(oldTables, newTables) ← US-1.7 (NEW call)
  │             ├── matchTables()              (internal)
  │             └── diffTable() per pair       (internal)
  │
  ├── For each added section:
  │     makeSectionDiff('added', { newSection })
  │       └── extractTables → mark each as 'added' TableDiff
  │
  ├── For each removed section:
  │     makeSectionDiff('removed', { oldSection })
  │       └── extractTables → mark each as 'removed' TableDiff
  │
  ├── buildSummary(sectionDiffs)
  │
  └── Return StructuredDiff {
        oldFiling, newFiling, sectionDiffs, summary,
        generatedAt: Temporal.Now.instant()
      }
```

## Dependencies

### Internal modules

| Module | Function | Used for |
|--------|----------|----------|
| `./table-differ.js` | `diffTables()` | Table diffing for matched sections |
| `./paragraph-differ.js` | `diffParagraphs()` | Already used, no change |
| `./section-aligner.js` | `alignSections()`, `classifySectionDiff()` | Already used, no change |

### External libraries

| Library | Used by | Purpose |
|---------|---------|---------|
| `@js-temporal/polyfill` | `diff-engine.ts` | `generatedAt` timestamp (already imported) |
| `diff` | `table-differ.ts`, `paragraph-differ.ts` | Array/word diffing (already used) |
| `jaro-winkler` | `table-matcher.ts`, `section-aligner.ts` | Similarity scoring (already used) |

No new external dependencies required.

## Edge Cases

### 1. Section with only paragraphs (no tables)
`extractTables()` returns `[]` → `diffTables([], [])` → `matchTables` returns `{ matched: [], added: [], removed: [] }` → `tableDiffs` is `[]`. Works correctly.

### 2. Section with only tables (no paragraphs)
`diffParagraphs()` already handles this — `extractParagraphs()` returns `[]` → paragraph diff is `[]`. Table diffs proceed normally. Works correctly.

### 3. Empty section (no blocks at all)
Both `extractTables()` and `extractParagraphs()` return `[]`. All diffs are empty arrays. Works correctly.

### 4. Sections with no tables at all (entire filing)
Every section produces `tableDiffs: []`. No performance cost since `diffTables([],[])` short-circuits in `matchTables`. Works correctly.

### 5. Mismatched table counts between old and new sections
`matchTables()` already handles this via greedy matching. Unmatched old tables are marked 'removed', unmatched new tables are marked 'added'. The `diffTables()` return value already includes all three categories. Works correctly.

### 6. Added section with tables
Tables are extracted and each gets a `TableDiff` with `changeType: 'added'`. These are lightweight stubs (no row-level diff needed since there's no old table to compare against).

### 7. Removed section with tables
Symmetric to added — each table gets `changeType: 'removed'`.

### 8. Temporal.Instant JSON serialization
`Temporal.Instant` has a `toString()` method that returns an ISO 8601 string (e.g., `"2024-01-15T10:30:00Z"`). `JSON.stringify()` calls `toJSON()` if available; the Temporal polyfill provides this. However, round-tripping requires `Temporal.Instant.from(string)` on deserialization. See Open Question 1.

### 9. Large tables / performance
`diffTables()` calls `normalizeGrid()` which expands colspans/rowspans. For very large tables (100+ rows), the `diffArrays()` call on row fingerprints is O(n*m). This matches the existing behavior of `diffParagraphs()` and is acceptable for SEC filings, which rarely exceed ~200 rows per table.

### 10. `moved` vs `reordered` in summary
`buildSummary()` already maps `'moved'` to the `reordered` counter (line 16-17 of diff-engine.ts). This only applies to section-level changeTypes; table-level and paragraph-level diffs don't contribute to the top-level summary. No change needed.

## Open Questions

### 1. JSON serialization of Temporal types

**Question**: `StructuredDiff.generatedAt` is `Temporal.Instant`. Should we add a `toJSON()` serialization strategy?

**Recommendation**: The `@js-temporal/polyfill` already implements `toJSON()` on `Temporal.Instant` which returns an ISO 8601 string. `JSON.stringify()` will work out of the box. For deserialization, consumers should call `Temporal.Instant.from(str)`. We should:
- Document this in the `StructuredDiff` JSDoc
- Optionally add a `reviveStructuredDiff(json)` utility in a future story if consumers need it
- **For US-1.8**: No code change needed. The polyfill handles it.

### 2. Subsection diffs — leave as empty or implement?

**Question**: `SectionDiff.subsectionDiffs` is typed as `SectionDiff[]` but currently hardcoded to `[]`. Should US-1.8 implement recursive subsection diffing?

**Recommendation**: **Leave as `[]` for US-1.8**. Reasons:
- `FilingSection.subsections` exists but the current parser rarely populates it for 10-K filings
- Recursive diffing adds complexity (section alignment, paragraph diffing, and table diffing all need to recurse)
- Can be a follow-up story (US-1.8a or similar)
- The type is already correct — no breaking change when it's implemented later

### 3. ChangeType "moved" vs "reordered" mapping

**Question**: The `ChangeType` union includes both `'moved'` and `'reordered'`. How do they map?

**Analysis from the code**:
- `'moved'` is used at the **paragraph level** (in `paragraph-differ.ts` `detectMoves()`) when a paragraph appears at a different position
- `'reordered'` is used at the **section level** (in `section-aligner.ts` `classifySectionDiff()`) when a section's relative order changed but content is identical
- `buildSummary()` maps section-level `'moved'` to the `reordered` counter, but currently no section ever gets `changeType: 'moved'` — sections get `'reordered'` directly from `classifySectionDiff()`
- **At the table level**: `matchTables()` does not produce `'moved'` or `'reordered'` — only `'added'`, `'removed'`, `'modified'`, `'unchanged'`

**Recommendation**: No mapping change needed for US-1.8. The existing behavior is correct:
- Section level: `'reordered'` (from `classifySectionDiff`)
- Paragraph level: `'moved'` (from `detectMoves`)
- Table level: no reorder detection (tables within a section aren't order-sensitive enough to warrant it)

### 4. Table extraction from ContentBlock[]

**Question**: How should tables be extracted from `FilingSection.blocks`?

**Answer**: Use a simple type-guard filter:
```typescript
function extractTables(blocks: ContentBlock[]): Table[] {
  return blocks.filter((b): b is Table => b.type === 'table');
}
```

This is the same pattern used by `extractParagraphs()` in `paragraph-differ.ts` (line 21-23). The `ContentBlock` discriminated union (`Paragraph | Table`) uses the `type` field (`'paragraph'` | `'table'`), so the type guard is safe and complete.

**Consideration**: Tables appear interleaved with paragraphs in `blocks`. The extraction preserves their relative order, which is what `matchTables()` uses for position-based scoring. This is correct behavior.

## Example Scripts

After US-1.8, the library is functionally complete: fetch → parse → diff. We should ship standalone example scripts that demonstrate this end-to-end pipeline against real SEC filings.

### Directory: `examples/`

New directory at the workspace root (not an Nx project — just standalone `tsx` scripts). Pattern follows existing `scripts/fetch-filings.ts` and `scripts/analyze-headings.ts`.

### Scripts to create

#### 1. `examples/diff-simple.ts` — Minimal year-over-year diff

**Difficulty**: Simple
**Fixture pair**: AAPL 2023 vs 2024 (same company, consecutive years, stable structure)

Demonstrates:
- Load two HTML filings from `libs/edgar-diff-lib/tests/integration/fixtures/`
- `parseFiling()` each into `StructuredDocument`
- `diffFilings(oldDoc, newDoc)` → `StructuredDiff`
- Print section-level summary (added/removed/modified/unchanged/reordered counts)
- Print each `SectionDiff` heading + changeType
- JSON-serialize the full result to a file

```
Usage: npx tsx examples/diff-simple.ts
Output: Section-level summary table + JSON file
```

#### 2. `examples/diff-with-tables.ts` — Table-level diff inspection

**Difficulty**: Medium
**Fixture pair**: JPM 2023 vs 2024 (financial institution, table-heavy sections)

Demonstrates:
- Full `diffFilings()` pipeline
- Iterate `sectionDiffs` → filter for sections with `tableDiffs.length > 0`
- For each `TableDiff`: print `changeType`, row counts (`summary.rowsAdded`, `rowsRemoved`, `rowsModified`), and cell-level changes
- Show paragraph diffs alongside table diffs in the same section
- Highlight numeric value changes (`oldNumericValue` → `newNumericValue`)

```
Usage: npx tsx examples/diff-with-tables.ts
Output: Per-section breakdown with table and paragraph diffs
```

#### 3. `examples/diff-structural.ts` — Major structural changes

**Difficulty**: Hard
**Fixture pair**: XOM 2012 vs 2024 (12-year gap, significant restructuring)

Demonstrates:
- Handling of added/removed sections (not just modified)
- Large diff output with many section-level changes
- Added sections with table stubs
- Removed sections with table stubs
- Stress test of the alignment algorithm across very different documents
- Print a summary comparing section counts (old vs new), then detail each change

```
Usage: npx tsx examples/diff-structural.ts
Output: Structural change summary + detailed section-by-section diff
```

#### 4. `examples/diff-to-json.ts` — JSON pipeline for downstream consumers

**Difficulty**: Simple
**Fixture pair**: MSFT 2023 vs 2024

Demonstrates:
- `JSON.stringify(structuredDiff)` works out of the box (Temporal.Instant serializes natively)
- Write complete `StructuredDiff` JSON to stdout or file
- Show that the output is valid, parseable JSON
- Demonstrate round-trip: deserialize, verify `generatedAt` can be restored via `Temporal.Instant.from()`

```
Usage: npx tsx examples/diff-to-json.ts > output.json
Output: Complete StructuredDiff as JSON
```

### API surface considerations

The existing public API already exports everything these scripts need:

| Export | Module | Used for |
|--------|--------|----------|
| `parseFiling()` | `parser/index.ts` | Parse HTML → `StructuredDocument` |
| `diffFilings()` | `diff/diff-engine.ts` | Diff two documents → `StructuredDiff` |
| `StructuredDiff` (type) | `diff/types.ts` | Result type |
| `SectionDiff` (type) | `diff/types.ts` | Per-section result |
| `TableDiff` (type) | `diff/types.ts` | Per-table result |
| `RawFiling` (type) | `client/types.ts` | Filing metadata |

No new exports needed. The scripts import directly from `../libs/edgar-diff-lib/src/index.js` (or via the built package if published).

### Implementation note

These example scripts are **not part of US-1.8 core implementation** — they can be written after the `diffFilings()` integration is complete and tests pass. They serve as functional smoke tests and documentation-by-example. They should be committed in the same PR or a fast-follow.

## Summary of Changes

| File | Change | Lines affected |
|------|--------|---------------|
| `diff-engine.ts` | Add `diffTables` import | +1 line |
| `diff-engine.ts` | Add `ContentBlock`, `Table` type imports | +1 line |
| `diff-engine.ts` | Add `extractTables()` helper | +3 lines |
| `diff-engine.ts` | Update `makeSectionDiff()` to compute table diffs | ~25 lines modified |
| `diff/index.ts` | No changes needed | 0 |
| `diff/types.ts` | No changes needed | 0 |
| `examples/diff-simple.ts` | New: minimal year-over-year diff | ~60 lines |
| `examples/diff-with-tables.ts` | New: table-level diff inspection | ~100 lines |
| `examples/diff-structural.ts` | New: major structural changes | ~80 lines |
| `examples/diff-to-json.ts` | New: JSON pipeline | ~40 lines |

**Core diff**: ~30 lines added/modified in `diff-engine.ts`. This is a low-risk integration change — all the algorithmic complexity lives in the existing `diffTables()`, `matchTables()`, and `diffTable()` functions.

**Example scripts**: ~280 lines across 4 new files in `examples/`. These use only the public API and existing fixtures — no library changes needed.
