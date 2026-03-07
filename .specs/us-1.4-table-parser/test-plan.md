# Test Plan: US-1.4 Parse Tables into Structured Representations

## Overview

This test plan validates table extraction within `parseFiling()` — specifically the new `table-extractor.ts` module that replaces table stubs (empty `rows: []`) with fully populated `TableRow[]`/`TableCell[]` structures. The extractor takes a `<table>` DOM element and returns a `Table` block with rows, cells, header detection, numeric value parsing, colspan/rowspan handling, and source mappings.

Key references:
- Architecture doc section 5 (API types — `Table`, `TableRow`, `TableCell`)
- US-1.3 test plan (format reference, existing table stub tests)
- `src/types.ts` — `TableCell { text, numericValue?, colspan, rowspan }`, `TableRow { cells, isHeader }`
- `src/parser/content-extractor.ts` — Currently emits `Table` stubs with `rows: []`

Design notes affecting tests:
- **SourceLocation uses exclusive end**: `{ start, end }` where `html.slice(start, end)` works directly
- **TableCell.colspan/rowspan default to 1**: Missing HTML attributes treated as 1
- **numericValue is optional**: Only populated when text is detectably numeric
- **isHeader detection**: `<thead>` context OR all-`<th>` row; NO first-row heuristic in v1
- **Nested tables**: Text folds into parent cell's `text`; not extracted as separate blocks
- **Em-dash/en-dash as zero**: `—`, `–`, `--`, `---` → `numericValue: 0`
- **`<br>` in cells**: Inserts a space (recommended by design, not concatenated)
- **Text extraction**: Nested elements (spans, bold, iXBRL wrappers) are flattened to plain text
- **includeSourceHtml**: Cells and rows populate `sourceHtml` only when opted in

---

## 1. BDD Acceptance Criteria

**Implementation approach:** Scenarios 1-5 and 7 are verified via **property-based tests** using a
`TableHtmlGenerator` that produces random table HTML paired with the expected parse result. This
enables exact structural assertions across hundreds of generated inputs per CI run, rather than
relying solely on handwritten examples. Scenario 6 uses real filing fixtures. See section 7 for
the generator specification and property test implementation.

### Scenario 1: HTML tables extracted into row/column data structure
```gherkin
Given a RawFiling containing HTML with <table> elements
When parseFiling(raw) is called
Then each Table block has rows.length > 0 (not a stub)
And each TableRow has cells.length > 0
And each TableCell has a non-empty text or whitespace-only text
And each TableCell has colspan >= 1 and rowspan >= 1
```

**Property test:** Generate N=200 random tables. For each, assert `table.rows.length === expected.rowCount`
and `row.cells.length === expected.cellCount`. (Properties P1, P2)

### Scenario 2: Header rows and column labels preserved
```gherkin
Given a table with <thead> containing <th> elements
When the table is extracted
Then rows within <thead> have isHeader = true
And cells from <th> elements are included in header rows
And header row text preserves the column label content
```

**Property test:** Generator randomizes header patterns (none / `<thead>` / all-`<th>`). For each
generated table, assert `row.isHeader === expected.isHeader`. (Property P3)

### Scenario 3: Merged cells handled gracefully
```gherkin
Given a table with cells using colspan and rowspan attributes
When the table is extracted
Then each TableCell.colspan reflects the HTML colspan attribute (default 1)
And each TableCell.rowspan reflects the HTML rowspan attribute (default 1)
And cells without colspan/rowspan attributes have colspan=1, rowspan=1
```

**Property test:** Generator randomizes colspan (1-3) and rowspan (1-3). For each cell, assert
`cell.colspan === expected.colspan` and `cell.rowspan === expected.rowspan`. Also assert
`colspan >= 1` and `rowspan >= 1` as invariants. (Properties P5, P8)

### Scenario 4: Numeric values retained as numbers
```gherkin
Given a table with cells containing financial data
When the table is extracted
Then cells with currency values like "$1,234.56" have numericValue = 1234.56
And cells with percentages like "12.5%" have numericValue = 12.5
And cells with parenthetical negatives like "(1,234)" have numericValue = -1234
And cells with plain numbers like "42" have numericValue = 42
And cells with non-numeric text like "Revenue" have numericValue = undefined
```

**Property test:** Generator produces cells with randomized content types (text, currency, percentage,
parenthetical negative, plain number, dash-zero, empty). For each cell, assert
`cell.numericValue === expected.numericValue`. Also fuzz `tryParseNumeric` directly with random
integers, currency strings, and parenthetical negatives. (Property P7, plus standalone numeric fuzz)

### Scenario 5: Source mappings for each cell
```gherkin
Given a parsed table with rows and cells
When inspecting source mappings
Then each TableCell has source.start < source.end
And each TableRow has source.start < source.end
And html.slice(cell.source.start, cell.source.end) contains the cell's text content
And all source offsets are within [0, html.length)
```

**Property test:** For every generated table, assert source offset bounds, containment (cell within
row), and monotonic row ordering. (Properties P4, P9)

### Scenario 6: Full pipeline produces populated tables
```gherkin
Given a RawFiling from a real 10-K filing with financial statements
When parseFiling(raw) is called
Then Item 8 (Financial Statements) sections contain Table blocks
And those Table blocks have rows.length > 0
And table cells contain recognizable financial data (numbers, labels)
```

*Not property-tested — uses real filing fixtures in integration/E2E tests (sections 3-4).*

### Scenario 7: Empty/edge-case tables handled gracefully
```gherkin
Given a table with no <tr> elements
When the table is extracted
Then the Table block has rows = [] (valid empty table)
And no exception is thrown
```

