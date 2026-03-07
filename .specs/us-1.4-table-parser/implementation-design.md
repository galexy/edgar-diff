# Implementation Design: US-1.4 Parse Tables into Structured Representations

## Approach

Extract structured `Table` objects (rows, cells, source mappings) from `<table>` DOM nodes already identified by the content-extractor. The content-extractor currently creates `Table` stubs with `rows: []` -- this story fills in the rows.

**Strategy: Single-pass DOM subtree walk per table.**

1. The content-extractor already locates `<table>` elements within section boundaries and creates `Table` stubs with `SourceLocation`. Instead of creating stubs directly, it will call `extractTable()` from the new `table-extractor.ts` module.

2. `extractTable()` walks the `<table>` DOM subtree:
   - Finds `<tr>` elements (handling `<thead>`, `<tbody>`, `<tfoot>` wrappers)
   - For each `<tr>`, finds `<td>`/`<th>` cells
   - Extracts text content, colspan/rowspan, numeric values, and header detection
   - Attaches `SourceLocation` to every `TableRow` and `TableCell`

**Why a separate module (not inline in content-extractor):**
- Table extraction has substantial logic (numeric parsing, header detection, iXBRL handling) that would bloat content-extractor
- Matches the architecture doc's file layout: `src/parser/table-extractor.ts`
- Keeps content-extractor focused on block-level dispatch (paragraph vs table)

---

## Files to Create/Modify

### New files

| File | Purpose |
|------|---------|
| `src/parser/table-extractor.ts` | `extractTable()` function: walks `<table>` DOM subtree, returns populated `Table` |

### Modified files

| File | Change |
|------|--------|
| `src/parser/content-extractor.ts` | Replace inline `Table` stub creation (lines 36-49) with call to `extractTable()` |
| `src/parser/index.ts` | Export `extractTable` if needed for unit testing |

---

## Interfaces and Types

All types are already defined in `src/types.ts` and will not be changed:

```typescript
interface TableCell extends SourceMapped {
  text: string;           // Accumulated text content, whitespace-normalized
  numericValue?: number;  // Parsed numeric value (currency, percentage, plain number)
  colspan: number;        // From colspan attribute, default 1
  rowspan: number;        // From rowspan attribute, default 1
}

interface TableRow extends SourceMapped {
  cells: TableCell[];     // Cells in document order
  isHeader: boolean;      // true if row is in <thead>, or all cells are <th>
}

interface Table extends SourceMapped {
  type: 'table';
  rows: TableRow[];       // All rows in document order (header rows first)
}
```

### How fields are populated

| Field | Source |
|-------|--------|
| `TableCell.text` | `getTextContent(cellNode)` -- accumulates text from all descendant text nodes, normalizes whitespace and `\u00a0` |
| `TableCell.numericValue` | Parsed from `text` after stripping `$`, `,`, `%`; handles parenthetical negatives `(1,234)` → `-1234`; `undefined` if not numeric |
| `TableCell.colspan` | `parseInt(cellNode.attribs['colspan']) || 1` |
| `TableCell.rowspan` | `parseInt(cellNode.attribs['rowspan']) || 1` |
| `TableCell.source` | `{ start: cellNode.startIndex, end: cellNode.endIndex + 1 }` |
| `TableRow.isHeader` | `true` if row is inside `<thead>`, OR all cells in the row are `<th>` elements |
| `TableRow.source` | `{ start: trNode.startIndex, end: trNode.endIndex + 1 }` |
| `Table.source` | Already set by content-extractor (clipped to section boundary) |

---

## Data Flow

```
content-extractor: findBlocksInRange()
  │
  ├─ Encounters <table> element within section boundary
  │
  ├─ Calls extractTable(tableNode, context)
  │     │
  │     ├─ 1. Find row containers
  │     │     Walk immediate children of <table> for <thead>, <tbody>, <tfoot>, <tr>
  │     │     For <thead>/<tbody>/<tfoot>: walk their children for <tr>
  │     │     Collect all <tr> elements in document order
  │     │     Track which <tr> elements came from <thead> (for isHeader)
  │     │
  │     ├─ 2. For each <tr>, extract cells
  │     │     Walk children for <td> and <th> elements
  │     │     For each cell element:
  │     │       a. Accumulate text: getTextContent(cell)
  │     │       b. Normalize: collapse whitespace, replace \u00a0
  │     │       c. Parse colspan: parseInt(attribs['colspan']) || 1
  │     │       d. Parse rowspan: parseInt(attribs['rowspan']) || 1
  │     │       e. Parse numeric: tryParseNumeric(text)
  │     │       f. Build SourceLocation: { start: startIndex, end: endIndex + 1 }
  │     │       g. Optionally populate sourceHtml if context.includeSourceHtml
  │     │
  │     ├─ 3. Determine isHeader for each row
  │     │     Rule: row was inside <thead> OR every cell in row is <th>
  │     │     Fallback heuristic: first row if all cells are non-numeric text
  │     │     (deferred -- not implementing first-row heuristic in v1)
  │     │
  │     ├─ 4. Build TableRow[] and return Table
  │     │
  │     └─ Returns populated Table with rows, cells, source mappings
  │
  └─ Pushes Table into blocks[]
```

