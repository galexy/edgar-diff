---
title: "Test Plan: US-1.8 Structured Diff Output"
story: edgar-diff-2t0
created: "2026-03-10"
status: draft
---

# Test Plan: US-1.8 Structured Diff Output

## Overview

US-1.8 integrates all prior diff components (US-1.5 section alignment, US-1.6 paragraph diffs, US-1.7 table diffs) into the `diffFilings()` function to produce a fully-populated `StructuredDiff`. The key changes are:

1. **Replace `tableDiffs: []`** in `makeSectionDiff()` with actual table diff computation via `diffTables()`
2. **Extract tables** from `ContentBlock[]` within matched sections
3. **Ensure JSON serializability** of the entire output (especially `Temporal.Instant` and `Temporal.PlainDate`)
4. **Validate metadata completeness** (accession numbers, filing dates, form type, CIK)
5. **Ensure source mappings** are valid for overlay rendering

### Key Types Under Test

From `src/diff/types.ts`:

```typescript
interface SectionDiff {
  id: string;
  heading: string;
  changeType: ChangeType;
  oldSection?: FilingSection;
  newSection?: FilingSection;
  paragraphDiffs: ParagraphDiff[];
  tableDiffs: TableDiff[];        // <-- currently hardcoded to []
  subsectionDiffs: SectionDiff[];  // remains [] for US-1.8
  sourceMapping: DiffRange;
}

interface StructuredDiff {
  oldFiling: RawFiling;
  newFiling: RawFiling;
  sectionDiffs: SectionDiff[];
  summary: { added; removed; modified; unchanged; reordered };
  generatedAt: Temporal.Instant;
}
```

From `src/types.ts`:

```typescript
type ContentBlock = Paragraph | Table;

interface FilingSection extends SourceMapped {
  id: string; heading: string; level: number;
  blocks: ContentBlock[];
  subsections: FilingSection[];
}
```

From `src/diff/diff-engine.ts` (the file being modified):

```typescript
function makeSectionDiff(changeType, options): SectionDiff  // currently sets tableDiffs: []
function buildSummary(sectionDiffs): StructuredDiff['summary']
function diffFilings(oldDoc, newDoc, options?): StructuredDiff
```

### Open Questions Resolved

| Question | Decision | Rationale |
|----------|----------|-----------|
| JSON serialization of Temporal types | No custom replacer needed — `@js-temporal/polyfill` provides `toJSON()` natively | `JSON.stringify()` works out of the box; consumers use `Temporal.Instant.from(str)` to deserialize |
| Subsection diffs | Leave as `[]`, test that they're empty | Recursive subsection diffing is out of scope for US-1.8 |
| "moved" vs "reordered" | Sections get `'reordered'` from `classifySectionDiff()`; paragraphs get `'moved'` from `detectMoves()`; tables have neither | `buildSummary` maps section-level `'moved'` → `reordered` count, but sections never actually get `'moved'` |
| Table extraction from `ContentBlock[]` | Private `extractTables(blocks): Table[]` in `diff-engine.ts` | Type-guard filter `b.type === 'table'`; mirrors `extractParagraphs` in `paragraph-differ.ts` |
| Added/removed section tables | Added sections enumerate tables as `changeType: 'added'` stubs; removed sections as `'removed'` stubs | Lightweight `TableDiff` with `rowDiffs: []`, `cellDiffs: []` — no detailed diff since no counterpart |

---

## 1. BDD Acceptance Criteria

### AC-1: Table diffs are populated within section diffs

```
Given two StructuredDocuments with matched sections containing tables
When diffFilings() is called
Then each matched SectionDiff.tableDiffs contains TableDiff entries from diffTables()
  And added sections have one TableDiff per table with changeType 'added' (rowDiffs=[], cellDiffs=[])
  And removed sections have one TableDiff per table with changeType 'removed' (rowDiffs=[], cellDiffs=[])
  And sections with no tables have tableDiffs = []
```

### AC-2: Metadata is complete

```
Given a StructuredDiff result
When inspecting oldFiling and newFiling
Then both have non-empty accessionNumber matching /^\d{10}-\d{2}-\d{6}$/
  And both have non-empty cik
  And both have formType set (e.g., '10-K')
  And both have filingDate as Temporal.PlainDate
  And generatedAt is a valid Temporal.Instant
```

### AC-3: JSON serialization round-trip

