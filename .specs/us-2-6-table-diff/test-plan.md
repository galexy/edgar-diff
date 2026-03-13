# US-2.6: Table Diff Highlighting — Test Plan

## Overview

US-2.6 injects highlight markup into original table HTML at `CellDiff.sourceMapping` offsets. Cell-level changes show old/new values; added/removed rows are highlighted as blocks. The implementation follows the same source-map injection pattern as paragraph diffs (US-2.5): get `sourceMapping[side]`, convert absolute offsets to relative within the section, extract/wrap HTML, apply replacements in reverse offset order.

The test strategy splits into two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — verify DOM structure, CSS class injection, offset mapping, and accessibility
2. **Visual validation** (Chrome DevTools MCP) — verify highlight colors, table layout preservation, and complex HTML edge cases (see `uat.md`)

### Architecture (aligned with implementation design)

**Critical design difference from paragraphs:** Tables have strict HTML content models — `<ins>`/`<del>` cannot be children of `<table>`, `<tbody>`, or `<tr>`. Instead of wrapping elements like US-2.5, we **inject CSS classes** directly into existing `<tr>`, `<td>`, and `<th>` opening tags. Semantic `<ins>`/`<del>` elements are only used _inside_ modified cell content for old→new value annotations.

The implementation extends `applyHighlightsToSection` in `highlight-injector.ts` to process `SectionDiff.tableDiffs[]` alongside the existing `paragraphDiffs[]`. New functions:

- **`injectClass(openingTag, className)`** — injects a CSS class into an HTML opening tag string (appends to existing `class=` or adds new attribute)
- **`highlightCell(cellHtml, cellDiff, side)`** — highlights a single cell: injects class on `<td>`/`<th>` tag, and for modified cells, replaces inner content with `<del>old</del> → <ins>new</ins>` annotation
- **`wrapRow(rowHtml, changeType)`** — injects row-level class into the `<tr>` opening tag for added/removed rows

Modified function:
- **`applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, tableIndex, side)`** — extended with new `tableIndex` parameter; after paragraph processing loop, adds table processing loop

New function in `FilingContent.tsx`:
- **`buildTableIndex(document)`** — builds `Map<string, Table>` from document sections, mirroring `buildParagraphIndex`

### Key Types

```typescript
interface CellDiff {
  row: number; col: number;
  changeType: ChangeType;
  oldValue?: string; newValue?: string;
  oldNumericValue?: number; newNumericValue?: number;
  sourceMapping: DiffRange; // { old?: SourceLocation, new?: SourceLocation }
}

interface RowDiff {
  oldRowIndex?: number; newRowIndex?: number;
  changeType: ChangeType;
  cellDiffs: CellDiff[];
}

interface TableDiff {
  changeType: ChangeType;
  rowDiffs: RowDiff[];
  cellDiffs: CellDiff[];
  sourceMapping: DiffRange;
  summary: { rowsAdded, rowsRemoved, rowsModified, rowsUnchanged, cellsChanged };
}
```

### RowDiff → Table.rows lookup

Since `RowDiff` lacks its own `sourceMapping`, row-level highlighting uses `RowDiff.oldRowIndex`/`newRowIndex` to look up `Table.rows[index].source` for the `<tr>` offset range. This is bridged via `buildTableIndex`.

---

## 1. BDD Acceptance Criteria

### AC-1: Modified cell highlighted with old → new values

```gherkin
Scenario: A modified cell shows old and new values with class injection
  Given a FilingContent with sectionDiffs containing a TableDiff
  And the TableDiff has a CellDiff with changeType 'modified'
  And the CellDiff has oldValue="$1,000" and newValue="$1,234"
  When the filing content is rendered
  Then the <td> element has class "diff-cell-modified"
  And the cell inner content contains <del class="diff-removed">$1,000</del>
  And the cell inner content contains <ins class="diff-added">$1,234</ins>
  And a "→" separator appears between the old and new values
```

### AC-2: Added cell highlighted green

