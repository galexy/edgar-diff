---
title: "US-1.8: Structured Diff Output — Implementation Design"
bead-id: edgar-diff-d2d
story: US-1.8
status: ready
created: "2026-03-09"
---

# US-1.8: Structured Diff Output — Implementation Design

## 1. Approach

US-1.8 is primarily an **integration story**. The three diff components are already built:

| Component | Module | Status |
|---|---|---|
| Section alignment | `section-aligner.ts` | Integrated into `diffFilings()` |
| Paragraph diffs | `paragraph-differ.ts` | Integrated into `makeSectionDiff()` |
| Table diffs | `table-differ.ts` | **Built but NOT wired in** — `tableDiffs: []` is hardcoded on line 51 of `diff-engine.ts` |

The main work is:

1. **Wire `diffTables()` into `diffFilings()`** — call it for matched section pairs and produce added/removed table lists for unmatched sections.
2. **Ensure JSON serializability** — `Temporal.Instant` and `Temporal.PlainDate` are not natively JSON-serializable; add a `toJSON()` helper.
3. **Verify all PRD acceptance criteria** are met through tests.
4. **Keep `subsectionDiffs: []`** — the parser produces `subsections: []` for all sections today, so recursive subsection diffing is deferred.

## 2. Files to Modify

### `libs/edgar-diff-lib/src/diff/diff-engine.ts` (primary changes)

**Change 1: Import `diffTables`**

```typescript
import { diffTables } from './table-differ.js';
```

**Change 2: Add table extraction helper**

```typescript
function extractTables(blocks: ContentBlock[]): Table[] {
  return blocks.filter((b): b is Table => b.type === 'table');
}
```

This mirrors the `extractParagraphs()` pattern already used in `paragraph-differ.ts`.

**Change 3: Wire table diffs into `makeSectionDiff()`**

Replace the hardcoded `tableDiffs: []` on line 51 with:

```typescript
// Compute table-level diffs for matched sections
const tableDiffs = options.match
  ? diffTables(
      extractTables(options.match.oldSection.blocks),
      extractTables(options.match.newSection.blocks),
    )
  : [];
```

**Change 4: Handle added/removed section tables**

For **added sections**, all tables should appear as `changeType: 'added'` TableDiffs.
For **removed sections**, all tables should appear as `changeType: 'removed'` TableDiffs.

Update the added/removed paths in `makeSectionDiff()`:

```typescript
// For added sections (no match, only newSection)
if (!options.match && options.newSection && !options.oldSection) {
  tableDiffs = extractTables(options.newSection.blocks).map(table => ({
    changeType: 'added' as const,
    newTable: table,
    rowDiffs: [],
    cellDiffs: [],
    sourceMapping: { new: table.source },
    summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
  }));
}

// For removed sections (no match, only oldSection)
if (!options.match && options.oldSection && !options.newSection) {
  tableDiffs = extractTables(options.oldSection.blocks).map(table => ({
    changeType: 'removed' as const,
    oldTable: table,
    rowDiffs: [],
    cellDiffs: [],
    sourceMapping: { old: table.source },
    summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
  }));
}
```

> **Note:** This mirrors the pattern `diffTables()` already uses in `table-differ.ts:274-298` for added/removed tables in matched sections. We replicate it here for section-level added/removed cases.

### `libs/edgar-diff-lib/src/diff/types.ts` (new addition)

**Add a `toJSON()` helper type and function** for serializing the `StructuredDiff` output:

```typescript
/** JSON-safe representation of StructuredDiff (Temporal types converted to ISO strings). */
export interface StructuredDiffJSON {
  oldFiling: RawFilingJSON;
  newFiling: RawFilingJSON;
  sectionDiffs: SectionDiff[];
  summary: StructuredDiff['summary'];
  generatedAt: string; // ISO 8601 instant string
}

/** JSON-safe representation of RawFiling. */
export interface RawFilingJSON extends Omit<RawFiling, 'filingDate' | 'fetchedAt' | 'html'> {
  filingDate: string; // ISO 8601 date string (YYYY-MM-DD)
  fetchedAt: string;  // ISO 8601 instant string
  // html is omitted — too large for JSON transmission
}
```