```
Given a StructuredDiff result
When serialized via JSON.stringify() (Temporal polyfill provides toJSON() natively)
  And deserialized back via JSON.parse
Then the deserialized object retains all fields
  And sectionDiffs.length matches
  And summary is deeply equal
  And generatedAt is a parseable ISO 8601 string
  And filingDate values are parseable YYYY-MM-DD strings
  And paragraphDiffs and tableDiffs survive the round-trip
  And tableDiff cellDiffs retain oldValue/newValue/numericValues
```

### AC-4: Source mappings are valid

```
Given a StructuredDiff result over two HTML documents
When inspecting every sourceMapping at section, paragraph, table, and cell levels
Then sourceMapping.old (when present) has 0 <= start < end <= oldHtml.length
  And sourceMapping.new (when present) has 0 <= start < end <= newHtml.length
  And 'added' elements have only sourceMapping.new
  And 'removed' elements have only sourceMapping.old
  And 'modified'/'unchanged' elements have both
```

### AC-5: Change types are correctly classified

```
Given sections with varying content changes
When diffFilings() computes SectionDiffs
Then sections with identical content → changeType 'unchanged'
  And sections with different paragraph or table content → changeType 'modified'
  And sections only in new filing → changeType 'added'
  And sections only in old filing → changeType 'removed'
  And sections that swapped order but have identical content → changeType 'reordered' (or 'moved')
  And summary counts match actual SectionDiff changeType distribution
```

### AC-6: Table extraction from ContentBlock[]

```
Given a section with mixed blocks [paragraph, table, paragraph, table]
When tables are extracted for diff computation
Then exactly 2 tables are extracted in block order
  And paragraphs are separately handled by diffParagraphs
  And no block is counted in both paragraph and table diffs
```

---

## 2. Unit Tests

### 2.1 Table Extraction (tested indirectly through `diffFilings`)

`extractTables()` is a private function in `diff-engine.ts`. It is tested indirectly through `diffFilings()` behavior — specifically by verifying that sections with table blocks produce the correct `tableDiffs`. Direct unit tests are not needed since the function is a one-line type-guard filter (`blocks.filter(b => b.type === 'table')`).

The following scenarios validate table extraction behavior:
- U-DF-10: Mixed blocks → tables extracted and diffed
- U-DF-14: Added section with tables → tables enumerated as added
- U-DF-15: Removed section with tables → tables enumerated as removed
- B-1: No tables → tableDiffs = []
- B-2: Only tables → tableDiffs populated, paragraphDiffs = []

### 2.2 diffFilings Table Behavior (`tests/unit/diff/diff-engine.test.ts`)

`makeSectionDiff()` is a private function — all table integration behavior is tested through `diffFilings()`. These tests use `makeSection` from `diff-fixtures.ts` with `makeTable` to create sections containing table blocks.

```
describe('diffFilings — table behavior')
  it('U-MSD-1: matched sections with tables produce non-empty tableDiffs')
    - Old section blocks: [paragraph, table-old]
    - New section blocks: [paragraph, table-new]
    - Assert sectionDiff.tableDiffs.length >= 1

  it('U-MSD-2: matched sections with only paragraphs produce empty tableDiffs')
    - Old/new blocks: [paragraph] each
    - Assert sectionDiff.tableDiffs.length === 0

  it('U-MSD-3: matched sections with identical tables produce unchanged tableDiffs')
    - Old/new blocks: [same-table]
    - Assert sectionDiff.tableDiffs[0].changeType === 'unchanged'

  it('U-MSD-4: added section WITH tables has tableDiffs with changeType added')
    - New section has 2 table blocks, no old section
    - Assert sectionDiff.tableDiffs.length === 2
    - Assert each tableDiff.changeType === 'added'
    - Assert each tableDiff.newTable is set, oldTable is undefined
    - Assert each tableDiff.rowDiffs === [] and cellDiffs === []

  it('U-MSD-5: removed section WITH tables has tableDiffs with changeType removed')
    - Old section has 2 table blocks, no new section
    - Assert sectionDiff.tableDiffs.length === 2
    - Assert each tableDiff.changeType === 'removed'
    - Assert each tableDiff.oldTable is set, newTable is undefined
    - Assert each tableDiff.rowDiffs === [] and cellDiffs === []

  it('U-MSD-5a: added section WITHOUT tables has tableDiffs = []')
    - New section has only paragraphs
    - Assert sectionDiff.tableDiffs.length === 0

  it('U-MSD-5b: removed section WITHOUT tables has tableDiffs = []')
    - Old section has only paragraphs
    - Assert sectionDiff.tableDiffs.length === 0

  it('U-MSD-6: mixed content (paragraphs + tables) produces both paragraphDiffs and tableDiffs')
    - Old section: [para-old, table-old]
    - New section: [para-new, table-new]
    - Assert paragraphDiffs.length > 0 AND tableDiffs.length > 0

  it('U-MSD-7: matched section with table added (0 old, 1 new) has TableDiff changeType added')
    - Old section: [paragraph], New section: [paragraph, table]
    - Assert tableDiffs has one entry with changeType 'added'

  it('U-MSD-8: matched section with table removed (1 old, 0 new) has TableDiff changeType removed')
    - Old section: [paragraph, table], New section: [paragraph]
    - Assert tableDiffs has one entry with changeType 'removed'

  it('U-MSD-9: multiple tables in matched section are all diffed')
    - Old: [table-1, table-2], New: [table-1-modified, table-2]
    - Assert tableDiffs.length === 2

  it('U-MSD-10: mismatched table counts (3 old, 2 new) produces correct mix')
    - Old section: 3 tables, New section: 2 tables
    - Assert tableDiffs includes matched + removed entries
    - Assert total tableDiffs count accounts for all tables
```