```gherkin
Scenario: An added cell is highlighted with green via CSS class
  Given a FilingContent with sectionDiffs containing a TableDiff
  And the TableDiff has a CellDiff with changeType 'added'
  And side is "new"
  When the filing content is rendered
  Then the <td> element has class "diff-cell-added"
  And the original cell content is preserved
```

### AC-3: Removed cell highlighted red

```gherkin
Scenario: A removed cell is highlighted with red via CSS class
  Given a FilingContent with sectionDiffs containing a TableDiff
  And the TableDiff has a CellDiff with changeType 'removed'
  And side is "old"
  When the filing content is rendered
  Then the <td> element has class "diff-cell-removed"
  And the original cell content is preserved
```

### AC-4: Added row highlighted as a block

```gherkin
Scenario: An entirely new row is highlighted as a block via CSS class
  Given a FilingContent with sectionDiffs containing a TableDiff
  And the TableDiff has a RowDiff with changeType 'added'
  And side is "new"
  When the filing content is rendered
  Then the <tr> element has class "diff-row-added"
  And all cells in the row inherit the highlight via CSS cascade
```

### AC-5: Removed row highlighted as a block

```gherkin
Scenario: A removed row is highlighted as a block via CSS class
  Given a FilingContent with sectionDiffs containing a TableDiff
  And the TableDiff has a RowDiff with changeType 'removed'
  And side is "old"
  When the filing content is rendered
  Then the <tr> element has class "diff-row-removed"
  And all cells in the row inherit the highlight via CSS cascade
```

### AC-6: Unchanged table renders unmodified

```gherkin
Scenario: An unchanged table renders as original HTML
  Given a FilingContent with sectionDiffs containing a TableDiff with changeType 'unchanged'
  When the filing content is rendered
  Then no diff-* CSS classes are injected into table elements
  And no <ins> or <del> elements appear in the table
```

### AC-7: Original table structure preserved

```gherkin
Scenario: Table structure (headers, colspan, rowspan, styling) is preserved after highlighting
  Given original HTML with a table containing headers, colspan, rowspan, and inline styles
  And there are cell-level modifications
  When the filing content is rendered
  Then all <th>, <td>, <tr>, <thead>, <tbody> elements are preserved
  And colspan and rowspan attributes remain unchanged
  And inline styles on table elements remain unchanged
  And the diff-* class is appended alongside existing classes
```

### AC-8: Side-specific filtering for tables

```gherkin
Scenario: Old panel shows only removed highlights, new panel shows only added highlights
  Given a TableDiff with both added and removed rows/cells
  When rendered with side="old"
  Then only diff-row-removed and diff-cell-removed classes appear
  And no diff-row-added or diff-cell-added classes appear
  When rendered with side="new"
  Then only diff-row-added and diff-cell-added classes appear
  And no diff-row-removed or diff-cell-removed classes appear
```

### AC-9: No-op without diff data

```gherkin
Scenario: FilingContent without sectionDiffs renders tables normally
  Given a FilingContent with a table in the document but no sectionDiffs prop
  When the filing content is rendered
  Then no diff-* CSS classes are injected
  And no <ins> or <del> elements appear in the table
  And the table output is identical to US-2.3 behavior
```

### AC-10: Mixed paragraph and table diffs in same section

```gherkin
Scenario: Section with both paragraph diffs and table diffs renders both
  Given a SectionDiff with both paragraphDiffs and tableDiffs
  When the filing content is rendered
  Then paragraph highlights are applied correctly (using <ins>/<del> wrappers)
  And table highlights are applied correctly (using CSS class injection)
  And neither interferes with the other
```

---

## 2. Unit Tests — `highlight-injector.ts`

File: `apps/web/src/lib/highlight-injector.test.ts` (extends existing test file)

### 2.1 `injectClass` — CSS class injection into HTML opening tags