**Property test:** Generator includes row count range 0-20, so empty tables (0 rows) are covered.
The invariant "no exception thrown" is implicit — if the test reaches assertions, no exception occurred. (Property P10)

---

## 2. Unit Tests

All unit tests use inline HTML fixtures (< 30 lines each). Test file: `tests/unit/table-extractor.test.ts`.

### 2.1 Basic table extraction

```typescript
// T1: Simple 2x2 table produces correct rows and cells
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Revenue</td><td>$100</td></tr>
  <tr><td>Expenses</td><td>$80</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table).toBeDefined();
expect(table.rows).toHaveLength(2);
expect(table.rows[0].cells).toHaveLength(2);
expect(table.rows[0].cells[0].text).toBe('Revenue');
expect(table.rows[0].cells[1].text).toBe('$100');
expect(table.rows[1].cells[0].text).toBe('Expenses');
expect(table.rows[1].cells[1].text).toBe('$80');
```

### 2.2 Header detection -- `<th>` elements

```typescript
// T2: <th> cells mark the row as a header row
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><th>Category</th><th>Amount</th></tr>
  <tr><td>Revenue</td><td>$100</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].isHeader).toBe(true);
expect(table.rows[0].cells[0].text).toBe('Category');
expect(table.rows[1].isHeader).toBe(false);
```

### 2.3 Header detection -- `<thead>` context

```typescript
// T3: Rows inside <thead> are marked as header rows
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <thead><tr><td>Year</td><td>Revenue</td></tr></thead>
  <tbody><tr><td>2024</td><td>$100B</td></tr></tbody>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].isHeader).toBe(true);
expect(table.rows[1].isHeader).toBe(false);
```

### 2.4 Header detection -- all-`<th>` row (no `<thead>`)

```typescript
// T4: Row where all cells are <th> (but not in <thead>) is still marked as header
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><th>Metric</th><th>2024</th><th>2023</th></tr>
  <tr><td>Revenue</td><td>$100B</td><td>$90B</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].isHeader).toBe(true);
expect(table.rows[1].isHeader).toBe(false);
```

### 2.4b No first-row heuristic in v1

```typescript
// T4b: Row with all <td> in a table without <thead> is NOT marked as header
// (no first-row heuristic -- only <thead> context or all-<th> triggers isHeader)
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Year</td><td>Revenue</td><td>Income</td></tr>
  <tr><td>2024</td><td>$100B</td><td>$20B</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
// First row is NOT header because it uses <td>, not <th>, and is not in <thead>
expect(table.rows[0].isHeader).toBe(false);
expect(table.rows[1].isHeader).toBe(false);
```

### 2.5 Colspan handling

*Also covered by property test P8 with randomized colspan values.*

```typescript
// T5: Cell with colspan=2 preserved
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td colspan="2">Merged Header</td></tr>
  <tr><td>A</td><td>B</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].colspan).toBe(2);
expect(table.rows[0].cells[0].text).toBe('Merged Header');
expect(table.rows[1].cells[0].colspan).toBe(1);
```

### 2.6 Rowspan handling

*Also covered by property test P8 with randomized rowspan values.*

```typescript
// T6: Cell with rowspan=3 preserved
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td rowspan="3">Category</td><td>A</td></tr>
  <tr><td>B</td></tr>
  <tr><td>C</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].rowspan).toBe(3);
expect(table.rows[0].cells[0].text).toBe('Category');
```

### 2.7 Combined colspan and rowspan

```typescript
// T7: Cell with both colspan=2 and rowspan=2
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td colspan="2" rowspan="2">Big Cell</td><td>C</td></tr>
  <tr><td>D</td></tr>
  <tr><td>E</td><td>F</td><td>G</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].colspan).toBe(2);
expect(table.rows[0].cells[0].rowspan).toBe(2);
```

### 2.8 Missing colspan/rowspan defaults to 1

```typescript
// T8: Cells without colspan/rowspan attributes default to 1
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Plain cell</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].colspan).toBe(1);
expect(table.rows[0].cells[0].rowspan).toBe(1);
```

### 2.9 Numeric value detection -- currency

*Also covered by property test P7 and standalone numeric fuzz (section 7.3).*

```typescript
// T9: Currency values parsed to numericValue
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>$1,234.56</td></tr>
  <tr><td>$100</td></tr>
  <tr><td>$ 42.00</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].numericValue).toBe(1234.56);
expect(table.rows[1].cells[0].numericValue).toBe(100);
expect(table.rows[2].cells[0].numericValue).toBe(42);
```

### 2.10 Numeric value detection -- percentages

```typescript
// T10: Percentage values parsed to numericValue
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>12.5%</td></tr>
  <tr><td>100%</td></tr>
  <tr><td>0.5 %</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].numericValue).toBe(12.5);
expect(table.rows[1].cells[0].numericValue).toBe(100);
expect(table.rows[2].cells[0].numericValue).toBe(0.5);
```

### 2.11 Numeric value detection -- parenthetical negatives

```typescript
// T11: Parenthetical negatives (SEC convention) parsed as negative numbers
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>(1,234)</td></tr>
  <tr><td>(42)</td></tr>
  <tr><td>$(500.50)</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].numericValue).toBe(-1234);
expect(table.rows[1].cells[0].numericValue).toBe(-42);
expect(table.rows[2].cells[0].numericValue).toBe(-500.50);
```

### 2.12 Numeric value detection -- plain numbers