**Add a standalone serialization function** (not a method, since `StructuredDiff` is an interface):

```typescript
export function structuredDiffToJSON(diff: StructuredDiff): StructuredDiffJSON;
```

### `libs/edgar-diff-lib/src/diff/serialization.ts` (new file)

Create a new module for the serialization logic to keep concerns separated:

```typescript
import type { StructuredDiff, StructuredDiffJSON, RawFilingJSON } from './types.js';
import type { RawFiling } from '../client/types.js';

function rawFilingToJSON(filing: RawFiling): RawFilingJSON {
  const { html, ...rest } = filing;
  return {
    ...rest,
    filingDate: filing.filingDate.toString(),
    fetchedAt: filing.fetchedAt.toString(),
  };
}

export function structuredDiffToJSON(diff: StructuredDiff): StructuredDiffJSON {
  return {
    oldFiling: rawFilingToJSON(diff.oldFiling),
    newFiling: rawFilingToJSON(diff.newFiling),
    sectionDiffs: diff.sectionDiffs,
    summary: diff.summary,
    generatedAt: diff.generatedAt.toString(),
  };
}
```

**Design decisions for serialization:**

- **Omit `html` from `RawFilingJSON`**: The raw HTML can be megabytes and is not useful in JSON transmission. Consumers already have access to the original documents.
- **Convert Temporal types to ISO strings**: `Temporal.PlainDate.toString()` → `"2024-01-01"`, `Temporal.Instant.toString()` → `"2024-01-01T00:00:00Z"`.
- **SectionDiff is already JSON-safe**: All fields are plain objects, strings, numbers, or arrays. The `oldSection`/`newSection` references contain `SourceLocation` (numbers) and `ContentBlock[]` (strings/numbers), which are all natively serializable. The `Table` and `Paragraph` types within sections contain no Temporal types.

### `libs/edgar-diff-lib/src/diff/index.ts` (barrel exports)

Add exports for the new serialization module:

```typescript
// Serialization (US-1.8)
export { structuredDiffToJSON } from './serialization.js';
export type { StructuredDiffJSON, RawFilingJSON } from './types.js';
```

### `libs/edgar-diff-lib/src/types.ts` (no changes needed)

The `ContentBlock`, `Table`, `FilingSection` types already have everything needed. The `Table` type is already importable.

### Test files to create/modify

- **`tests/unit/diff/diff-engine.test.ts`** — Add tests for table diff integration in `diffFilings()`:
  - Matched sections with tables produce non-empty `tableDiffs`
  - Added sections list all tables as `changeType: 'added'`
  - Removed sections list all tables as `changeType: 'removed'`
  - Sections with no tables produce `tableDiffs: []`
  - Sections with only tables (no paragraphs) still produce correct tableDiffs
  - Self-diff (same document) produces all `unchanged` table diffs

- **`tests/unit/diff/serialization.test.ts`** (new) — Tests for `structuredDiffToJSON()`:
  - `generatedAt` is an ISO string
  - `filingDate` is an ISO date string
  - `fetchedAt` is an ISO instant string
  - `html` is omitted from filing JSON
  - Round-trip: `JSON.parse(JSON.stringify(structuredDiffToJSON(diff)))` produces valid output
  - `sectionDiffs` are preserved as-is

## 3. Key Interfaces and Types

### Existing types (no changes)

All the core diff types already exist in `diff/types.ts`:

- `StructuredDiff` — Top-level diff output (line 122)
- `SectionDiff` — Per-section diff with `tableDiffs: TableDiff[]` (line 109)
- `TableDiff` — Per-table diff with row/cell level detail (line 44)
- `ParagraphDiff` — Per-paragraph diff with word changes (line 97)
- `ChangeType` — `'added' | 'removed' | 'modified' | 'unchanged' | 'reordered' | 'moved'` (line 12)

### New types

```typescript
// In diff/types.ts
interface StructuredDiffJSON { ... }  // See section 2 above
interface RawFilingJSON { ... }       // See section 2 above

// Standalone function (in diff/serialization.ts)
function structuredDiffToJSON(diff: StructuredDiff): StructuredDiffJSON;
```