| ID | Test | Rationale |
|----|------|-----------|
| IC-U1 | Injects class into `<tr>` without existing class attribute: `<tr>` → `<tr class="diff-row-added">` | Happy path — no existing class |
| IC-U2 | Appends class to `<td class="existing">` → `<td class="existing diff-cell-modified">` | Append to existing class |
| IC-U3 | Injects class into `<th>` tag correctly | Header cell support |
| IC-U4 | Preserves other attributes (`style`, `colspan`, `rowspan`, `id`) | Attribute preservation |
| IC-U5 | Handles single-quoted class attribute: `<td class='num'>` → `<td class='num diff-cell-added'>` | Quote style flexibility |
| IC-U6 | Handles tag with no attributes: `<td>` → `<td class="diff-cell-removed">` | Minimal tag |
| IC-U7 | Handles tag with only style attribute: `<td style="color:red">` → `<td class="diff-cell-modified" style="color:red">` | Class inserted before other attrs |
| IC-U8 | Case-insensitive tag matching: `<TR>`, `<TD>`, `<TH>` | SEC filing HTML may use uppercase |

### 2.2 `highlightCell` — single cell highlighting

| ID | Test | Rationale |
|----|------|-----------|
| HC-U1 | Added cell: injects `diff-cell-added` class on `<td>`, preserves inner content | Cell addition |
| HC-U2 | Removed cell: injects `diff-cell-removed` class on `<td>`, preserves inner content | Cell removal |
| HC-U3 | Modified cell: injects `diff-cell-modified` class AND replaces inner content with old→new annotation | Cell modification (AC-1) |
| HC-U4 | Modified cell annotation contains `<del class="diff-removed">oldValue</del>` | Old value semantic markup |
| HC-U5 | Modified cell annotation contains `<ins class="diff-added">newValue</ins>` | New value semantic markup |
| HC-U6 | Modified cell annotation contains `→` separator between old and new | Arrow separator |
| HC-U7 | Modified cell with `<th>` tag — correct closing tag detected (`</th>` not `</td>`) | Header cell detection |
| HC-U8 | Values with `&`, `<`, `>` are HTML-escaped in annotation | XSS prevention |
| HC-U9 | Unchanged cell: returns original HTML unmodified | No-op for unchanged |
| HC-U10 | Cell with existing class: `diff-cell-*` class appended via `injectClass` | Class merging |

### 2.3 `wrapRow` — row-level class injection

| ID | Test | Rationale |
|----|------|-----------|
| WR-U1 | Added row: injects `diff-row-added` class on `<tr>` tag | Row-level addition |
| WR-U2 | Removed row: injects `diff-row-removed` class on `<tr>` tag | Row-level removal |
| WR-U3 | Row with multiple `<td>` cells — all cells preserved, only `<tr>` tag modified | Only `<tr>` tag changed |
| WR-U4 | Row with `<th>` header cells — `<tr>` class injected, `<th>` untouched | Header row |
| WR-U5 | Row with existing class on `<tr>` — diff class appended | Class merging |

### 2.4 `applyHighlightsToSection` — table processing within section

| ID | Test | Rationale |
|----|------|-----------|
| AT-U1 | Single modified cell within a table — only that cell gets `diff-cell-modified` class | Precision targeting |
| AT-U2 | Multiple modified cells in same table — each gets its own class + annotation | Multi-cell modification |
| AT-U3 | Added row on new side — `<tr>` gets `diff-row-added` class | Row-level addition |
| AT-U4 | Removed row on old side — `<tr>` gets `diff-row-removed` class | Row-level removal |
| AT-U5 | Mixed row types (added, removed, modified, unchanged) in one table | Complex table diff |
| AT-U6 | `sectionOffset > 0` — absolute SourceLocation offsets converted to relative correctly | Non-zero section start |
| AT-U7 | Replacements applied in reverse offset order (verified via output correctness) | Offset preservation |
| AT-U8 | Added row/cell ignored on old side (no `old` sourceMapping / rowIndex) | Side-specific filtering |
| AT-U9 | Removed row/cell ignored on new side (no `new` sourceMapping / rowIndex) | Side-specific filtering |
| AT-U10 | TableDiff with changeType 'unchanged' — no classes injected | Unchanged table passthrough |
| AT-U11 | `tableIndex` lookup failure (table key not found) — table diff skipped gracefully | Missing table guard |
| AT-U12 | `rowIndex` out of bounds — row diff skipped gracefully | Out-of-bounds row guard |