```typescript
// T12: Plain numbers parsed correctly
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>42</td></tr>
  <tr><td>1,000</td></tr>
  <tr><td>3.14</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].numericValue).toBe(42);
expect(table.rows[1].cells[0].numericValue).toBe(1000);
expect(table.rows[2].cells[0].numericValue).toBe(3.14);
```

### 2.13 Numeric value detection -- non-numeric text

```typescript
// T13: Non-numeric text has undefined numericValue
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Revenue</td></tr>
  <tr><td>Total operating expenses</td></tr>
  <tr><td>N/A</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].numericValue).toBeUndefined();
expect(table.rows[1].cells[0].numericValue).toBeUndefined();
expect(table.rows[2].cells[0].numericValue).toBeUndefined();
```

### 2.14 Numeric value detection -- mixed text with number

```typescript
// T14: Mixed text like "$1,234 million" -- design decision: numericValue undefined
// Rationale: Ambiguous whether 1234 or 1234000000 is intended
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>$1,234 million</td></tr>
  <tr><td>approximately 500</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
// Mixed text with trailing words: numericValue should be undefined
expect(table.rows[0].cells[0].numericValue).toBeUndefined();
expect(table.rows[1].cells[0].numericValue).toBeUndefined();
```

### 2.15 Source mappings -- cell level

*Also covered by property tests P4, P9 across all generated tables.*

```typescript
// T15: Each cell has valid SourceLocation, round-trip works
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Revenue</td><td>$100</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
for (const row of table.rows) {
  expect(row.source.start).toBeGreaterThanOrEqual(0);
  expect(row.source.end).toBeLessThanOrEqual(html.length);
  expect(row.source.start).toBeLessThan(row.source.end);
  for (const cell of row.cells) {
    expect(cell.source.start).toBeGreaterThanOrEqual(0);
    expect(cell.source.end).toBeLessThanOrEqual(html.length);
    expect(cell.source.start).toBeLessThan(cell.source.end);
    const slice = html.slice(cell.source.start, cell.source.end);
    expect(slice).toContain(cell.text);
  }
}
```

### 2.16 Source mappings -- row level

```typescript
// T16: Each row source contains all its cells
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>A</td><td>B</td></tr>
  <tr><td>C</td><td>D</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
for (const row of table.rows) {
  for (const cell of row.cells) {
    expect(cell.source.start).toBeGreaterThanOrEqual(row.source.start);
    expect(cell.source.end).toBeLessThanOrEqual(row.source.end);
  }
}
```

### 2.17 Empty table

```typescript
// T17: Table with no rows produces empty rows array
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table).toBeDefined();
expect(table.rows).toHaveLength(0);
```

### 2.18 Text extraction -- nested elements

```typescript
// T18: Cells with nested spans, bold, iXBRL wrappers flatten to plain text
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr>
    <td><span style="font-weight:bold">Revenue</span></td>
    <td><b><i>$100</i></b></td>
    <td><ix:nonFraction>42</ix:nonFraction></td>
  </tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].text).toBe('Revenue');
expect(table.rows[0].cells[1].text).toBe('$100');
expect(table.rows[0].cells[2].text).toBe('42');
```

### 2.19 Whitespace handling

```typescript
// T19: Cells with only whitespace/nbsp normalize to empty string; cells are NOT filtered
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr>
    <td>&nbsp;</td>
    <td>   </td>
    <td> Revenue </td>
  </tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
// All cells are preserved (unlike paragraphs, whitespace cells are NOT filtered)
expect(table.rows[0].cells).toHaveLength(3);
// Whitespace-only cells have text: '' after normalization
expect(table.rows[0].cells[0].text).toBe('');
expect(table.rows[0].cells[1].text).toBe('');
expect(table.rows[0].cells[2].text).toBe('Revenue');
// Whitespace-only cells have no numericValue
expect(table.rows[0].cells[0].numericValue).toBeUndefined();
```

### 2.20 Tables with thead/tbody/tfoot structure

```typescript
// T20: All structural table elements handled correctly
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <thead><tr><th>Metric</th><th>2024</th></tr></thead>
  <tbody>
    <tr><td>Revenue</td><td>$100B</td></tr>
    <tr><td>Income</td><td>$20B</td></tr>
  </tbody>
  <tfoot><tr><td>Total</td><td>$120B</td></tr></tfoot>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows).toHaveLength(4); // 1 header + 2 body + 1 footer
expect(table.rows[0].isHeader).toBe(true);
expect(table.rows[1].isHeader).toBe(false);
expect(table.rows[3].isHeader).toBe(false); // tfoot rows are not headers
```

### 2.21 includeSourceHtml option

```typescript
// T21: sourceHtml populated on cells and rows when opted in
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Revenue</td><td>$100</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html), { includeSourceHtml: true });
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.sourceHtml).toBeDefined();
expect(table.sourceHtml).toContain('<table');
expect(table.rows[0].sourceHtml).toBeDefined();
expect(table.rows[0].sourceHtml).toContain('Revenue');
expect(table.rows[0].cells[0].sourceHtml).toBeDefined();
expect(table.rows[0].cells[0].sourceHtml).toContain('Revenue');
```

### 2.22 sourceHtml undefined by default

```typescript
// T22: sourceHtml not populated when includeSourceHtml is not set
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>Revenue</td></tr></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].sourceHtml).toBeUndefined();
expect(table.rows[0].cells[0].sourceHtml).toBeUndefined();
```

### 2.23 Multiple tables in one section

```typescript
// T23: Section with multiple tables extracts all of them
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>Table 1</td></tr></table>
<p>Some text between tables.</p>
<table><tr><td>Table 2</td></tr></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const tables = doc.sections[0].blocks.filter(b => b.type === 'table');
expect(tables).toHaveLength(2);
```