### 2.3 buildSummary with Table Context (`tests/unit/diff/diff-engine.test.ts`)

Existing buildSummary tests (U-BS-1 through U-BS-5) remain. Add:

```
describe('buildSummary — table-aware')
  it('U-BS-6: moved changeType maps to reordered in summary')
    - SectionDiff with changeType 'moved'
    - Assert summary.reordered incremented (existing behavior confirmed)

  it('U-BS-7: summary counts only section-level changes, not table-level')
    - SectionDiff with tableDiffs containing modified tables
    - Assert summary only reflects section changeType, not table counts
```

### 2.4 diffFilings End-to-End Shape (`tests/unit/diff/diff-engine.test.ts`)

Extend existing diffFilings tests (U-DF-1 through U-DF-9):

```
describe('diffFilings — table integration')
  it('U-DF-10: matched sections with tables have populated tableDiffs')
    - Build docs with sections containing mixed paragraph + table blocks
    - Assert matched sectionDiff.tableDiffs.length > 0

  it('U-DF-11: sections with identical tables have tableDiffs with changeType unchanged')
    - Same table in both old and new
    - Assert tableDiffs[0].changeType === 'unchanged'

  it('U-DF-12: sections with modified tables have tableDiffs with changeType modified')
    - Different cell values between old and new tables
    - Assert tableDiffs[0].changeType === 'modified'
    - Assert tableDiffs[0].cellDiffs.length > 0

  it('U-DF-13: sectionDiff.subsectionDiffs remains [] (out of scope)')
    - Any diffFilings result
    - Assert all sectionDiff.subsectionDiffs === []

  it('U-DF-14: added section with tables has table stubs with changeType added')
    - New doc has a section not in old doc, section has tables
    - Assert sectionDiff.changeType === 'added'
    - Assert sectionDiff.tableDiffs.length === number of tables in section
    - Assert each tableDiff.changeType === 'added'
    - Assert each tableDiff.sourceMapping has only .new

  it('U-DF-15: removed section with tables has table stubs with changeType removed')
    - Old doc has a section not in new doc, section has tables
    - Assert sectionDiff.changeType === 'removed'
    - Assert sectionDiff.tableDiffs.length === number of tables in section
    - Assert each tableDiff.changeType === 'removed'
    - Assert each tableDiff.sourceMapping has only .old

  it('U-DF-16: added/removed table stubs have correct sourceMapping')
    - Added table stub: sourceMapping.new = table.source, sourceMapping.old undefined
    - Removed table stub: sourceMapping.old = table.source, sourceMapping.new undefined
```

### 2.5 JSON Serialization (`tests/unit/diff/diff-engine.test.ts`)

The `@js-temporal/polyfill` provides `toJSON()` on both `Temporal.Instant` and `Temporal.PlainDate`, so `JSON.stringify()` works without a custom replacer.