### 2.5 `buildTableIndex` — table lookup map

| ID | Test | Rationale |
|----|------|-----------|
| TI-U1 | Builds map from document with one section containing one table | Happy path |
| TI-U2 | Builds map from document with multiple sections and tables | Multi-table |
| TI-U3 | Ignores paragraph blocks (only indexes `type: 'table'`) | Selective indexing |
| TI-U4 | Empty document (no sections) returns empty map | Empty boundary |
| TI-U5 | Uses `"start:end"` key format matching `buildParagraphIndex` pattern | Key format consistency |

### 2.6 Integration with existing paragraph highlighting

| ID | Test | Rationale |
|----|------|-----------|
| MX-U1 | `applyHighlightsToSection` processes both paragraphDiffs and tableDiffs in same call | Mixed content orchestration |
| MX-U2 | Table replacement offsets do not conflict with paragraph replacement offsets | Offset isolation (sibling blocks) |
| MX-U3 | Order of paragraph vs table in HTML does not affect output correctness | Order independence |
| MX-U4 | Existing paragraph highlight tests still pass with new `tableIndex` parameter | Backward compatibility |

---

## 3. Integration Tests — `FilingContent` with Table Highlights

File: `apps/web/src/components/FilingContent.test.tsx` (extends existing test file)

### 3.1 No-op without diff data

| ID | Test | Rationale |
|----|------|-----------|
| TFC-I1 | `FilingContent` with a table but no `sectionDiffs` renders table normally — no diff-* classes | No-op (AC-9) |
| TFC-I2 | Table with `sectionDiffs` but empty `tableDiffs: []` — table unmodified | Empty tableDiffs no-op |

### 3.2 Cell-level changes

| ID | Test | Rationale |
|----|------|-----------|
| TFC-I3 | Modified cell: `<td>` has `diff-cell-modified` class, inner HTML shows `<del>old</del> → <ins>new</ins>` | Cell-level modification (AC-1) |
| TFC-I4 | Added cell on new side: `<td>` has `diff-cell-added` class, original content preserved | Cell addition (AC-2) |
| TFC-I5 | Removed cell on old side: `<td>` has `diff-cell-removed` class, original content preserved | Cell removal (AC-3) |
| TFC-I6 | Unchanged cell in a modified row: no diff-* class on `<td>` | Precision — only changed cells highlighted |

### 3.3 Row-level changes

| ID | Test | Rationale |
|----|------|-----------|
| TFC-I7 | Added row on new side: `<tr>` has `diff-row-added` class | Row-level addition (AC-4) |
| TFC-I8 | Removed row on old side: `<tr>` has `diff-row-removed` class | Row-level removal (AC-5) |
| TFC-I9 | Unchanged row: no diff-* classes on `<tr>` or its children | Unchanged passthrough (AC-6) |

### 3.4 Side filtering

| ID | Test | Rationale |
|----|------|-----------|
| TFC-I10 | `side="old"`: `diff-row-removed`/`diff-cell-removed` classes present, no added classes | Old-side filtering (AC-8) |
| TFC-I11 | `side="new"`: `diff-row-added`/`diff-cell-added` classes present, no removed classes | New-side filtering (AC-8) |
| TFC-I12 | Added row ignored on old side (rowIndex undefined for old) — no classes injected | Side-specific sourceMapping |
| TFC-I13 | Modified cell shows old→new annotation on both sides (same content, different class accent) | Both-sides annotation |

### 3.5 Table structure preservation

| ID | Test | Rationale |
|----|------|-----------|
| TFC-I14 | `<table>`, `<tr>`, `<td>`, `<th>` elements all present after highlighting | Structure preservation (AC-7) |
| TFC-I15 | `colspan` attribute preserved on highlighted cell | Attribute preservation (AC-7) |
| TFC-I16 | `rowspan` attribute preserved on highlighted cell | Attribute preservation (AC-7) |
| TFC-I17 | Inline `style` attributes on table elements preserved alongside injected class | Style preservation (AC-7) |
| TFC-I18 | `<thead>` and `<tbody>` elements preserved | Semantic table structure (AC-7) |
| TFC-I19 | Pre-existing CSS class on `<td>` preserved alongside diff-* class | Class merging (AC-7) |