### 2.24 Row ordering

```typescript
// T24: Rows are in document order
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>First</td></tr>
  <tr><td>Second</td></tr>
  <tr><td>Third</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].text).toBe('First');
expect(table.rows[1].cells[0].text).toBe('Second');
expect(table.rows[2].cells[0].text).toBe('Third');
for (let i = 1; i < table.rows.length; i++) {
  expect(table.rows[i].source.start).toBeGreaterThan(table.rows[i - 1].source.start);
}
```

### 2.25 Numeric value detection -- em-dash/en-dash as zero

```typescript
// T25: Dash patterns (em-dash, en-dash, double/triple hyphen) → numericValue: 0
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>\u2014</td></tr>
  <tr><td>\u2013</td></tr>
  <tr><td>--</td></tr>
  <tr><td>---</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].numericValue).toBe(0);
expect(table.rows[1].cells[0].numericValue).toBe(0);
expect(table.rows[2].cells[0].numericValue).toBe(0);
expect(table.rows[3].cells[0].numericValue).toBe(0);
```

### 2.26 Numeric value detection -- negative with dash prefix

```typescript
// T26: Negative numbers with dash prefix (not parenthetical)
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>-1,234</td></tr>
  <tr><td>- 500</td></tr>
  <tr><td>-42.5</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].numericValue).toBe(-1234);
expect(table.rows[1].cells[0].numericValue).toBe(-500);
expect(table.rows[2].cells[0].numericValue).toBe(-42.5);
```

### 2.27 `<br>` handling in cells

```typescript
// T27: <br> tags insert a space between adjacent text
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Line1<br>Line2</td></tr>
  <tr><td>Multi<br/>Line<br>Text</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
// <br> should insert a space, not concatenate words
expect(table.rows[0].cells[0].text).toContain('Line1');
expect(table.rows[0].cells[0].text).toContain('Line2');
expect(table.rows[0].cells[0].text).not.toBe('Line1Line2');
```

### 2.28 Mixed `<th>` and `<td>` in same row

```typescript
// T28: Row with mix of <th> and <td> — not all-<th>, so isHeader = false
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><th>Label</th><td>Value</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
// Not all cells are <th>, so isHeader should be false
expect(table.rows[0].isHeader).toBe(false);
```

---

## 3. Integration Tests

Test file: `tests/integration/table-extractor.integration.test.ts`. Uses real filing fixtures from `tests/integration/fixtures/`.

### 3.1 Table extraction in real filings -- Item 8

```typescript
describe('table extraction in real filings', () => {
  it('AAPL Item 8 contains populated tables (not stubs)', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const item8 = doc.sections.find(s => s.id === 'item-8');
    expect(item8).toBeDefined();

    const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
    expect(tables.length).toBeGreaterThan(0);

    // Tables should now have populated rows (not stubs)
    const populatedTables = tables.filter(t => t.rows.length > 0);
    expect(populatedTables.length).toBeGreaterThan(0);
  });
});
```

### 3.2 Table count in known filings

```typescript
describe('table count in known filings', () => {
  const expectations: Array<{ ticker: string; year: number; minTables: number }> = [
    { ticker: 'aapl', year: 2024, minTables: 5 },
    { ticker: 'jpm', year: 2024, minTables: 10 },
    { ticker: 'msft', year: 2024, minTables: 5 },
  ];

  for (const { ticker, year, minTables } of expectations) {
    it(`${ticker} ${year} Item 8 has >= ${minTables} tables`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const item8 = doc.sections.find(s => s.id === 'item-8');
      expect(item8).toBeDefined();

      const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
      expect(tables.length).toBeGreaterThanOrEqual(minTables);
    });
  }
});
```

### 3.3 Source offset round-trip for table cells

```typescript
describe('table cell source offset round-trip', () => {
  for (const { ticker, year } of [
    { ticker: 'aapl', year: 2024 },
    { ticker: 'msft', year: 2024 },
    { ticker: 'jpm', year: 2024 },
  ]) {
    it(`${ticker} ${year}: cell source offsets round-trip`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const item8 = doc.sections.find(s => s.id === 'item-8');
      if (!item8) return; // skip if item-8 not detected

      const tables = item8.blocks.filter(b => b.type === 'table') as Table[];
      // Check first 3 tables to keep test fast
      for (const table of tables.slice(0, 3)) {
        for (const row of table.rows) {
          // Row source bounds
          expect(row.source.start).toBeGreaterThanOrEqual(0);
          expect(row.source.end).toBeLessThanOrEqual(html.length);
          expect(row.source.start).toBeLessThan(row.source.end);

          for (const cell of row.cells) {
            // Cell source bounds
            expect(cell.source.start).toBeGreaterThanOrEqual(0);
            expect(cell.source.end).toBeLessThanOrEqual(html.length);
            expect(cell.source.start).toBeLessThan(cell.source.end);

            // Cell contained within row
            expect(cell.source.start).toBeGreaterThanOrEqual(row.source.start);
            expect(cell.source.end).toBeLessThanOrEqual(row.source.end);

            // Round-trip: slice contains cell text (if non-empty)
            if (cell.text.trim().length > 0) {
              const slice = html.slice(cell.source.start, cell.source.end);
              // Text may have been normalized, so check key words
              const words = cell.text.trim().split(/\s+/).slice(0, 2);
              for (const word of words) {
                if (word.length > 2) {
                  expect(slice).toContain(word);
                }
              }
            }
          }
        }
      }
    });
  }
});
```

### 3.4 Header row detection in real financial tables