### Type note: `ChangeType` includes `'moved'`

The actual `ChangeType` in `diff/types.ts` includes `'moved'` (added in US-1.6 for paragraph-level move detection). The PRD's architecture doc lists `ChangeType` without `'moved'`. The implementation is correct — `'moved'` is a valid change type for paragraphs, and `buildSummary()` already maps `'moved'` → `reordered` in the summary counts.

## 4. Data Flow

```
Input: oldDoc (StructuredDocument) + newDoc (StructuredDocument)
  │
  ▼
alignSections(oldDoc.sections, newDoc.sections, options)
  │
  ├── matched: SectionMatch[]    (paired sections)
  ├── added: FilingSection[]     (new-only sections)
  └── removed: FilingSection[]   (old-only sections)
  │
  ▼
For each matched pair → makeSectionDiff('modified'|'unchanged'|'moved', { match })
  │
  ├── diffParagraphs(match)                    ← Already wired (US-1.6)
  │   └── Returns ParagraphDiff[] with word-level changes
  │
  ├── diffTables(oldTables, newTables)          ← NEW integration point
  │   ├── matchTables() → matched, added, removed
  │   ├── For matched: diffTable(old, new) → row/cell diffs
  │   ├── For added: TableDiff with changeType='added'
  │   └── For removed: TableDiff with changeType='removed'
  │
  └── subsectionDiffs: []                       ← Deferred (parser produces [])
  │
For each added section → makeSectionDiff('added', { newSection })
  │
  └── tableDiffs: all tables as 'added'         ← NEW
  │
For each removed section → makeSectionDiff('removed', { oldSection })
  │
  └── tableDiffs: all tables as 'removed'       ← NEW
  │
  ▼
Assemble StructuredDiff:
  { oldFiling, newFiling, sectionDiffs, summary, generatedAt }
  │
  ▼
Optional: structuredDiffToJSON(diff) → StructuredDiffJSON
  (Converts Temporal types to ISO strings, omits html)
```

## 5. Dependencies

### Internal modules

| Module | Used for |
|---|---|
| `diff/section-aligner.ts` | `alignSections()`, `classifySectionDiff()` |
| `diff/paragraph-differ.ts` | `diffParagraphs()` |
| `diff/table-differ.ts` | `diffTables()` (**new import in diff-engine.ts**) |
| `diff/table-matcher.ts` | Called internally by `diffTables()` |
| `diff/grid-normalizer.ts` | Called internally by `diffTable()` |
| `types.ts` | `StructuredDocument`, `FilingSection`, `Table`, `ContentBlock` |
| `client/types.ts` | `RawFiling` (referenced in `StructuredDiff`) |

### External packages

| Package | Used for |
|---|---|
| `@js-temporal/polyfill` | `Temporal.Now.instant()` for `generatedAt` timestamp |
| `diff` | Array diffing in paragraph-differ and table-differ (already in deps) |
| `jaro-winkler` | Section heading similarity (already in deps) |

No new external dependencies are needed.

## 6. Edge Cases

### Sections with no tables

`extractTables()` returns `[]`, `diffTables([], [])` returns `[]`. No-op — `tableDiffs` will be `[]`. Already handled correctly.

### Sections with only tables (no paragraphs)

`diffParagraphs()` will return `[]` (no paragraphs to diff). `diffTables()` will produce the table diffs. Both arrays are independent.

### Empty sections (no blocks at all)

Both `paragraphDiffs` and `tableDiffs` will be `[]`. `changeType` is determined by `classifySectionDiff()` which uses `serializeSectionContent()` — an empty section compared to another empty section will be `'unchanged'`.

### Self-diff (same document diffed against itself)

All sections match with `similarity: 1.0`. `serializeSectionContent()` produces identical strings → `'unchanged'` for all. `diffTables()` will produce all `'unchanged'` TableDiffs (matched rows, matched cells, zero cell changes). `diffParagraphs()` will produce all `'unchanged'` ParagraphDiffs.

### Added section with tables

Tables within the added section should appear as `TableDiff` entries with `changeType: 'added'`, `newTable` set, `oldTable` undefined. Same pattern as `diffTables()` uses for unmatched new tables.

### Removed section with tables