---

## Table Extraction Algorithm

### 1. Finding rows

```typescript
function findRows(tableNode: Element): { tr: Element; inThead: boolean }[] {
  const rows: { tr: Element; inThead: boolean }[] = [];
  for (const child of tableNode.children) {
    if (!isTag(child)) continue;
    const name = child.name.toLowerCase();
    if (name === 'tr') {
      rows.push({ tr: child, inThead: false });
    } else if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
      for (const grandchild of child.children) {
        if (isTag(grandchild) && grandchild.name.toLowerCase() === 'tr') {
          rows.push({ tr: grandchild, inThead: name === 'thead' });
        }
      }
    }
  }
  return rows;
}
```

### 2. Extracting cells from a row

```typescript
function extractCells(trNode: Element, context: ExtractionContext): TableCell[] {
  const cells: TableCell[] = [];
  for (const child of trNode.children) {
    if (!isTag(child)) continue;
    const name = child.name.toLowerCase();
    if (name !== 'td' && name !== 'th') continue;

    const rawText = getTextContent(child);
    const text = rawText
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const colspan = Math.max(1, parseInt(child.attribs?.['colspan'] ?? '', 10) || 1);
    const rowspan = Math.max(1, parseInt(child.attribs?.['rowspan'] ?? '', 10) || 1);
    const numericValue = tryParseNumeric(text);

    const source: SourceLocation = {
      start: child.startIndex ?? 0,
      end: (child.endIndex ?? 0) + 1,
    };

    const cell: TableCell = { text, colspan, rowspan, source };
    if (numericValue !== undefined) cell.numericValue = numericValue;
    if (context.includeSourceHtml) {
      cell.sourceHtml = context.html.slice(source.start, source.end);
    }
    cells.push(cell);
  }
  return cells;
}
```

### 3. Header detection

A row is marked `isHeader: true` when:
- The `<tr>` is a direct child of a `<thead>` element, **OR**
- Every cell in the row is a `<th>` element (not `<td>`)

No first-row heuristic in v1. **Real SEC filings do not use `<th>` or `<thead>` tags** -- verified across all 18 fixture files (AAPL, MSFT, JPM, WMT, etc.), all have zero `<th>` and zero `<thead>` occurrences. This means `isHeader` will be `false` for all rows in real filings. This is acceptable -- header detection is informational for the diff engine, works correctly when `<th>`/`<thead>` are present (as in unit tests), and can be enhanced with heuristics later. Integration tests should NOT assert that real filings have header rows.

The `isHeader` check for all-`<th>` rows:

```typescript
function isAllThRow(trNode: Element): boolean {
  const cellNodes = trNode.children.filter(
    c => isTag(c) && (c.name.toLowerCase() === 'td' || c.name.toLowerCase() === 'th')
  );
  return cellNodes.length > 0 && cellNodes.every(
    c => isTag(c) && c.name.toLowerCase() === 'th'
  );
}
```

### 4. Numeric value detection

SEC financial tables contain several numeric formats:

| Format | Example | Parsed value |
|--------|---------|-------------|
| Plain integer | `1,234` | `1234` |
| Decimal | `1,234.56` | `1234.56` |
| Currency | `$1,234` or `$ 1,234` | `1234` |
| Parenthetical negative | `(1,234)` | `-1234` |
| Percentage | `12.5%` or `12.5 %` | `12.5` |
| Negative with dash | `-1,234` or `- 1,234` | `-1234` |
| Em-dash / en-dash (zero/nil) | `--` or `---` | `0` |

```typescript
function tryParseNumeric(text: string): number | undefined {
  if (!text || text.trim().length === 0) return undefined;

  let s = text.trim();

  // Dash patterns meaning zero/nil
  if (/^[\u2014\u2013\u2012—–-]{1,3}$/.test(s)) return 0;

  // Strip currency symbol and percentage
  s = s.replace(/^\$\s*/, '');
  s = s.replace(/\s*%$/, '');

  // Detect parenthetical negative: (1,234.56) -> -1234.56
  const isParenNegative = s.startsWith('(') && s.endsWith(')');
  if (isParenNegative) {
    s = s.slice(1, -1).trim();
  }

  // Strip commas
  s = s.replace(/,/g, '');

  // Must look like a number at this point
  if (!/^-?\s*\d+(\.\d+)?$/.test(s)) return undefined;

  // Strip internal whitespace (handles "- 1234")
  s = s.replace(/\s+/g, '');

  const value = parseFloat(s);
  if (isNaN(value)) return undefined;

  return isParenNegative ? -value : value;
}
```