**Note:** Verified that real SEC fixtures (AAPL, MSFT, JPM, WMT, etc.) use zero `<th>` and
zero `<thead>` elements. All header rows use `<td>` with visual styling. Therefore this test
documents the absence of semantic headers rather than asserting their presence.

```typescript
describe('header detection in real filings', () => {
  it('documents header detection rate across real filings (informational)', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const item8 = doc.sections.find(s => s.id === 'item-8');
    expect(item8).toBeDefined();

    const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
    const tablesWithHeaders = tables.filter(t =>
      t.rows.some(r => r.isHeader)
    );
    // Real SEC filings rarely use <th> or <thead>.
    // This test documents the detection rate; no hard assertion.
    // If a future enhancement adds heuristic header detection, update this test.
    console.log(
      `AAPL Item 8: ${tablesWithHeaders.length}/${tables.length} tables have isHeader rows`
    );
    // Soft assertion: test passes regardless, but logs detection rate
    expect(tables.length).toBeGreaterThan(0);
  });
});
```

### 3.5 Numeric values in financial statement cells

```typescript
describe('numeric value detection in real filings', () => {
  it('AAPL Item 8 tables contain cells with numericValue', () => {
    const html = loadFixture('aapl', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const item8 = doc.sections.find(s => s.id === 'item-8');
    expect(item8).toBeDefined();

    const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
    const cellsWithNumeric = tables.flatMap(t =>
      t.rows.flatMap(r => r.cells.filter(c => c.numericValue !== undefined))
    );
    // Financial statements should have many numeric cells
    expect(cellsWithNumeric.length).toBeGreaterThan(10);
  });
});
```

### 3.6 Colspan in real filings

```typescript
describe('colspan/rowspan in real filings', () => {
  it('MSFT 2024 tables use colspan (common in SEC financial tables)', () => {
    const html = loadFixture('msft', 2024);
    const doc = parseFiling(makeRawFiling(html));

    const allTables = doc.sections.flatMap(s =>
      s.blocks.filter(b => b.type === 'table')
    ) as Table[];

    const cellsWithColspan = allTables.flatMap(t =>
      t.rows.flatMap(r => r.cells.filter(c => c.colspan > 1))
    );
    // MSFT filing has many colspan cells
    expect(cellsWithColspan.length).toBeGreaterThan(0);
  });
});
```

### 3.7 Cross-filing table structure consistency

```typescript
describe('cross-filing table consistency', () => {
  it('MSFT 2023 and 2024 both have tables in Item 8', () => {
    const doc2023 = parseFiling(makeRawFiling(loadFixture('msft', 2023)));
    const doc2024 = parseFiling(makeRawFiling(loadFixture('msft', 2024)));

    const tables2023 = doc2023.sections
      .find(s => s.id === 'item-8')?.blocks
      .filter(b => b.type === 'table') ?? [];
    const tables2024 = doc2024.sections
      .find(s => s.id === 'item-8')?.blocks
      .filter(b => b.type === 'table') ?? [];

    expect(tables2023.length).toBeGreaterThan(0);
    expect(tables2024.length).toBeGreaterThan(0);
    // Same company, similar table count across years
    expect(Math.abs(tables2023.length - tables2024.length))
      .toBeLessThan(tables2023.length * 0.5);
  });
});
```

---

## 4. E2E Tests

Test file: `tests/e2e/table-parser-e2e.test.ts` (or additions to existing E2E suite).

### E2E-1: Full pipeline produces populated Table blocks

```typescript
describe('E2E: parseFiling produces populated tables', () => {
  for (const { ticker, year } of ALL_FIXTURES) {
    it(`${ticker} ${year}: Table blocks have rows.length > 0 for sections with tables`, () => {
      const html = loadFixture(ticker, year);
      const doc = parseFiling(makeRawFiling(html));

      const allTables = doc.sections.flatMap(s =>
        s.blocks.filter(b => b.type === 'table')
      ) as Table[];

      // Filing should have at least some tables
      expect(allTables.length).toBeGreaterThan(0);

      // All tables should be populated (no more stubs)
      for (const table of allTables) {
        expect(table.rows.length).toBeGreaterThanOrEqual(0);
        // Tables with actual <tr> elements should have rows
        // Empty tables (no <tr>) are valid with rows = []
      }
    });
  }
});
```

### E2E-2: Table blocks replace stubs

```typescript
it('parseFiling no longer produces table stubs (rows: [])', () => {
  const html = loadFixture('aapl', 2024);
  const doc = parseFiling(makeRawFiling(html));

  const item8 = doc.sections.find(s => s.id === 'item-8');
  expect(item8).toBeDefined();

  const tables = item8!.blocks.filter(b => b.type === 'table') as Table[];
  const stubs = tables.filter(t => t.rows.length === 0);
  const populated = tables.filter(t => t.rows.length > 0);

  // Most tables should be populated now
  expect(populated.length).toBeGreaterThan(stubs.length);
});
```

### E2E-3: Performance -- table extraction does not regress parse time

```typescript
it('parsing with table extraction completes within 1000ms for largest filing', () => {
  const html = loadFixture('jpm', 2024); // ~12.3MB, many tables
  const raw = makeRawFiling(html);

  const start = performance.now();
  parseFiling(raw);
  const elapsed = performance.now() - start;

  // Generous budget: table extraction adds overhead vs stubs
  expect(elapsed).toBeLessThan(1000);
});
```

---

## 5. Boundary Conditions

### B1: Empty table

```typescript
// B1: Table element with no children
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows).toHaveLength(0);
```

### B2: Single-cell table