Inverse: `changeType: 'removed'`, `oldTable` set, `newTable` undefined.

### JSON serialization of Temporal types

`Temporal.Instant.prototype.toString()` → `"2024-01-01T00:00:00Z"` (ISO 8601).
`Temporal.PlainDate.prototype.toString()` → `"2024-01-01"` (ISO 8601 date).
Both are valid JSON string values. `JSON.stringify()` on a bare `Temporal.Instant` throws or produces unexpected output — this is why `structuredDiffToJSON()` is needed.

### Large HTML in RawFiling

`RawFiling.html` can be several MB for real 10-K filings. `structuredDiffToJSON()` omits `html` from the serialized output to keep JSON payloads manageable. Consumers who need the HTML already have the original `StructuredDocument`.

### Mixed content blocks ordering

`ContentBlock[]` can interleave paragraphs and tables. `extractTables()` and `extractParagraphs()` each filter independently. Table ordering within a section is preserved, which `matchTables()` uses for positional matching.

## 7. Open Questions

### Q1: Subsection diffs — defer or stub?

The parser currently produces `subsections: []` for all `FilingSection` instances. Recursive subsection diffing is not possible until the parser populates this field.

**Recommendation:** Keep `subsectionDiffs: []` hardcoded. Add a code comment noting this is deferred until subsection parsing is implemented. Create a beads issue to track this.

### Q2: Should `structuredDiffToJSON()` live in a separate module?

**Recommendation:** Yes — `serialization.ts` keeps serialization concerns separate from diff computation. The diff-engine should not be concerned with JSON representation. This also makes it easy to add other serialization formats later (e.g., a compact binary format for large diffs).

### Q3: Should we add `toJSON()` to the `StructuredDiff` type directly?

**Recommendation:** No. `StructuredDiff` is an interface, not a class. Adding a method would require either making it a class (breaking change) or relying on callers to attach the method. A standalone `structuredDiffToJSON()` function is the idiomatic TypeScript approach for interface-based code.

### Q4: Should `RawFilingJSON` include `html`?

**Recommendation:** No. The HTML can be several MB and is not needed for diff consumption. The PRD says "serializable to JSON for storage or transmission" — omitting the multi-MB HTML makes this practical. If a consumer needs HTML, they already have the original `StructuredDocument`.

### Q5: Should table diffs within added/removed sections include row-level detail?

Currently the design produces empty `rowDiffs: []` for tables in added/removed sections (matching the pattern in `table-differ.ts:274-298`). An alternative would be to produce row-level `'added'`/`'removed'` entries for each row.

**Recommendation:** Keep empty `rowDiffs` for now. The `changeType: 'added'|'removed'` at the table level is sufficient signal. Row-level detail for wholly added/removed tables adds noise without value — the consumer knows the entire table is new/gone. This matches the existing `diffTables()` behavior for unmatched tables, maintaining consistency.

### Q6: `ChangeType` discrepancy — `'moved'` vs architecture doc

The architecture doc's type definition omits `'moved'` from `ChangeType`, but the implementation includes it (added in US-1.6). The `buildSummary()` function already handles the mapping: `'moved'` in `SectionDiff.changeType` → `reordered++` in the summary.

**Recommendation:** Keep the current implementation. The architecture doc should be updated to reflect the actual types. The `'moved'` type is only used at the paragraph level (detected by `paragraph-differ.ts:detectMoves`); section-level classification uses `'reordered'` directly from `classifySectionDiff()`.

## 8. Implementation Sequence

1. **Add `extractTables()` helper and import `diffTables`** in `diff-engine.ts`
2. **Wire table diffs into `makeSectionDiff()`** for matched, added, and removed cases
3. **Add `StructuredDiffJSON` and `RawFilingJSON` types** to `diff/types.ts`
4. **Create `diff/serialization.ts`** with `structuredDiffToJSON()`
5. **Update `diff/index.ts`** barrel exports
6. **Write unit tests** for table integration and serialization
7. **Run full test suite** via `pnpm nx run-many --target=test` to verify no regressions
8. **Run typecheck and lint** via `pnpm nx run-many --target=typecheck` and `pnpm nx run-many --target=lint`