```
describe('JSON serialization')
  it('U-JSON-1: Temporal.Instant serializes to ISO 8601 string via native toJSON()')
    - JSON.stringify(result) — no custom replacer needed
    - Assert generatedAt is a string matching ISO 8601 pattern (e.g., "2026-03-10T...")

  it('U-JSON-2: Temporal.PlainDate serializes to YYYY-MM-DD string via native toJSON()')
    - Assert oldFiling.filingDate is a string like "2024-01-01" after serialization

  it('U-JSON-3: full StructuredDiff round-trips through JSON without data loss')
    - JSON.stringify(result) → JSON.parse → compare sectionDiffs.length, summary, tableDiffs count
    - No custom replacer needed

  it('U-JSON-4: tableDiffs within sectionDiffs survive JSON round-trip')
    - After round-trip, tableDiff cellDiffs retain oldValue/newValue/numericValues
    - tableDiff.summary fields are preserved

  it('U-JSON-5: paragraphDiffs with wordChanges survive JSON round-trip')
    - After round-trip, wordChanges arrays are intact with type and value fields
```

---

## 3. Integration Tests

### 3.1 Section Alignment → Paragraph + Table Diffs Flow (`tests/integration/diff-pipeline.integration.test.ts`)

```
describe('diff pipeline integration')
  it('I-DP-1: sections with paragraphs and tables produce both diff types')
    - Build two StructuredDocuments with:
      - Matched section: paragraphs + tables with changes
    - diffFilings()
    - Assert sectionDiff has non-empty paragraphDiffs AND non-empty tableDiffs

  it('I-DP-2: table source mappings point to valid ranges in HTML')
    - For each tableDiff in result:
      - sourceMapping.old (if present): start < end, within oldHtml.length
      - sourceMapping.new (if present): start < end, within newHtml.length

  it('I-DP-3: cell-level source mappings are valid')
    - For each cellDiff in each tableDiff:
      - sourceMapping positions are within bounds

  it('I-DP-4: paragraph-level source mappings are valid')
    - For each paragraphDiff:
      - sourceMapping positions are within bounds

  it('I-DP-5: metadata references are preserved through pipeline')
    - result.oldFiling === oldDoc.filing (reference equality)
    - result.newFiling === newDoc.filing
    - accessionNumber, cik, formType, filingDate all accessible
```

### 3.2 Full diffFilings() with Realistic Data (`tests/integration/diff-pipeline.integration.test.ts`)

```
  it('I-DP-6: diffFilings with multi-section documents containing tables')
    - Old doc: 3 sections (1 with table, 1 paragraph-only, 1 with 2 tables)
    - New doc: 3 matching sections with content changes
    - Assert all sections matched
    - Assert table-containing sections have tableDiffs
    - Assert paragraph-only section has empty tableDiffs

  it('I-DP-7: diffFilings with added and removed sections containing tables')
    - Old doc: [section-A with 2 tables, section-B with 1 table]
    - New doc: [section-B with 1 table, section-C with 1 table]
    - section-A removed → tableDiffs has 2 entries, each changeType 'removed'
    - section-C added → tableDiffs has 1 entry with changeType 'added'
    - section-B matched → tableDiffs computed via diffTables()

  it('I-DP-8: added/removed table stubs have lightweight structure')
    - For added table stubs: rowDiffs=[], cellDiffs=[], summary all zeros
    - For removed table stubs: rowDiffs=[], cellDiffs=[], summary all zeros
    - sourceMapping points to the table's source location
```

---

## 4. End-to-End Tests

### 4.1 Full Pipeline (`tests/e2e/diff/diff-pipeline.e2e.test.ts`)

Extend existing E2E tests with table-specific assertions:

```
describe('E2E: structured diff with tables')
  it('E2E-T1: full pipeline produces tableDiffs in modified sections')
    - Load apple-fy2023.htm and apple-fy2024.htm
    - parseFiling() → diffFilings()
    - Find sections with changeType 'modified'
    - At least one modified section should have non-empty tableDiffs
    - (Apple 10-K Item 8 Financial Statements typically has many tables)

  it('E2E-T2: tableDiff summary counts are consistent')
    - For each sectionDiff with tableDiffs:
      For each tableDiff:
        rowsAdded + rowsRemoved + rowsModified + rowsUnchanged = total rows
        cellDiffs.length === summary.cellsChanged

  it('E2E-T3: tableDiff cellDiffs flat list matches rowDiffs contents')
    - For each tableDiff:
      tableDiff.cellDiffs deep-equals flatMap(rowDiff => rowDiff.cellDiffs)

  it('E2E-T4: all source mappings (section, paragraph, table, cell) are valid')
    - Section-level: within HTML bounds, direction matches changeType
    - Paragraph-level: within HTML bounds
    - Table-level: within HTML bounds
    - Cell-level: within HTML bounds

  it('E2E-T5: JSON serialization round-trip with tables')
    - JSON.stringify(result) → JSON.parse (no custom replacer needed)
    - tableDiffs survive with correct structure
    - cellDiff oldValue/newValue/numericValue preserved
    - generatedAt and filingDate are ISO strings

  it('E2E-T6: self-diff produces no table changes')
    - diffFilings(doc, doc)
    - All sectionDiffs have changeType 'unchanged'
    - All tableDiffs (if any) have changeType 'unchanged'
    - All tableDiff summary.cellsChanged === 0

  it('E2E-T7: deterministic output including tableDiffs')
    - Run diffFilings twice with same input
    - tableDiffs count matches
    - tableDiff changeTypes match
    - cellDiffs count matches
```

---

## 5. Boundary Conditions

```
describe('boundary conditions — structured diff')
  it('B-1: section with 0 tables → tableDiffs = []')
    - Matched section with only paragraphs
    - Assert tableDiffs === []

  it('B-2: section with 0 paragraphs but tables → paragraphDiffs = [], tableDiffs populated')
    - Matched section with only table blocks
    - Assert paragraphDiffs === [] AND tableDiffs.length > 0

  it('B-3: section with many tables (10+) → all are diffed')
    - Both sections have 10 tables each
    - Assert tableDiffs.length === 10

  it('B-4: section with single-cell table → tableDiffs produced')
    - Table with 1 row, 1 cell
    - Assert tableDiff exists and is valid

  it('B-5: empty sections (no blocks) → empty diffs')
    - Matched sections with blocks = []
    - Assert paragraphDiffs === [] AND tableDiffs === []

  it('B-6: both documents empty (no sections) → empty result')
    - diffFilings with 0 sections each
    - Assert sectionDiffs === [] AND summary all zeros

  it('B-7: one document empty, other has sections with tables')
    - Old doc: 2 sections with tables, New doc: 0 sections
    - All sections removed, each section's tableDiffs has entries with changeType 'removed'

  it('B-8: very large section (many paragraphs + many tables) completes')
    - Section with 50 paragraphs and 20 tables
    - Assert completes without timeout or error
```

---

## 6. Error Conditions

```
describe('error conditions — structured diff')
  it('E-1: section with empty table (0 rows) produces valid tableDiff')
    - Table object with rows: []
    - Assert tableDiff has changeType 'unchanged' if both empty

  it('E-2: section with malformed table HTML (irregular rows) handled gracefully')
    - Table with rows of different cell counts (grid normalizer pads with null)
    - Assert no exception, tableDiff produced

  it('E-3: missing blocks array defaults gracefully')
    - If blocks is undefined or null in a section, no crash
    - (Defensive check — should not happen with valid parser output)

  it('E-4: StructuredDiff with no matched sections — added/removed get table stubs')
    - All sections added or removed, none matched
    - Added sections have table stubs (changeType 'added'), removed have 'removed'
    - No diffTables() call (no matched pairs to diff)

  it('E-5: diffFilings never throws for valid StructuredDocument inputs')
    - Fuzz with variety of section/block combinations
    - Assert no exceptions
```

---

## 7. Test Data: Fixtures and Helpers

### 7.1 Existing Helpers (No Changes Needed)

| Helper | File | Purpose |
|--------|------|---------|
| `makeTable(rows, source)` | `tests/helpers/diff-helpers.ts` | Create Table from string[][] |
| `makeTable(rows)`, `makeTableRow`, `makeTableCell`, `makeFinancialTable` | `tests/helpers/table-diff-helpers.ts` | Fine-grained table construction |
| `makeParagraph(text, start)` | `tests/helpers/diff-fixtures.ts` | Create Paragraph block |
| `makeSection(id, heading, blocks, start)` | `tests/helpers/diff-fixtures.ts` | Create FilingSection with blocks |
| `makeStructuredDoc(sections)` | `tests/helpers/diff-fixtures.ts` | Create StructuredDocument |
| `makeDocumentPair(old, new)` | `tests/helpers/diff-helpers.ts` | Create document pair for diffFilings |
| `makeRawFiling(html, overrides)` | `tests/helpers/ground-truth.ts` | Create RawFiling for e2e |