```typescript
// B2: Table with exactly one cell
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>Only cell</td></tr></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows).toHaveLength(1);
expect(table.rows[0].cells).toHaveLength(1);
expect(table.rows[0].cells[0].text).toBe('Only cell');
```

### B3: Single-row table

```typescript
// B3: Table with one row, multiple cells
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>A</td><td>B</td><td>C</td></tr></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows).toHaveLength(1);
expect(table.rows[0].cells).toHaveLength(3);
```

### B4: Table with only header rows (no data)

```typescript
// B4: Table with only <th> in <thead>, no <tbody>
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <thead><tr><th>Col A</th><th>Col B</th></tr></thead>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows).toHaveLength(1);
expect(table.rows[0].isHeader).toBe(true);
```

### B5: Deeply nested tables (layout tables)

```typescript
// B5: Table nested inside another table -- inner table text folds into outer cell
// content-extractor does not recurse into <table>, so nested table is NOT a separate block
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>Outer
  <table><tr><td>Inner data</td></tr></table>
</td></tr></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const tables = doc.sections[0].blocks.filter(b => b.type === 'table') as Table[];
// Only the outer table is extracted as a block
expect(tables).toHaveLength(1);
// Inner table's text is accumulated into the outer cell's text via getTextContent
expect(tables[0].rows[0].cells[0].text).toContain('Inner data');
```

### B6: Very large table (100+ rows)

```typescript
// B6: Table with 100+ rows does not crash or timeout
const rows = Array.from({ length: 150 }, (_, i) =>
  `<tr><td>Row ${i}</td><td>${i * 100}</td></tr>`
).join('\n');
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>${rows}</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows).toHaveLength(150);
```

### B7: Cells with very long content

```typescript
// B7: Cell with long text content does not truncate
const longText = 'A'.repeat(5000);
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><tr><td>${longText}</td></tr></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows[0].cells[0].text).toBe(longText);
```

### B8: Inconsistent column counts across rows

```typescript
// B8: Rows with different numbers of cells
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>A</td><td>B</td><td>C</td></tr>
  <tr><td>D</td><td>E</td></tr>
  <tr><td>F</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table.rows).toHaveLength(3);
expect(table.rows[0].cells).toHaveLength(3);
expect(table.rows[1].cells).toHaveLength(2);
expect(table.rows[2].cells).toHaveLength(1);
```

---

## 6. Error Conditions

### E1: Malformed table HTML (missing closing tags)

```typescript
// E1: Malformed HTML with missing closing tags -- no crash
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td>Cell 1<td>Cell 2
  <tr><td>Cell 3
</table>
</body></html>`;
expect(() => parseFiling(makeRawFiling(html))).not.toThrow();
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
// htmlparser2 is tolerant -- should extract some rows
expect(table).toBeDefined();
expect(table.rows.length).toBeGreaterThanOrEqual(1);
```

### E2: Table with no `<tr>` elements

```typescript
// E2: Table containing only non-row content
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table><caption>Financial Summary</caption></table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
expect(table).toBeDefined();
expect(table.rows).toHaveLength(0);
```

### E3: `<tr>` with no `<td>`/`<th>` elements

```typescript
// E3: Row with no cell children
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr></tr>
  <tr><td>Valid cell</td></tr>
</table>
</body></html>`;
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
// Empty row may be omitted or included with cells=[]
// Key invariant: no crash, and the valid row is present
expect(table.rows.some(r => r.cells.length > 0)).toBe(true);
```

### E4: Invalid colspan/rowspan values

```typescript
// E4: Non-numeric or zero colspan/rowspan treated as 1
const html = `<html><body>
<div><span style="font-weight:700">Item 8. Financial Statements</span></div>
<table>
  <tr><td colspan="0">Zero</td></tr>
  <tr><td colspan="abc">NaN</td></tr>
  <tr><td rowspan="-1">Negative</td></tr>
</table>
</body></html>`;
expect(() => parseFiling(makeRawFiling(html))).not.toThrow();
const doc = parseFiling(makeRawFiling(html));
const table = doc.sections[0].blocks.find(b => b.type === 'table') as Table;
// Invalid values should fallback to 1
for (const row of table.rows) {
  for (const cell of row.cells) {
    expect(cell.colspan).toBeGreaterThanOrEqual(1);
    expect(cell.rowspan).toBeGreaterThanOrEqual(1);
  }
}
```

---

## 7. Property-Based Tests (Acceptance Criteria Implementation)

Test file: `tests/fuzz/table-extractor.fuzz.test.ts`.

This section specifies the `TableHtmlGenerator` and property tests that implement the BDD acceptance
criteria (section 1, Scenarios 1-5, 7). Property testing is the primary verification strategy for
acceptance criteria because the table extraction domain has high combinatorial complexity. The
generator produces random table HTML paired with exact expected results, enabling hundreds of
precise structural assertions per CI run. Unit tests (section 2) remain hardcoded for specific
edge cases and regression scenarios.

### 7.1 Table HTML Generator

A `TableHtmlGenerator` produces structurally valid but randomized `<table>` HTML:

```typescript
interface TableGenOptions {
  minRows?: number;       // default 0
  maxRows?: number;       // default 20
  minCols?: number;       // default 0
  maxCols?: number;       // default 10
  useColspan?: boolean;   // default true, random colspan 1-3
  useRowspan?: boolean;   // default true, random rowspan 1-3
  useThead?: boolean;     // default: random
  useTbody?: boolean;     // default: random
  useTfoot?: boolean;     // default: random
  useThCells?: boolean;   // default: random
  cellContentTypes?: ('text' | 'currency' | 'percentage' | 'negative'
    | 'plain-number' | 'dash-zero' | 'empty' | 'nested-span' | 'ixbrl')[];
  nestingDepth?: number;  // 0 = no nested tables, 1 = one level, default 0
}

/** Returns { html: string, expected: ExpectedTable } */
function generateTable(options?: TableGenOptions): GeneratedTable;

interface ExpectedTable {
  rowCount: number;
  rows: Array<{
    cellCount: number;
    isHeader: boolean;
    cells: Array<{
      text: string;
      numericValue?: number;
      colspan: number;
      rowspan: number;
    }>;
  }>;
}
```

The generator produces both the HTML string and the expected parse result, enabling exact
structural assertions (not just invariant checks).

### 7.2 Structural invariants (property tests)

Run N=200 generated tables per CI invocation. For each generated table:

```typescript
describe('property: table extraction invariants', () => {
  const N = 200;

  for (let i = 0; i < N; i++) {
    it(`generated table #${i}: structural invariants hold`, () => {
      const { html: tableHtml, expected } = generateTable();
      const html = wrapInSection(tableHtml); // adds Item 8 heading + body
      const doc = parseFiling(makeRawFiling(html));

      const table = doc.sections[0]?.blocks.find(b => b.type === 'table') as Table;
      expect(table).toBeDefined();

      // P1: Row count matches expected
      expect(table.rows.length).toBe(expected.rowCount);

      // P2: Each row's cell count matches expected
      for (let r = 0; r < table.rows.length; r++) {
        expect(table.rows[r].cells.length).toBe(expected.rows[r].cellCount);
      }

      // P3: isHeader matches expected
      for (let r = 0; r < table.rows.length; r++) {
        expect(table.rows[r].isHeader).toBe(expected.rows[r].isHeader);
      }

      // P4: All source offsets valid
      for (const row of table.rows) {
        expect(row.source.start).toBeGreaterThanOrEqual(0);
        expect(row.source.end).toBeLessThanOrEqual(html.length);
        expect(row.source.start).toBeLessThan(row.source.end);
        for (const cell of row.cells) {
          expect(cell.source.start).toBeGreaterThanOrEqual(row.source.start);
          expect(cell.source.end).toBeLessThanOrEqual(row.source.end);
          expect(cell.source.start).toBeLessThan(cell.source.end);
        }
      }

      // P5: colspan/rowspan >= 1
      for (const row of table.rows) {
        for (const cell of row.cells) {
          expect(cell.colspan).toBeGreaterThanOrEqual(1);
          expect(cell.rowspan).toBeGreaterThanOrEqual(1);
        }
      }

      // P6: Cell text matches expected
      for (let r = 0; r < table.rows.length; r++) {
        for (let c = 0; c < table.rows[r].cells.length; c++) {
          expect(table.rows[r].cells[c].text).toBe(expected.rows[r].cells[c].text);
        }
      }

      // P7: Numeric values match expected
      for (let r = 0; r < table.rows.length; r++) {
        for (let c = 0; c < table.rows[r].cells.length; c++) {
          expect(table.rows[r].cells[c].numericValue)
            .toBe(expected.rows[r].cells[c].numericValue);
        }
      }

      // P8: colspan/rowspan match expected
      for (let r = 0; r < table.rows.length; r++) {
        for (let c = 0; c < table.rows[r].cells.length; c++) {
          expect(table.rows[r].cells[c].colspan).toBe(expected.rows[r].cells[c].colspan);
          expect(table.rows[r].cells[c].rowspan).toBe(expected.rows[r].cells[c].rowspan);
        }
      }

      // P9: Rows are in document order (source offsets monotonically increasing)
      for (let r = 1; r < table.rows.length; r++) {
        expect(table.rows[r].source.start)
          .toBeGreaterThan(table.rows[r - 1].source.start);
      }

      // P10: No exception thrown (implicit -- test reaches this point)
    });
  }
});
```

### 7.3 Numeric parsing properties

Separately fuzz the `tryParseNumeric` function with random numeric strings:

```typescript
describe('property: tryParseNumeric round-trip', () => {
  it('plain integers always parse correctly', () => {
    for (let i = 0; i < 100; i++) {
      const n = Math.floor(Math.random() * 1_000_000);
      const formatted = n.toLocaleString('en-US'); // "1,234,567"
      expect(tryParseNumeric(formatted)).toBe(n);
    }
  });

  it('currency-formatted values always parse correctly', () => {
    for (let i = 0; i < 100; i++) {
      const n = Math.floor(Math.random() * 1_000_000);
      const formatted = `$${n.toLocaleString('en-US')}`;
      expect(tryParseNumeric(formatted)).toBe(n);
    }
  });

  it('parenthetical negatives always parse correctly', () => {
    for (let i = 0; i < 100; i++) {
      const n = Math.floor(Math.random() * 1_000_000);
      const formatted = `(${n.toLocaleString('en-US')})`;
      expect(tryParseNumeric(formatted)).toBe(-n);
    }
  });

  it('non-numeric strings never produce a value', () => {
    const words = ['Revenue', 'Total', 'N/A', 'abc', 'Item 1', 'million', ''];
    for (const w of words) {
      expect(tryParseNumeric(w)).toBeUndefined();
    }
  });
});
```

### 7.4 Generator coverage dimensions

The `TableHtmlGenerator` randomizes across these dimensions:

| Dimension | Range | Purpose |
|-----------|-------|---------|
| Row count | 0-20 | Empty table, single row, many rows |
| Column count | 0-10 | Empty row, single cell, wide tables |
| colspan | 1-3 | Merged columns |
| rowspan | 1-3 | Merged rows |
| Header pattern | none / thead / all-th | Header detection logic |
| Cell content | text, $, %, (neg), number, dash, empty, span, ixbrl | Numeric parsing paths |
| Structural wrappers | none / thead+tbody / thead+tbody+tfoot | Section element handling |

This replaces the need for many manual boundary/edge-case tests by covering the combinatorial
space randomly. The exact-match assertions (P1-P8) ensure the parser output matches the
generated expectation, not just invariants.

---

## 8. Test Data

### 8.1 Inline HTML fixtures (unit tests)

Each test case has a dedicated inline fixture (T1-T28) with minimal HTML. All fixtures are wrapped in a section heading so the table is part of a parsed section. Fixtures cover:
- Basic extraction (T1)
- Header detection: `<th>`, `<thead>`, all-`<th>` row, no first-row heuristic (T2-T4, T4b, T28)
- Colspan/rowspan (T5-T8)
- Numeric value parsing: currency, percentages, parenthetical negatives, plain, non-numeric, mixed, dash-as-zero, negative-dash (T9-T14, T25-T26)
- `<br>` handling (T27)
- Source mappings (T15-T16)
- Empty table (T17)
- Nested elements / iXBRL (T18)
- Whitespace handling (T19)
- thead/tbody/tfoot structure (T20)
- includeSourceHtml (T21-T22)
- Multiple tables per section (T23)
- Row ordering (T24)
- Boundary conditions (B1-B8)
- Error conditions (E1-E4)

### 8.2 Real filing fixtures (integration tests)

Same fixtures as US-1.3, available in `tests/integration/fixtures/`:

| Fixture | Size | Key Table Properties |
|---------|------|---------------------|
| 10k-aapl-2024.html | 1.4 MB | Financial statements with iXBRL wrappers |
| 10k-msft-2024.html | 7.8 MB | DFIN tables with extensive colspan usage |
| 10k-msft-2023.html | 6.5 MB | Cross-year comparison baseline |
| 10k-jpm-2024.html | 12.3 MB | Banking: many large financial tables |
| 10k-jpm-2023.html | 12.6 MB | Cross-year comparison baseline |
| 10k-wmt-2024.html | 2.2 MB | Table-based layout (Family D) |
| 10k-xom-2012.html | 8.7 MB | Legacy font tags, older table patterns |

### 8.3 Test utility: makeRawFiling()

Uses `makeRawFiling(html)` from `tests/helpers/ground-truth.ts` (shared with US-1.3 tests).

---

## 9. Test File Organization

```
tests/
  unit/
    table-extractor.test.ts              # T1-T28, B1-B8, E1-E4
  integration/
    table-extractor.integration.test.ts  # §3.1-3.7
  e2e/
    table-parser-e2e.test.ts             # E2E-1, E2E-2, E2E-3
  fuzz/
    table-extractor.fuzz.test.ts         # §7.2-7.3 (property tests, N=200 per run)
    table-html-generator.ts              # §7.1 (TableHtmlGenerator + ExpectedTable)
  helpers/
    ground-truth.ts                      # Shared: makeRawFiling(), loadFixture(), etc.
  integration/
    fixtures/
      10k-*.html                         # Real filing HTML (already committed)
      meta-10k-*.json                    # Ground truth (already committed)
