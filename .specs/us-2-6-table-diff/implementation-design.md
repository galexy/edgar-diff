# US-2.6: Table Diff Highlighting — Implementation Design

## Approach

Extend the existing highlight injection pipeline (from US-2.5) to process `SectionDiff.tableDiffs` alongside `paragraphDiffs`. The same section-level string-replacement pattern applies: collect offset-based replacements, sort in reverse order, apply via string slicing.

**Two levels of table highlighting:**

1. **Row-level** (added/removed rows) — Inject a CSS class into the `<tr>` opening tag. CSS cascade highlights all cells in the row as a block. This satisfies AC-2: "Added/removed rows are highlighted as a block."

2. **Cell-level** (modified/added/removed cells within modified rows) — Inject a CSS class into the `<td>`/`<th>` opening tag and, for modified cells, replace inner content with an old→new annotation. This satisfies AC-1 and AC-3.

**Key design decisions:**

1. **Extend `applyHighlightsToSection` — not a new function.** Table replacements are collected into the same `replacements[]` array as paragraph replacements. Paragraph and table source ranges are non-overlapping (they're sibling content blocks), so a single reverse-order application pass handles both.

2. **Class injection on existing tags, not `<ins>`/`<del>` wrappers.** Unlike paragraphs, tables have strict content models — `<ins>`/`<del>` cannot be children of `<table>`, `<tbody>`, or `<tr>`. Instead, we inject CSS classes directly into `<tr>`, `<td>`, and `<th>` opening tags. This preserves valid HTML structure (AC-4).

3. **Old→new annotation for modified cells.** For `changeType === 'modified'`, replace the cell's inner HTML with `<del>old</del> → <ins>new</ins>`. This displays the magnitude of change at a glance — critical for financial tables where users compare numeric values between filings. Shown on BOTH sides so users see the change context regardless of which panel they're reading.

4. **`buildTableIndex` mirrors `buildParagraphIndex`.** A new lookup map from `"start:end"` → `Table` enables O(1) retrieval of `TableRow.source` offsets needed for row-level highlighting (since `RowDiff` lacks its own `sourceMapping`).

5. **RowDiff row index → Table.rows lookup.** `RowDiff.oldRowIndex`/`newRowIndex` maps to `Table.rows[index]`, giving us `TableRow.source` for the `<tr>` offset range. This bridges the gap between diff output (row indices) and source locations.

## Files to Modify

### `apps/web/src/lib/highlight-injector.ts`

Add table-specific functions and extend `applyHighlightsToSection`.

New functions:
- `injectClass(openingTag, className)` — inject a CSS class into an HTML opening tag
- `highlightCell(cellHtml, cellDiff, side)` — highlight a single cell (add class + optional old→new content)
- `wrapRow(rowHtml, changeType)` — add row-level class to `<tr>` tag

Modified functions:
- `applyHighlightsToSection()` — add `tableIndex` parameter; after paragraph processing loop, add table processing loop that iterates `sectionDiff.tableDiffs` → `rowDiffs` → `cellDiffs` and collects replacements

### `apps/web/src/components/highlight.css`

Add table highlight styles (row-level and cell-level classes).

### `apps/web/src/components/FilingContent.tsx`

- Rename `buildParagraphIndex` → `buildBlockIndexes` (or add `buildTableIndex` alongside it)
- Build table index from document sections
- Pass `tableIndex` to `applyHighlightsToSection`

### `apps/web/src/lib/highlight-injector.test.ts`

Add test cases for table highlighting functions.

### No changes to diff library types

All types (`TableDiff`, `RowDiff`, `CellDiff`, `DiffRange`) already have the fields needed. The web app consumes them as-is.

## Interfaces and Types

### New internal types (in `highlight-injector.ts`)

```typescript
import type { Table, TableDiff, RowDiff, CellDiff } from '@edgar-diff/lib';

// No new type definitions needed — all table diff types come from the library.
// The Side type already exists in highlight-injector.ts.
```

### Modified function signatures

```typescript
// CHANGED: added optional tableIndex parameter AFTER side to preserve backward compatibility.
// Existing US-2.5 callers pass 5 args (sectionHtml, sectionOffset, sectionDiff, paragraphIndex, side)
// and continue to work — tableIndex defaults to an empty Map, skipping table processing.
export function applyHighlightsToSection(
  sectionHtml: string,
  sectionOffset: number,
  sectionDiff: SectionDiff,
  paragraphIndex: Map<string, Paragraph>,
  side: Side,
  tableIndex: Map<string, Table> = new Map(),  // NEW — optional, after side
): string;

// NEW: inject CSS class into an HTML opening tag string.
// Handles double-quoted, single-quoted, and missing class attributes.
function injectClass(openingTag: string, className: string): string;

// NEW: highlight a single table cell
function highlightCell(
  cellHtml: string,
  cellDiff: CellDiff,
  side: Side,
): string;

// NEW: escape HTML special characters for safe injection into annotations.
function escapeHtml(text: string): string;
// Handles: & → &amp;  < → &lt;  > → &gt;  " → &quot;  ' → &#39;
```

### Key library types consumed

| Type | From | Usage |
|------|------|-------|
| `TableDiff` | `@edgar-diff/lib` | Per-table changeType + rowDiffs + sourceMapping |
| `RowDiff` | `@edgar-diff/lib` | Per-row changeType + cellDiffs + oldRowIndex/newRowIndex |
| `CellDiff` | `@edgar-diff/lib` | Per-cell changeType + oldValue/newValue + sourceMapping |
| `Table` | `@edgar-diff/lib` | `rows[]: TableRow` with source offsets for `<tr>` lookup |
| `TableRow` | `@edgar-diff/lib` | `source: SourceLocation` — `<tr>` boundaries in HTML |
| `TableCell` | `@edgar-diff/lib` | `source: SourceLocation` — `<td>`/`<th>` boundaries in HTML |

### Props contracts

No new component props. `FilingContent` already accepts `sectionDiffs` (which contain `tableDiffs`) and `side`. The table processing is internal to the highlight injection pipeline.

## Data Flow

```
StructuredDiff.sectionDiffs[].tableDiffs[]
        │
        ▼
  FilingContent.sliceSections()
  ├── Builds paragraphIndex: "start:end" → Paragraph  (existing)
  ├── Builds tableIndex: "start:end" → Table           (NEW)
  ├── For each section:
  │   ├── Slices section HTML (existing)
  │   ├── Looks up SectionDiff by section.id (existing)
  │   └── Calls applyHighlightsToSection(html, offset, diff, paraIdx, side, tableIdx)
  │       │
  │       ▼
  │   applyHighlightsToSection()
  │   ├── Paragraph processing (existing — unchanged)
  │   │   └── Collects paragraph replacements[]
  │   │
  │   ├── Table processing (NEW)
  │   │   └── For each TableDiff in sectionDiff.tableDiffs:
  │   │       ├── Get tableSourceLoc = tableDiff.sourceMapping[side]
  │   │       ├── Look up Table from tableIndex
  │   │       ├── For each RowDiff:
  │   │       │   ├── added/removed row → add class to <tr> tag → replacement
  │   │       │   └── modified row → for each CellDiff:
  │   │       │       ├── added/removed cell → add class to <td>/<th> → replacement
  │   │       │       └── modified cell → add class + old→new content → replacement
  │   │       └── Collects table replacements[]
  │   │
  │   └── Merge all replacements, sort reverse, apply via string slicing
  │
  └── Renders via dangerouslySetInnerHTML (unchanged)
```

### Side filtering (same logic as paragraphs)

| Row/Cell Change | Old Side | New Side |
|-----------------|----------|----------|
| Row added | Skip (no source) | Highlight `<tr>` green |
| Row removed | Highlight `<tr>` red | Skip (no source) |
| Row modified | Process cell diffs | Process cell diffs |
| Cell added (in modified row) | Skip | Highlight `<td>` green |
| Cell removed (in modified row) | Highlight `<td>` red | Skip |
| Cell modified | Show old→new, red accent | Show old→new, green accent |

## Algorithm

### Table highlight injection (inside `applyHighlightsToSection`)

```
For each tableDiff in sectionDiff.tableDiffs:
  tableSourceLoc = tableDiff.sourceMapping[side]
  if (!tableSourceLoc) continue   // table doesn't exist on this side

  tableKey = `${tableSourceLoc.start}:${tableSourceLoc.end}`
  table = tableIndex.get(tableKey)
  if (!table) continue            // safety fallback

  For each rowDiff in tableDiff.rowDiffs:
    // Determine which row index applies to this side
    rowIndex = (side === 'old') ? rowDiff.oldRowIndex : rowDiff.newRowIndex
    if (rowIndex === undefined) continue  // row doesn't exist on this side

    IF rowDiff.changeType === 'added' AND side === 'new':
      row = table.rows[rowIndex]
      relStart = row.source.start - sectionOffset
      relEnd = row.source.end - sectionOffset
      rowHtml = sectionHtml.slice(relStart, relEnd)
      modifiedHtml = injectClass(rowHtml, 'diff-row-added')  // <tr class="diff-row-added">
      replacements.push({ relStart, relEnd, html: modifiedHtml })

    ELSE IF rowDiff.changeType === 'removed' AND side === 'old':
      row = table.rows[rowIndex]
      relStart = row.source.start - sectionOffset
      relEnd = row.source.end - sectionOffset
      rowHtml = sectionHtml.slice(relStart, relEnd)
      modifiedHtml = injectClass(rowHtml, 'diff-row-removed')  // <tr class="diff-row-removed">
      replacements.push({ relStart, relEnd, html: modifiedHtml })

    ELSE IF rowDiff.changeType === 'modified':
      // Process individual cell diffs
      For each cellDiff in rowDiff.cellDiffs:
        if cellDiff.changeType === 'unchanged': continue

        cellSourceLoc = cellDiff.sourceMapping[side]
        if (!cellSourceLoc) continue

        relStart = cellSourceLoc.start - sectionOffset
        relEnd = cellSourceLoc.end - sectionOffset
        if (relStart < 0 || relEnd > sectionHtml.length || relStart >= relEnd) continue

        cellHtml = sectionHtml.slice(relStart, relEnd)
        modifiedHtml = highlightCell(cellHtml, cellDiff, side)
        replacements.push({ relStart, relEnd, html: modifiedHtml })
```

### `injectClass(tagHtml, className)` — CSS class injection into opening tag

```
Input:  '<tr class="existing" style="...">'  OR  '<td style="...">'
Output: '<tr class="existing diff-row-added" style="...">'  OR  '<td class="diff-cell-modified" style="...">'

Algorithm:
1. Guard: if tagHtml has no '>' character, return unchanged (malformed tag)
2. If tag has double-quoted class: /\bclass\s*=\s*"([^"]*)"/ → class="$1 {className}"
3. If tag has single-quoted class: /\bclass\s*=\s*'([^']*)'/ → class='$1 {className}'
4. Otherwise, insert class="{className}" after the tag name:
   /^(<(?:tr|td|th)\b)/i → $1 class="{className}"
   (Case-insensitive to handle uppercase <TR>, <TD>, <TH> in SEC filing HTML)
```

This operates on the opening tag portion only. For row-level replacements, we replace the entire `<tr>...</tr>` source range but only modify the opening `<tr>` tag within it.

### `highlightCell(cellHtml, cellDiff, side)` — single cell highlighting

```
Input:  '<td class="num" style="text-align:right">$1,234</td>', cellDiff, 'new'
Output: '<td class="num diff-cell-modified" style="text-align:right"><del class="diff-removed">$1,000</del> <span class="diff-arrow">→</span> <ins class="diff-added">$1,234</ins></td>'

Algorithm:
1. Find end of opening tag (first '>' character)
   - Guard: if no '>' found, return cellHtml unchanged
2. Extract closing tag from END of string using:
   /<\/(td|th)>\s*$/i — matches the LAST </td> or </th>
   This avoids matching nested table closing tags (e.g., <td><table><tr><td>x</td></tr></table></td>
   where the first </td> is the nested one, not the outer one).
3. Split cellHtml into: openingTag, innerContent, closingTag
4. Determine CSS class based on cellDiff.changeType:
   - 'added' → 'diff-cell-added'
   - 'removed' → 'diff-cell-removed'
   - 'modified' → 'diff-cell-modified'
   - anything else → return cellHtml unchanged
5. Inject class into opening tag via injectClass()
6. For 'modified' cells, replace inner content:
   - Build: <del class="diff-removed">{escapeHtml(oldValue ?? '')}</del>
            <span class="diff-arrow"> → </span>
            <ins class="diff-added">{escapeHtml(newValue ?? '')}</ins>
   - escapeHtml handles: & < > " ' to prevent XSS
7. For 'added'/'removed' cells, keep original inner content (just add class)
8. Return: modifiedOpeningTag + newInnerContent + closingTag
```

### `buildTableIndex(document)` — table lookup map

```typescript
function buildTableIndex(document: StructuredDocument): Map<string, Table> {
  const index = new Map<string, Table>();
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.type === 'table') {
        index.set(`${block.source.start}:${block.source.end}`, block);
      }
    }
  }
  return index;
}
```

Same pattern as `buildParagraphIndex`. Both iterate top-level section blocks only (subsection blocks are a known gap shared with US-2.5).

## Edge Cases

### 1. Colspan/rowspan cells

CellDiff.sourceMapping points to the **origin cell** (`isOrigin: true` in NormalizedGrid). Spanned positions that are not the origin don't generate CellDiffs. So each `<td colspan="3">` is modified exactly once. The colspan/rowspan attributes are preserved because we only inject a class and optionally replace inner content — we never modify or remove existing attributes.

### 2. `<th>` vs `<td>` elements

Header rows use `<th>` instead of `<td>`. The `injectClass` regex handles both: `/^(<(?:tr|td|th)\b)/i`. The `highlightCell` function detects the closing tag dynamically (`</th>` or `</td>`) rather than hardcoding `</td>`.

### 3. Empty cells

A cell with `text: ""` and empty inner HTML. `highlightCell` for modified cells still injects old→new content (one or both values may be empty strings). For added/removed cells, the class is added to the tag — even empty cells get the background color.

### 4. Tables with no changes (`changeType === 'unchanged'`)

Skip entirely — no replacements generated. This is handled by the `if (rowDiff.changeType === 'unchanged') continue` / `if (cellDiff.changeType === 'unchanged') continue` checks.

### 5. Style block interaction

Same constraint as US-2.5: `stripStyleBlocks()` runs before highlight injection, which could shift offsets if `<style>` blocks appear mid-section. In practice, SEC filing style blocks are in `<head>`, not within section content. Monitor during UAT; add offset adjustment if encountered.

### 6. Replacement overlap safety

Paragraph and table source ranges are non-overlapping (they're sibling content blocks in `section.blocks[]`). Within tables, row-level replacements (added/removed rows) and cell-level replacements (modified row cells) are mutually exclusive per row (a row is either added, removed, modified, or unchanged — never mixed). So all replacements in the `replacements[]` array are guaranteed non-overlapping.

### 7. Missing table in tableIndex

If `tableDiff.sourceMapping[side]` yields an offset key that's not in `tableIndex`, skip that table diff. This could happen if the document structure and diff data are misaligned (defensive guard).

### 8. Row index out of bounds

If `rowDiff.oldRowIndex` or `newRowIndex` exceeds `table.rows.length`, skip. Defensive guard against misaligned data.

### 9. Nested tables

SEC filings occasionally nest tables. Each table is a separate content block with its own `Table` entry and `TableDiff`. The source ranges for nested tables are within the parent table's range but don't overlap with sibling cells. The offset-based approach handles this naturally — each replacement targets a specific `<tr>` or `<td>` range.

### 10. Modified cells with HTML content

Some table cells contain HTML formatting (e.g., `<b>$1,234</b>`). For modified cells, we replace the inner content with a text-based old→new annotation (using `escapeHtml` on the values). This means HTML formatting in the original cell is lost for modified cells. This is acceptable for MVP since:
- Most changed cells contain plain numeric values
- The old→new annotation provides clearer information than preserving formatting
- Future enhancement: use DOM-based approach (like paragraph word-level injection) if HTML preservation is needed

## CSS Styles

### New classes

```css
/* ─── Row-level highlights (added/removed rows) ───── */

.filing-section tr.diff-row-added > td,
.filing-section tr.diff-row-added > th {
  background-color: #f0fdf4; /* green-50 */
  border-left: 2px solid #16a34a; /* green-600 */
}

.filing-section tr.diff-row-removed > td,
.filing-section tr.diff-row-removed > th {
  background-color: #fef2f2; /* red-50 */
  border-left: 2px solid #dc2626; /* red-600 */
}

/* ─── Cell-level highlights (individual cells) ─────── */

.filing-section td.diff-cell-added,
.filing-section th.diff-cell-added {
  background-color: #dcfce7; /* green-100 */
}

.filing-section td.diff-cell-removed,
.filing-section th.diff-cell-removed {
  background-color: #fee2e2; /* red-100 */
}

.filing-section td.diff-cell-modified,
.filing-section th.diff-cell-modified {
  background-color: #fefce8; /* yellow-50 — neutral for "changed" */
}

/* ─── Old→new annotation within modified cells ─────── */

.filing-section .diff-cell-modified del.diff-removed {
  color: #991b1b; /* red-800 */
  text-decoration: line-through;
}

.filing-section .diff-cell-modified ins.diff-added {
  color: #166534; /* green-800 */
  text-decoration: none;
  font-weight: 600;
}

.filing-section .diff-arrow {
  color: #6b7280; /* gray-500 */
  font-size: 0.85em;
  padding: 0 2px;
}
```

### Design rationale

- **Row-level vs cell-level distinction:** Row highlights use lighter backgrounds (green-50/red-50) with a left border to indicate "this whole row changed." Cell highlights use stronger backgrounds (green-100/red-100/yellow-50) to draw attention to specific cells.
- **Yellow for modified cells:** A neutral yellow distinguishes "value changed" from "added" (green) and "removed" (red). The old→new annotation inside uses red/green text to show direction.
- **Scoped under `.filing-section`:** Consistent with US-2.5 — highlights only apply within filing content.
- **`<ins>` in modified cells has `text-decoration: none`:** The green color and bold weight provide sufficient emphasis; underline would be cluttered inside small table cells.

## Open Questions

1. **Old→new for both sides vs side-specific display.** Current design shows `<del>old</del> → <ins>new</ins>` on BOTH sides for modified cells. Alternative: old side shows only old value (red highlight), new side shows only new value (green highlight). The "both values" approach is better for financial tables (see change magnitude without cross-referencing panels), but adds visual density. **Recommendation:** Both values on both sides for MVP. Can be refined based on UAT feedback.

2. **Subsection blocks not indexed.** Both `buildParagraphIndex` and `buildTableIndex` iterate top-level `section.blocks` only. If tables appear inside `section.subsections[].blocks`, they won't be found. This is a pre-existing gap from US-2.5. **Recommendation:** Add recursive block collection in a separate PR if real filings surface this gap.

3. **HTML content in modified cells.** Replacing inner content with text-based old→new loses any HTML formatting in the original cell (e.g., `<b>$1,234</b>` → `<del>$1,000</del> → <ins>$1,234</ins>`). For numeric values this is fine; for cells with rich formatting it could look off. **Recommendation:** Accept for MVP. Add DOM-based content preservation as a future enhancement if needed.

4. **Numeric formatting for old→new.** `CellDiff.oldValue`/`newValue` are raw text strings from the parser. They may not match the displayed formatting (e.g., parser normalizes `$ 1,234` to `$1,234`). Since we're replacing inner content, the annotation shows the normalized text rather than the originally-formatted HTML text. **Recommendation:** Accept for MVP. The normalized values are accurate; original formatting is a polish item.

5. **Row-level highlighting for `reordered` rows.** The `RowDiff.changeType` could be `'reordered'`. Current design skips these (treated as unchanged). **Recommendation:** Defer reorder visualization to a future story, consistent with US-2.5's handling of reordered paragraphs.