### 7.2 New Helpers Needed

**Extend `makeDocumentPair`** (or create companion) to support table blocks:

```typescript
// In tests/helpers/diff-helpers.ts — extend the section spec type:
interface SectionSpec {
  id: string;
  heading: string;
  content?: string;                    // existing: creates a paragraph
  tables?: string[][][];               // NEW: each string[][] is a table (rows × cells)
}

// Example usage:
makeDocumentPair(
  [{ id: 'item-8', heading: 'Item 8', content: 'Financials',
     tables: [[['Revenue', '$100'], ['Income', '$20']]] }],
  [{ id: 'item-8', heading: 'Item 8', content: 'Financials',
     tables: [[['Revenue', '$120'], ['Income', '$20']]] }],
);
```

**New helper: `makeSectionWithTables`** in `tests/helpers/diff-fixtures.ts`:

```typescript
/** Create a section with mixed paragraph and table blocks. */
function makeSectionWithTables(
  id: string,
  heading: string,
  paragraphs: Paragraph[],
  tables: Table[],
  start?: number,
): FilingSection
```

### 7.3 Fixture Strategy

| Test Level | Fixture Source |
|------------|---------------|
| Unit tests | Inline via `makeTable`, `makeParagraph`, `makeSection` helpers |
| Integration | Inline StructuredDocuments built from helpers |
| E2E | Real HTML fixtures: `apple-fy2023.htm`, `apple-fy2024.htm` from `spikes/diff-algorithm/fixtures/` |

### 7.4 Temporal Serialization

The `@js-temporal/polyfill` provides native `toJSON()` on both `Temporal.Instant` and `Temporal.PlainDate`. No custom replacer is needed for serialization tests — plain `JSON.stringify()` works. The existing E2E-2 test's custom replacer can be simplified.

For deserialization (if needed in future), consumers would use `Temporal.Instant.from(str)` and `Temporal.PlainDate.from(str)`.

---

## 8. Example Scripts (Real-World Validation)

Beyond automated test infrastructure, standalone example scripts prove the library works end-to-end on real SEC filings with human-inspectable output. These live in `examples/` at the monorepo root and use the library's public API only (`createEdgarClient`, `parseFiling`, `diffFilings`).

### 8.1 `examples/diff-filings.ts` — Primary demo script

A CLI script that fetches two real 10-K filings from EDGAR and produces a human-readable diff report.

```
Usage: npx tsx examples/diff-filings.ts <old-accession> <new-accession> [--json] [--section <id>]

Examples:
  # Apple FY2023 vs FY2024
  npx tsx examples/diff-filings.ts 0000320193-23-000106 0000320193-24-000123

  # Only Item 8 (Financial Statements)
  npx tsx examples/diff-filings.ts 0000320193-23-000106 0000320193-24-000123 --section item-8

  # Raw JSON output
  npx tsx examples/diff-filings.ts 0000320193-23-000106 0000320193-24-000123 --json
```

**Default (human-readable) output format:**

```
=== Structured Diff: Apple Inc (CIK 0000320193) ===
Old filing: 0000320193-23-000106 (2023-11-03, 10-K)
New filing: 0000320193-24-000123 (2024-11-01, 10-K)
Generated at: 2026-03-10T15:30:00Z

--- Summary ---
  Sections: 3 modified, 12 unchanged, 1 added, 0 removed, 0 reordered

--- Section: Item 1. Business (modified) ---
  Paragraphs: 2 modified, 15 unchanged, 1 added, 0 removed, 1 moved
  Tables: 1 modified, 0 unchanged, 0 added, 0 removed

  [Table 1] Revenue by Segment (modified)
    Rows: 0 added, 0 removed, 3 modified, 5 unchanged
    Cells changed: 6
    Sample changes:
      Row 2, Col 2: "$383,285" → "$391,035" (numeric: 383285 → 391035)
      Row 3, Col 2: "$52,023" → "$54,321"

  [Paragraph 5] (modified)
    - The Company's total net {-revenue was $383.3 billion-}{+revenue was $391.0 billion+} ...

--- Section: Item 8. Financial Statements (modified) ---
  Paragraphs: 0 modified, 3 unchanged
  Tables: 5 modified, 2 unchanged, 1 added

  [Table 1] Consolidated Statements of Operations (modified)
    Rows: 0 added, 0 removed, 8 modified, 12 unchanged
    Cells changed: 16
    ...
```