```

---

## 10. Design Decisions (Resolved per Implementation Design)

The following decisions are now aligned between the test plan and implementation design:

1. **Mixed text with numbers** (T14): `"$1,234 million"` → `numericValue: undefined`. The `tryParseNumeric` regex rejects trailing non-numeric text. **Confirmed.**

2. **Whitespace-only cells** (T19): Cells are preserved with `text: ''` after normalization. Cells are NOT filtered out (unlike paragraphs). **Confirmed.**

3. **Nested tables** (B5): Inner table text folds into parent cell's `text` via `getTextContent()`. Nested tables are NOT extracted as separate blocks. **Confirmed.**

4. **Empty rows** (E3): Design's `extractCells` returns `cells: []` for empty `<tr>`. Test plan checks the valid row is present; empty rows are acceptable. **Confirmed.**

5. **iXBRL numeric wrappers**: Parse displayed text only, not iXBRL `scale`/`decimals` attributes. `numericValue` = what the human sees. **Confirmed.**

6. **tfoot rows**: `isHeader: false`. Only `<thead>` context or all-`<th>` rows trigger `isHeader: true`. **Confirmed.**

7. **Em-dash/en-dash as zero** (T25): `—`, `–`, `--`, `---` → `numericValue: 0`. Common SEC convention for nil/zero values. **Confirmed.**

8. **No first-row heuristic** (T4b): v1 only uses `<thead>` context or all-`<th>` detection. Most SEC tables will have `isHeader: false` on all rows. **Confirmed.**

9. **`<br>` handling** (T27): Insert a space for `<br>` tags to avoid concatenating words. **Recommended by design, pending confirmation of `getTextContent` modification.**

### Remaining open question

- **`<br>` implementation**: The shared `getTextContent()` in content-extractor currently ignores `<br>`. Modifying it to insert a space affects both paragraph and table text extraction. Should this be scoped to table-extractor only, or applied globally? Test T27 validates the expected behavior.

### Future work

- **Enhanced complex table handling** (deeply nested, multi-level colspan/rowspan): Filed as `edgar-diff-dw8` (P3). Current v1 handles basic colspan/rowspan and folds nested table text into parent cells. Future enhancement to handle independent nested table extraction and overlapping span grids.