### 3.6 Mixed content in section

| ID | Test | Rationale |
|----|------|-----------|
| TFC-I20 | Section with both paragraph diffs AND table diffs renders both correctly | Mixed content (AC-10) |
| TFC-I21 | Multiple tables in a section — each processed independently | Multi-table section |
| TFC-I22 | Table between two paragraphs — all three get correct highlights | Interleaved content |

---

## 4. Boundary Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| BC-1 | Empty table (`<table></table>`, no rows) | Does not crash; table renders as-is |
| BC-2 | Single-cell table (`<table><tr><td>X</td></tr></table>`) | Class applied correctly to the single cell |
| BC-3 | Table with only header rows (`<thead><tr><th>...</th></tr></thead>`, no `<tbody>`) | Classes applied to `<th>` elements if changed |
| BC-4 | Cell with `colspan="3"` — modified | `diff-cell-modified` class injected, colspan preserved |
| BC-5 | Cell with `rowspan="2"` — modified | `diff-cell-modified` class injected, rowspan preserved |
| BC-6 | Cell with both `colspan` and `rowspan` — modified | Both attributes preserved alongside injected class |
| BC-7 | Table with nested HTML in cells (`<td><b>bold</b> text</td>`) — added/removed | Inner HTML preserved (class injection only); for modified cells, inner HTML replaced with text-based annotation |
| BC-8 | Table with empty cells (`<td></td>`) — added | Does not crash; empty cell gets class |
| BC-9 | TableDiff with no cell changes (`cellDiffs: []`, all rows unchanged) | No classes injected; table renders as-is |
| BC-10 | Large table (50+ rows, all unchanged) | Does not crash; renders without any diff classes |
| BC-11 | Table with `<caption>` element | Caption preserved, not affected by row/cell class injection |
| BC-12 | Cell containing numeric value "0" (falsy but valid) | Correctly handled as old/new value, not treated as missing |
| BC-13 | Modified cell where oldValue equals newValue (edge case) | Renders annotation with identical values; does not crash |
| BC-14 | Modified cell with HTML content in original (`<td><b>$1,234</b></td>`) | Inner HTML replaced with text-based old→new annotation (formatting loss accepted for MVP) |
| BC-15 | Table with existing class on `<tr>` (`<tr class="total-row">`) | Diff class appended: `<tr class="total-row diff-row-removed">` |

---

## 5. Error Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| EC-1 | CellDiff sourceMapping with missing `old` and `new` locations | Does not crash; cell skipped |
| EC-2 | CellDiff sourceMapping start > HTML length (offset 9999) | Does not crash; cell diff skipped (bounds check) |
| EC-3 | CellDiff sourceMapping with inverted range (start > end) | Does not crash; cell diff skipped (bounds check) |
| EC-4 | TableDiff sourceMapping missing entirely (no old or new) | Does not crash; table diff skipped |
| EC-5 | RowDiff with empty cellDiffs array (modified row, no cells changed) | Does not crash; row renders as-is |
| EC-6 | RowDiff.oldRowIndex / newRowIndex beyond `table.rows.length` | Does not crash; row diff skipped (bounds check) |
| EC-7 | TableDiff.changeType is 'modified' but all rowDiffs are 'unchanged' | Does not crash; table renders unmodified |
| EC-8 | SectionDiff ID does not match any document section (table diff orphaned) | Section renders unmodified — no classes injected |
| EC-9 | Malformed table HTML (unclosed `<td>`, missing `</tr>`) | Does not crash; best-effort rendering |
| EC-10 | Style block within table shifts cell offsets after `stripStyleBlocks` | Does not crash; content renders (highlight may misalign) |
| EC-11 | Negative sourceMapping offsets | Does not crash; clamped or skipped |
| EC-12 | Table key not found in `tableIndex` (document/diff data misalignment) | Does not crash; table diff skipped |
| EC-13 | `injectClass` called with tag that has no `>` (malformed) | Does not crash; returns original string |