Note: We parse the **text content** of the cell, not the iXBRL attributes. The iXBRL `<ix:nonFraction>` tags have `scale` and `decimals` attributes that represent the XBRL-reported value (which may differ from the displayed text, e.g., displayed "3.1" with `scale="12"` means 3.1 trillion). Parsing iXBRL semantics is out of scope -- we extract what the human reader sees. The `numericValue` field represents the displayed numeric value.

### 5. Source location mapping

Every `TableRow` and `TableCell` gets a `SourceLocation`:

- `TableCell.source`: `{ start: tdNode.startIndex, end: tdNode.endIndex + 1 }`
- `TableRow.source`: `{ start: trNode.startIndex, end: trNode.endIndex + 1 }`
- `Table.source`: Already computed by content-extractor, clipped to section boundary

The `endIndex + 1` convention follows the existing pattern in section-extractor (htmlparser2's `endIndex` is inclusive; our `SourceLocation.end` is exclusive).

If `startIndex` or `endIndex` is null (should not happen with `withStartIndices: true`), emit a parse warning and use `0` as fallback.

### 6. The `includeSourceHtml` opt-in

Same pattern as content-extractor: if `context.includeSourceHtml` is true, populate `sourceHtml` on each `TableRow` and `TableCell` via `context.html.slice(source.start, source.end)`.

---

## Integration with content-extractor

The current content-extractor (lines 36-49) creates a stub:

```typescript
// Current code
if (name === 'table' && nodeStart >= start && nodeStart < end) {
  const source: SourceLocation = { start: nodeStart, end: clippedEnd };
  const table: Table = { type: 'table', rows: [], source };
  // ...
  blocks.push(table);
  return;
}
```

This becomes:

```typescript
// Modified code
if (name === 'table' && nodeStart >= start && nodeStart < end) {
  const clippedEnd = Math.min(nodeEnd, end);
  const source: SourceLocation = { start: nodeStart, end: clippedEnd };
  const table = extractTable(node, source, context);
  blocks.push(table);
  return;
}
```

The `extractTable()` function signature:

```typescript
export function extractTable(
  tableNode: Element,
  source: SourceLocation,
  context: ExtractionContext,
): Table;
```

The caller passes the pre-computed (clipped) `source` so the table-extractor doesn't need to know about section boundary clipping.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| **Empty table** (no `<tr>` elements) | Return `Table` with `rows: []` -- same as current stub behavior |
| **Table with only headers** (all rows in `<thead>`) | All rows have `isHeader: true`; `rows` array is non-empty |
| **Nested tables** (table inside a table cell) | Outer table's cell extraction uses `getTextContent()` which will accumulate text from the nested table. The nested `<table>` is NOT extracted as a separate `Table` block because content-extractor's `findBlocksInRange` does not recurse into `<table>` elements. The nested table's text becomes part of the outer cell's `text`. |
| **Layout tables** (used for page structure, not data) | Extracted the same as data tables. No layout-vs-data heuristic in v1. Downstream consumers (diff engine) can filter by row/cell count if needed. |
| **Cells spanning entire rows** (`colspan` equal to total columns) | Parsed normally; `colspan` value preserved on `TableCell` |
| **Missing colspan/rowspan attributes** | Default to 1 (via `parseInt(...) \|\| 1`) |
| **Cells with mixed content** (text + `<span>` + `<br>` + nested elements) | `getTextContent()` recursively extracts all text nodes; `<br>` tags produce a single space to prevent word concatenation |
| **iXBRL wrapped values** (`<ix:nonFraction>` inside cells) | htmlparser2 treats `ix:nonFraction` as a regular element; `getTextContent()` extracts the displayed text. The iXBRL `format`, `scale`, `decimals` attributes are ignored -- we parse the display value, not the XBRL value. |
| **`visibility:collapse` rows** (column-sizing rows in DFIN filings) | Extracted as regular rows with empty cell text. These are layout artifacts with self-closing `<td/>` producing empty cells. No filtering in v1 -- they are harmless but may inflate row counts in integration tests. Integration test assertions use `>=` thresholds to accommodate this. |
| **`<colgroup>` / `<col>` elements** | Ignored. These are styling hints, not data-bearing elements. `findRows()` skips non-`<tr>`/non-section elements. |
| **`<caption>` elements** | Ignored (not a row). If present, its text is not included in any cell. A future enhancement could add a `caption` field to `Table`. |
| **Null startIndex/endIndex** | Emit warning via `context.warnings.push()`, use `{ start: 0, end: 0 }` as fallback. Should not occur with `withStartIndices: true`. |
| **Self-closing `<td/>` elements** | Parsed as empty cells with `text: ''` and no `numericValue`. |
| **Unicode currency symbols** (EUR, GBP, etc.) | Only `$` is stripped for numeric parsing. Other currency symbols cause `tryParseNumeric` to return `undefined`. Enhancement for future if needed. |
| **Whitespace-only cells** (`&#160;` / `\u00a0`) | After normalization, text becomes `''` (empty). No `numericValue`. |

---

## Dependencies

No new external dependencies needed.

- **htmlparser2** (already installed) -- DOM tree with source indices
- **domhandler** (transitive dependency) -- `Element`, `isTag`, `isText` helpers

The `table-extractor.ts` imports from the same modules as `content-extractor.ts`:
```typescript
import type { Element, Node } from 'domhandler';
import { isTag, isText } from 'domhandler';
import type { Table, TableRow, TableCell, SourceLocation } from '../types.js';
import type { ExtractionContext } from './types.js';
```

---

## Design Decisions (Resolved)

These questions were resolved during design review with the tester:

1. **Mixed text with numbers:** `"$1,234 million"` -- `numericValue` is `undefined`. The trailing text makes the value ambiguous (is it 1,234 or 1,234,000,000?). `tryParseNumeric` only succeeds when the entire cleaned string is a valid number. This is validated by test T14.

2. **Whitespace-only cells:** Included in the row with `text: ''` (empty string after normalization). Unlike paragraphs (which are filtered when whitespace-only), table cells preserve structural position -- omitting them would break column alignment for downstream consumers. Validated by test T19.

3. **Nested tables:** Nested `<table>` inside a `<td>` is NOT extracted as a separate `Table` block. The nested table's text folds into the parent cell's `text` via `getTextContent()`. The content-extractor already skips recursing into `<table>` elements, so nested tables won't appear as separate blocks. This is simpler and matches the current content-extractor contract. Validated by test B5.

4. **Empty rows:** `<tr>` elements with no `<td>`/`<th>` children are included as rows with `cells: []`. This preserves document structure and source mappings. Downstream consumers can filter empty rows if needed. Validated by test E3.

5. **iXBRL numeric wrappers:** We parse the **displayed text content** only, not iXBRL attributes. `<ix:nonFraction>` tags have `scale`/`decimals` attributes that represent the XBRL-reported value (which may differ from what the human sees, e.g., displayed "3.1" with `scale="12"` means 3.1 trillion). Parsing iXBRL semantics is out of scope. Validated by test T18.

6. **`<tfoot>` rows:** `isHeader: false`. Footer rows are summary/total rows, not headers. Only `<thead>` context and all-`<th>` rows trigger `isHeader: true`. Validated by test T20.

7. **`<br>` handling in cells:** Insert a single space for `<br>` tags during text accumulation. This prevents word concatenation (`"Line1<br>Line2"` → `"Line1 Line2"` instead of `"Line1Line2"`). Implemented by modifying the **shared** `getTextContent()` in content-extractor (used by both paragraph and table extraction) -- if the node is a `<br>` tag, return `' '`. This is safe for paragraphs too since whitespace is collapsed during normalization.

8. **Percentage handling:** `tryParseNumeric("12.5%")` returns `12.5` (the displayed value, not `0.125`). This follows the "parse what the human sees" principle. Consistency across filings is what matters for the diff engine. Validated by test T10.

9. **Invalid colspan/rowspan:** Values of `0`, negative, or non-numeric all fall back to `1` via `Math.max(1, parseInt(...) || 1)`. Validated by test E4.

---

## Open Questions

1. **Layout table filtering:** Should we attempt to distinguish layout tables from data tables? Signals like single-row tables, `display:inline-table`, or `visibility:collapse` on all rows could indicate layout usage. Current design: extract all tables uniformly. Filtering is deferred to downstream consumers or a future enhancement. This may generate noise in the diff output but avoids false negatives.

2. **`<caption>` support:** Should the `Table` type include a `caption?: string` field? Some SEC tables have `<caption>` elements (e.g., "CONSOLIDATED BALANCE SHEETS"). Current design: ignore captions since the `Table` interface is already defined and should not be changed. Captions can be a future enhancement if needed by the diff engine.