**`--json` output**: Raw `JSON.stringify(structuredDiff, null, 2)` — the full `StructuredDiff` object for programmatic inspection.

**`--section <id>` filter**: Only show diffs for the specified section (e.g., `item-8`, `item-1a`). Useful for focusing on financial tables or risk factors.

**Script behavior:**
1. Create EDGAR client via `createEdgarClient({ userAgent: '...' })`
2. Fetch both filings via `client.fetchFiling(accession)`
3. Parse both via `parseFiling(rawFiling)`
4. Diff via `diffFilings(oldDoc, newDoc)`
5. Format and print the result
6. Dispose client

### 8.2 Recommended Test Cases for Manual Validation

Run each of these with the diff-filings script and visually inspect the output:

| Case | Old Accession | New Accession | Company | What to Look For |
|------|--------------|---------------|---------|-----------------|
| **Simple year-over-year** | `0000320193-23-000106` | `0000320193-24-000123` | Apple | Table value changes in Item 8, paragraph wording changes in Item 1 |
| **Section reordering** | `0000789019-23-000095` | `0000789019-24-000069` | Microsoft | Check for reordered sections if any items moved |
| **Large financial tables** | `0000019617-24-000024` | (next year's filing) | JPMorgan | Complex multi-table Item 8 with many numeric changes |
| **Self-diff** | `0000320193-24-000123` | `0000320193-24-000123` | Apple | Everything should be 'unchanged' — zero diffs |
| **Different companies** | `0000320193-24-000123` | `0000789019-24-000069` | Apple vs MSFT | Mostly added/removed sections — validates extreme case |

### 8.3 `examples/diff-summary.ts` — Quick summary script

A lighter script that outputs only the summary statistics (no detailed diffs). Useful for quickly checking if the pipeline runs without errors on a given filing pair.

```
Usage: npx tsx examples/diff-summary.ts <old-accession> <new-accession>

Output:
  Apple Inc: 10-K (2023-11-03) vs 10-K (2024-11-01)
  Sections: 16 total (3 modified, 12 unchanged, 1 added)
  Tables diffed: 14 (8 modified, 4 unchanged, 2 added)
  Total cells changed: 247
  Time: 1.2s fetch + 0.3s diff = 1.5s total
```

### 8.4 Script Structure

```
examples/
├── diff-filings.ts    # Full diff with human-readable output
├── diff-summary.ts    # Quick summary statistics
└── README.md          # Accession numbers for recommended test cases
```

Scripts should:
- Use only the library's public API from `@edgar-diff/lib` (no internal imports)
- Handle errors gracefully (network failures, invalid accession numbers)
- Include timing information (fetch time vs diff time)
- Work with `npx tsx` (no build step required)
- Respect EDGAR rate limits via `createEdgarClient`

---

## Module Interface Summary

| Module | File | Entry Point | Changes for US-1.8 |
|--------|------|-------------|---------------------|
| Diff engine | `src/diff/diff-engine.ts` | `diffFilings()`, `makeSectionDiff()`, `buildSummary()` | `makeSectionDiff` calls `diffTables()` for matched sections; creates lightweight table stubs for added/removed sections |
| Table differ | `src/diff/table-differ.ts` | `diffTables(old[], new[])` | No changes — already complete from US-1.7 |
| Paragraph differ | `src/diff/paragraph-differ.ts` | `diffParagraphs(match)` | No changes — already complete from US-1.6 |
| Section aligner | `src/diff/section-aligner.ts` | `alignSections()` | No changes — already complete from US-1.5 |
| Types | `src/diff/types.ts` | All diff types | No changes needed |

### Test File Locations

| Test Type | File |
|-----------|------|
| Unit (diff-engine) | `tests/unit/diff/diff-engine.test.ts` |
| Integration | `tests/integration/diff-pipeline.integration.test.ts` (new) |
| E2E | `tests/e2e/diff/diff-pipeline.e2e.test.ts` (extend existing) |
| Example scripts | `examples/diff-filings.ts`, `examples/diff-summary.ts` (new) |