---

## 6. Accessibility Tests

| ID | Test | Rationale |
|----|------|-----------|
| A11Y-1 | Modified cell content uses semantic `<del>` for old value | Screen readers announce deletion |
| A11Y-2 | Modified cell content uses semantic `<ins>` for new value | Screen readers announce insertion |
| A11Y-3 | Cell-level diff classes (`diff-cell-added`, `diff-cell-removed`, `diff-cell-modified`) enable non-color CSS indicators | WCAG: not color-only (border, background pattern via CSS) |
| A11Y-4 | Row-level diff classes (`diff-row-added`, `diff-row-removed`) enable non-color CSS indicators | WCAG: not color-only (left border in CSS) |
| A11Y-5 | Table `<th>` header elements remain accessible after class injection | Table semantics preserved for screen readers |
| A11Y-6 | `colspan`/`rowspan` attributes preserved — table navigation still works with assistive tech | Structural integrity for AT |
| A11Y-7 | Modified cell reading order: old value, separator, new value — logical for screen readers | Content order |
| A11Y-8 | `<thead>`/`<tbody>` structure preserved — table regions still announced | Semantic regions |

> **Known accessibility gap:** Row-level and cell-level added/removed changes use CSS classes only (no semantic `<ins>`/`<del>` wrappers) because HTML content models forbid `<ins>`/`<del>` as children of `<table>`/`<tr>`. Screen readers will not announce these as insertions/deletions. Only modified cell content uses `<ins>`/`<del>` semantically. This is a trade-off for valid HTML. Future enhancement: add `aria-label` or `title` attributes for accessibility context.

---

## 7. Test Data Strategy

### Fixture helpers needed

| Helper | Purpose |
|--------|---------|
| `makeDoc(html, sections)` | Reuse from existing `FilingContent.test.tsx` |
| `makeSection(id, heading, start, end, blocks?)` | Reuse — works with both `Paragraph` and `Table` blocks |
| `makeTable(rows, start, end)` | New — creates `Table` with source mapping |
| `makeTableRow(cells, start, end, isHeader?)` | New — creates `TableRow` with source mapping |
| `makeTableCell(text, start, end, opts?)` | New — creates `TableCell` with source mapping; opts: `{ colspan?, rowspan?, numericValue? }` |
| `makeTableDiff(changeType, rowDiffs, cellDiffs, oldSource?, newSource?)` | New — creates `TableDiff` with summary |
| `makeRowDiff(changeType, cellDiffs, oldRowIndex?, newRowIndex?)` | New — creates `RowDiff` |
| `makeCellDiff(row, col, changeType, opts?)` | New — creates `CellDiff`; opts: `{ oldSource?, newSource?, oldValue?, newValue? }` |
| `makeSectionDiffWithTables(id, heading, paragraphDiffs, tableDiffs, changeType?)` | New — creates `SectionDiff` with both paragraphDiffs and tableDiffs |

### Sample HTML snippets for testing

| Name | HTML | Use case |
|------|------|----------|
| Simple 2x2 table | `<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>` | Basic table baseline |
| Table with headers | `<table><thead><tr><th>Col1</th><th>Col2</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>` | Header row handling |
| Table with colspan | `<table><tr><td colspan="2">Spanning</td></tr><tr><td>A</td><td>B</td></tr></table>` | Colspan preservation |
| Table with rowspan | `<table><tr><td rowspan="2">Span</td><td>A</td></tr><tr><td>B</td></tr></table>` | Rowspan preservation |
| Table with styled cells | `<table><tr><td style="text-align:right;font-weight:bold;">$100</td></tr></table>` | Inline style preservation |
| Table with existing class | `<table><tr class="total"><td class="num">100</td></tr></table>` | Class merging |
| Table with nested HTML | `<table><tr><td><b>Bold</b> and <i>italic</i></td></tr></table>` | Nested content in cells |
| Empty table | `<table></table>` | Empty boundary |
| Single-cell table | `<table><tr><td>Only</td></tr></table>` | Minimal table |
| Table with caption | `<table><caption>Revenue</caption><tr><td>100</td></tr></table>` | Caption preservation |
| Financial table | `<table><tr><th>Item</th><th>2024</th><th>2023</th></tr><tr><td>Revenue</td><td>$1,000</td><td>$900</td></tr></table>` | Real-world SEC filing pattern |
| Mixed content section | `<p>Text before.</p><table><tr><td>Cell</td></tr></table><p>Text after.</p>` | Paragraph + table + paragraph |
| Uppercase tags | `<TABLE><TR><TD>Data</TD></TR></TABLE>` | SEC filing HTML may use uppercase |

---

## 8. CSS Classes

New CSS classes in `apps/web/src/components/highlight.css`:

| Class | Applied to | Visual effect | Test verification |
|-------|-----------|---------------|-------------------|
| `diff-row-added` | `<tr>` | Green-50 background + left border on all child `<td>`/`<th>` via CSS cascade | Check `<tr>` has class |
| `diff-row-removed` | `<tr>` | Red-50 background + left border on all child `<td>`/`<th>` via CSS cascade | Check `<tr>` has class |
| `diff-cell-added` | `<td>` / `<th>` | Green-100 background | Check element has class |
| `diff-cell-removed` | `<td>` / `<th>` | Red-100 background | Check element has class |
| `diff-cell-modified` | `<td>` / `<th>` | Yellow-50 background | Check element has class |
| `diff-removed` (reused) | `<del>` inside modified cell | Red-800 text + strikethrough | Check `<del>` in cell |
| `diff-added` (reused) | `<ins>` inside modified cell | Green-800 text + bold | Check `<ins>` in cell |
| `diff-arrow` | `<span>` inside modified cell | Gray-500 arrow separator | Check `→` in cell |

---

## 9. Test File Organization

```
apps/web/src/
  lib/
    highlight-injector.ts          # Extended with: injectClass, highlightCell, wrapRow
                                   # Modified: applyHighlightsToSection (+ tableIndex param)
    highlight-injector.test.ts     # Unit tests (IC-*, HC-*, WR-*, AT-*, TI-*, MX-*)
  components/
    FilingContent.tsx              # Extended: buildTableIndex, passes tableIndex to applyHighlightsToSection
    FilingContent.test.tsx         # Integration tests (TFC-I*) + existing US-2.3/2.5 tests
    highlight.css                  # Extended with table highlight CSS classes

.specs/us-2-6-table-diff/
  test-plan.md                    # This file
  uat.md                          # Visual validation scenarios (future)
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 10. Testing Limitations (jsdom)

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No CSS computed styles | Cannot verify green/red/yellow backgrounds on cells | Verify CSS class presence; UAT for visual check |
| No CSS cascade verification | Cannot verify `tr.diff-row-added > td` inherits background | Verify class on `<tr>`; UAT for cascade |
| No table layout rendering | Cannot verify colspan/rowspan visual spanning | Verify attribute preservation in DOM |
| No text-decoration rendering | Cannot verify strikethrough on `<del>` in modified cells | Verify CSS class; `<del>` has browser defaults |
| No color contrast checking | Cannot verify WCAG AA compliance on table backgrounds | UAT visual check |

### What jsdom CAN verify (and we test thoroughly)

- CSS classes injected on correct elements (`<tr>` for rows, `<td>`/`<th>` for cells)
- Correct class names (`diff-row-added`, `diff-cell-modified`, etc.)
- `<del>`/`<ins>` elements present inside modified cells with correct text content
- Old→new annotation structure (old value, arrow, new value)
- Table structure preservation (colspan, rowspan, thead, tbody, th, td, caption)
- Existing CSS classes preserved alongside injected diff classes
- Source-map offset conversion accuracy
- Side-specific filtering (old shows only removals, new shows only additions)
- Error resilience (bad offsets, missing data, out-of-bounds row indices)
- No-op behavior (no sectionDiffs = no highlights, unchanged table = no highlights)
- Mixed content (paragraphs + tables in same section, non-overlapping offsets)
- `buildTableIndex` correct key generation
- `injectClass` handles various tag shapes (with/without existing class, different quote styles)
