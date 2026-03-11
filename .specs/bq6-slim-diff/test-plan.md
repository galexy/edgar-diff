---
title: "Test Plan: BQ6 Slim Down StructuredDiff Output"
story: edgar-diff-bq6
created: "2026-03-10"
status: approved
---

# Test Plan: BQ6 Slim Down StructuredDiff Output

## Overview

The StructuredDiff output currently embeds full source content objects at every level, causing 22MB JSON for trivial changes (target: ~0.2MB). This story removes embedded source objects while preserving diff data and source mappings.

### Changes Under Test

**Fields REMOVED from types:**

| Type | Removed Fields | Rationale |
|------|---------------|-----------|
| `SectionDiff` | `oldSection`, `newSection` (`FilingSection`) | Redundant — consumer can look up via `sourceMapping` offsets into original HTML |
| `ParagraphDiff` | `oldParagraph`, `newParagraph` (`Paragraph`) | Redundant — text is captured in `wordChanges`; location in `sourceMapping` |
| `TableDiff` | `oldTable`, `newTable` (`Table`) | Redundant — cell-level changes in `cellDiffs`; location in `sourceMapping` |

**Fields KEPT (no changes):**

| Type | Kept Fields |
|------|-------------|
| `SectionDiff` | `id`, `heading`, `changeType`, `paragraphDiffs[]`, `tableDiffs[]`, `subsectionDiffs[]`, `sourceMapping` |
| `ParagraphDiff` | `changeType`, `wordChanges?`, `sourceMapping` |
| `TableDiff` | `changeType`, `rowDiffs[]`, `cellDiffs[]`, `sourceMapping`, `summary` |

**Filtering changes (behavioral):**

- Unchanged paragraphs are filtered out of `paragraphDiffs[]` (in `makeSectionDiff()`)
- Unchanged tables are filtered out of `tableDiffs[]` (in `makeSectionDiff()`)
- Unchanged rows are filtered out of `rowDiffs[]` (in `diffTable()`)
- `oldFiling`/`newFiling` on `StructuredDiff`: changes from `RawFiling` to new `DiffDiffFilingMetadata` type (same fields minus `html`)

**Filtering layering (important for test targeting):**

| What | Where filtered | `diffParagraphs()` returns | `diffFilings()` returns |
|------|---------------|---------------------------|------------------------|
| Unchanged paragraphs | `makeSectionDiff()` in diff-engine.ts | All entries (including unchanged) | Only changed entries |
| Unchanged tables | `makeSectionDiff()` in diff-engine.ts | N/A (`diffTables()` returns all) | Only changed entries |
| Unchanged rows | `diffTable()` in table-differ.ts | N/A | Only changed rows |

This means `diffParagraphs()` and `diffTables()` still return unchanged entries — filtering is applied at the output assembly layer (`makeSectionDiff`), not in the diff algorithm functions themselves.

### Key Types Reference

Current types (pre-change) from `src/diff/types.ts`:

```typescript
interface SectionDiff {
  id: string;
  heading: string;
  changeType: ChangeType;
  oldSection?: FilingSection;    // REMOVING
  newSection?: FilingSection;    // REMOVING
  paragraphDiffs: ParagraphDiff[];
  tableDiffs: TableDiff[];
  subsectionDiffs: SectionDiff[];
  sourceMapping: DiffRange;
}

interface ParagraphDiff {
  changeType: ChangeType;
  oldParagraph?: Paragraph;      // REMOVING
  newParagraph?: Paragraph;      // REMOVING
  wordChanges?: WordChange[];
  sourceMapping: DiffRange;
}

interface TableDiff {
  changeType: ChangeType;
  oldTable?: Table;              // REMOVING
  newTable?: Table;              // REMOVING
  rowDiffs: RowDiff[];
  cellDiffs: CellDiff[];
  sourceMapping: DiffRange;
  summary: { ... };
}

interface StructuredDiff {
  oldFiling: RawFiling;          // STRIPPING html field
  newFiling: RawFiling;          // STRIPPING html field
  sectionDiffs: SectionDiff[];
  summary: { ... };
  generatedAt: Temporal.Instant;
}
```

**New type — `DiffFilingMetadata`** (replaces `RawFiling` on diff output):

```typescript
// New type in diff/types.ts
interface DiffFilingMetadata {
  accessionNumber: string;
  cik: string;
  formType: FormType;
  filingDate: Temporal.PlainDate;
  primaryDocumentFilename: string;
  fetchedAt: Temporal.Instant;
  // NO html field
}
```

**Why `DiffFilingMetadata` and not `FilingMetadata`?** There is already a `FilingMetadata` interface in `client/types.ts:69` with a different shape (uses `string` types for `formType` and `filingDate`, fewer fields). The `Diff` prefix avoids ambiguity.

From `src/client/types.ts` — `RawFiling.html` is the field being excluded:

```typescript
interface RawFiling {
  accessionNumber: string;
  cik: string;
  formType: FormType;
  filingDate: Temporal.PlainDate;
  primaryDocumentFilename: string;
  html: string;                  // NOT in DiffFilingMetadata
  fetchedAt: Temporal.Instant;
}
```

---

## 1. BDD Acceptance Criteria

### AC-1: Removed fields are absent from output

```
Given two StructuredDocuments with matched, added, and removed sections
When diffFilings() produces a StructuredDiff
Then no SectionDiff has an `oldSection` or `newSection` property
  And no ParagraphDiff has an `oldParagraph` or `newParagraph` property
  And no TableDiff has an `oldTable` or `newTable` property
```

### AC-2: Kept fields are present and correct

```
Given two StructuredDocuments with content changes
When diffFilings() produces a StructuredDiff
Then each SectionDiff has id, heading, changeType, paragraphDiffs, tableDiffs, subsectionDiffs, sourceMapping
  And each ParagraphDiff has changeType, sourceMapping, and wordChanges (when modified/moved)
  And each TableDiff has changeType, rowDiffs, cellDiffs, sourceMapping, summary
  And all field values are identical to the pre-slim implementation (except removed fields)
```

### AC-3: Unchanged elements are filtered out

```
Given two StructuredDocuments where some paragraphs, tables, and rows are unchanged
When diffFilings() produces a StructuredDiff
Then paragraphDiffs[] contains only entries with changeType != 'unchanged'
  And tableDiffs[] contains only entries with changeType != 'unchanged'
  And rowDiffs[] within each TableDiff contains only entries with changeType != 'unchanged'
  And sections with only unchanged content have empty paragraphDiffs[] and tableDiffs[]
```

### AC-4: Changed elements are included with correct data

```
Given two StructuredDocuments with added, removed, modified, and moved paragraphs
When diffFilings() produces a StructuredDiff
Then all non-unchanged paragraphDiffs are present with correct changeType and sourceMapping
  And modified paragraphs have wordChanges populated
  And all non-unchanged tableDiffs are present with correct changeType, cellDiffs, and summary
  And all non-unchanged rowDiffs are present within their parent TableDiff
```

### AC-5: Source mappings remain valid offsets into original HTML

```
Given a StructuredDiff result over two HTML documents
When inspecting every sourceMapping at section, paragraph, table, and cell levels
Then sourceMapping.old (when present) has 0 <= start < end
  And sourceMapping.new (when present) has 0 <= start < end
  And 'added' elements have only sourceMapping.new
  And 'removed' elements have only sourceMapping.old
  And 'modified'/'moved' elements have both
```

### AC-6: JSON serialization size is dramatically reduced

```
Given two StructuredDocuments producing a StructuredDiff
When serialized via JSON.stringify()
Then the output size is at least 10x smaller than the pre-slim version
  And no RawFiling in the output contains an `html` field
  And no embedded FilingSection, Paragraph, or Table objects appear in the JSON
```

### AC-7: Filing metadata is preserved without HTML

```
Given a StructuredDiff result
When inspecting oldFiling and newFiling
Then both have accessionNumber, cik, formType, filingDate, primaryDocumentFilename, fetchedAt
  And neither has an `html` property
```

---

## 2. Unit Tests

### 2.1 Type Contract Tests (`tests/unit/diff-types.test.ts`)

The existing `diff type contracts` describe block tests source mapping invariants for ParagraphDiff. These tests currently access `oldParagraph`/`newParagraph` (e.g., DT-U8 line 117, DT-U9 line 135). They must be updated.

```
describe('diff type contracts — slim output')

  it('SD-U1: SectionDiff does not have oldSection or newSection properties')
    - Build a mixed diff via diffFilings
    - For each SectionDiff: assert !('oldSection' in sd) && !('newSection' in sd)

  it('SD-U2: ParagraphDiff does not have oldParagraph or newParagraph properties')
    - For each ParagraphDiff: assert !('oldParagraph' in pd) && !('newParagraph' in pd)

  it('SD-U3: TableDiff does not have oldTable or newTable properties')
    - For each TableDiff: assert !('oldTable' in td) && !('newTable' in td)

  it('SD-U4: all kept SectionDiff fields are present')
    - For each SectionDiff: assert id, heading, changeType, paragraphDiffs, tableDiffs, subsectionDiffs, sourceMapping exist

  it('SD-U5: all kept ParagraphDiff fields are present')
    - For each ParagraphDiff: assert changeType, sourceMapping exist
    - Modified paragraphs: assert wordChanges is defined and non-empty

  it('SD-U6: all kept TableDiff fields are present')
    - For each TableDiff: assert changeType, rowDiffs, cellDiffs, sourceMapping, summary exist
```

**Note:** Existing tests DT-U1 through DT-U7 remain valid (they test source mapping invariants which are unchanged). DT-U8 and DT-U9 must be updated to not reference `oldParagraph`/`newParagraph` — instead verify the behavior via `wordChanges` presence/absence and `sourceMapping`.

### 2.2 Paragraph Differ — Slim Output (`tests/unit/paragraph-differ.test.ts`)

**Important:** `diffParagraphs()` still returns ALL entries (including unchanged). Only the `oldParagraph`/`newParagraph` fields are removed. Filtering of unchanged entries happens in `makeSectionDiff()` (tested in section 2.4). This means most existing PD-U* tests need only field-access updates, NOT behavioral changes.

```
describe('paragraph-differ — slim output')

  it('PD-S1: no oldParagraph or newParagraph in any result entry')
    - Mixed diff with added, removed, modified, moved, unchanged
    - Call diffParagraphs() directly
    - For each entry: assert !('oldParagraph' in entry) && !('newParagraph' in entry)

  it('PD-S2: unchanged paragraphs still returned by diffParagraphs()')
    - Old/new with 2 identical paragraphs
    - Assert result.length === 2, all changeType === 'unchanged'
    - (Filtering happens later in makeSectionDiff, not here)

  it('PD-S3: added paragraphs have sourceMapping.new only, no oldParagraph')
    - Old empty, new has 2 paragraphs
    - Assert result.length === 2, all changeType === 'added'
    - Assert sourceMapping.new defined, sourceMapping.old undefined
    - Assert !('oldParagraph' in entry) && !('newParagraph' in entry)

  it('PD-S4: removed paragraphs have sourceMapping.old only, no newParagraph')
    - Old has 2 paragraphs, new empty
    - Assert result.length === 2, all changeType === 'removed'
    - Assert sourceMapping.old defined, sourceMapping.new undefined

  it('PD-S5: modified paragraphs retain wordChanges without oldParagraph/newParagraph')
    - Single paragraph with text change
    - Assert wordChanges defined and non-empty
    - Assert wordChanges contain removed/added entries for the changed words

  it('PD-S6: moved paragraphs with text change retain wordChanges')
    - Two paragraphs swapped with one having a text change
    - Moved entry with text diff: assert wordChanges defined
    - Verify via wordChanges content (not oldParagraph?.text which is removed)

  it('PD-S7: moved paragraphs without text change have no wordChanges')
    - Two paragraphs swapped, identical text
    - Moved entries: assert wordChanges is undefined

  it('PD-S8: InternalParagraphDiff refactoring does not change diff behavior')
    - Same inputs as existing PD-U4 through PD-U7 tests
    - Assert all changeType classifications are identical
    - Assert all wordChanges content is identical
    - Assert all sourceMapping values are identical
    - (Only difference: no oldParagraph/newParagraph in output)
```

**Existing test updates (field removals only, no behavioral changes):**
- PD-U1 (identical paragraphs): Still returns 2 entries with changeType 'unchanged' — just remove any `oldParagraph`/`newParagraph` access
- PD-U2 (added paragraph): Remove `changes[1].newParagraph?.text` assertion, check `sourceMapping.new` instead
- PD-U3 (deleted paragraph): Remove `removed[0].oldParagraph?.text` assertion, check `sourceMapping.old` instead
- PD-U6 (swapped paragraphs): Remove `m.oldParagraph`/`m.newParagraph` access
- PD-U7 (moved with modification): Replace `c.oldParagraph?.text.includes('revenue growth')` with `c.wordChanges` check
- PD-U11 (single unchanged): Still returns 1 entry — no behavioral change
- PD-U16 (whitespace-only): Still returns 1 entry with 'unchanged' — no behavioral change
- PD-U19 (dissimilar paragraphs): Remove `c.oldParagraph?.text` access
- PD-U22/PD-U23 (table blocks): No change needed (already returns empty)

### 2.3 Table Differ — Slim Output (`tests/unit/table-differ.test.ts`)

**Filtering layering:** `diffTable()` filters unchanged rows from `rowDiffs` (summary computed before filtering). `diffTables()` still returns ALL tables (including unchanged) — unchanged table filtering happens in `makeSectionDiff()`. Both `diffTable()` and `diffTables()` strip `oldTable`/`newTable`.

```
describe('table-differ — slim output')

  it('TD-S1: diffTable result does not contain oldTable or newTable')
    - Call diffTable(oldTable, newTable) directly
    - Assert !('oldTable' in result) && !('newTable' in result)

  it('TD-S2: diffTables result does not contain oldTable or newTable')
    - Call diffTables([oldTable], [newTable])
    - For each TableDiff: assert !('oldTable' in td) && !('newTable' in td)

  it('TD-S3: unchanged rows are filtered out of rowDiffs')
    - Table with 3 rows, 1 modified
    - Assert rowDiffs only contains the modified row (not unchanged ones)
    - All rowDiff entries have changeType != 'unchanged'

  it('TD-S4: unchanged tables still returned by diffTables (filtering is in diff-engine)')
    - diffTables with two identical tables
    - Assert result.length === 1, changeType === 'unchanged'
    - (Filtering to remove this happens in makeSectionDiff, not here)

  it('TD-S5: added tables present without newTable property')
    - diffTables([], [newTable])
    - Assert result.length === 1, changeType === 'added'
    - Assert !('newTable' in result[0])

  it('TD-S6: removed tables present without oldTable property')
    - diffTables([oldTable], [])
    - Assert result.length === 1, changeType === 'removed'
    - Assert !('oldTable' in result[0])

  it('TD-S7: cellDiffs consistent with filtered rowDiffs')
    - After filtering unchanged rows, cellDiffs should be flatMap of remaining rowDiffs.cellDiffs
    - Assert td.cellDiffs deep-equals td.rowDiffs.flatMap(rd => rd.cellDiffs)

  it('TD-S8: summary counts include all rows (computed before filtering)')
    - Table with 3 rows: 1 unchanged, 1 modified, 1 added
    - summary.rowsUnchanged === 1, summary.rowsModified === 1, summary.rowsAdded === 1
    - But rowDiffs.length === 2 (unchanged row filtered out)
    - NOTE: summary reflects the full picture, rowDiffs is filtered

  it('TD-S9: all rows identical → rowDiffs empty, summary shows all unchanged')
    - Identical tables (diffTable returns changeType 'unchanged')
    - rowDiffs === [] (all unchanged rows filtered)
    - summary.rowsUnchanged > 0, all other counts === 0
```

**Existing test updates:**
- `diffTables` added test (line 280-281): Remove `result[0].newTable` assertion, verify via sourceMapping
- `diffTables` removed test (line 290): Remove `result[0].oldTable` assertion, verify via sourceMapping
- Row alignment tests: unchanged row assertions change (e.g., "identical rows => all unchanged" now has empty rowDiffs)
- Boundary tests: "empty vs empty => unchanged" now has rowDiffs=[] explicitly

### 2.4 Diff Engine — Slim Output (`tests/unit/diff/diff-engine.test.ts`)

This is the key test area because `makeSectionDiff()` is where field removal AND unchanged filtering both happen.

```
describe('toDiffFilingMetadata')

  it('DE-S0: toDiffFilingMetadata strips html, keeps all other fields')
    - Input: RawFiling with html: 'x'.repeat(10000)
    - Output: DiffFilingMetadata with accessionNumber, cik, formType, filingDate, primaryDocumentFilename, fetchedAt
    - Assert !('html' in result) — key is actually absent, not just undefined
    - Assert all other field values match the input

describe('diffFilings — slim output')

  it('DE-S1: makeSectionDiff does not embed oldSection or newSection')
    - diffFilings with matched sections
    - For each sectionDiff: assert !('oldSection' in sd) && !('newSection' in sd)

  it('DE-S2: oldFiling and newFiling are DiffFilingMetadata (no html field)')
    - diffFilings result
    - Assert !('html' in result.oldFiling) && !('html' in result.newFiling)
    - Assert result.oldFiling is NOT reference-equal to oldDoc.filing (it's a new object)

  it('DE-S3: oldFiling/newFiling retain all DiffFilingMetadata fields')
    - Assert accessionNumber, cik, formType, filingDate, primaryDocumentFilename, fetchedAt all defined
    - Assert values match the original RawFiling values

  it('DE-S4: unchanged paragraphs filtered from matched section diffs')
    - Section with 3 paragraphs: 2 unchanged, 1 modified
    - Assert sectionDiff.paragraphDiffs.length === 1
    - Assert the single entry has changeType 'modified'

  it('DE-S5: unchanged tables filtered from matched section diffs')
    - Section with 2 tables: 1 unchanged, 1 modified
    - Assert sectionDiff.tableDiffs.length === 1
    - Assert the single entry has changeType 'modified'

  it('DE-S6: section with all unchanged content has empty paragraphDiffs and tableDiffs')
    - Identical sections
    - sectionDiff.changeType === 'unchanged'
    - paragraphDiffs === [] and tableDiffs === []

  it('DE-S7: added section tableDiffs have no newTable property')
    - Added section with tables
    - For each td: assert !('newTable' in td)
    - Assert changeType === 'added', sourceMapping.new defined

  it('DE-S8: removed section tableDiffs have no oldTable property')
    - Removed section with tables
    - For each td: assert !('oldTable' in td)
    - Assert changeType === 'removed', sourceMapping.old defined

  it('DE-S9: summary counts are unchanged by filtering')
    - The section-level summary (added/removed/modified/unchanged/reordered)
    - should be identical to pre-slim implementation
    - Filtering only affects contents of paragraphDiffs/tableDiffs, not section changeType

  it('DE-S10: filtering does not lose any changed content')
    - Section with 5 paragraphs (2 added, 1 modified, 2 unchanged) + 3 tables (1 modified, 2 unchanged)
    - paragraphDiffs.length === 3 (2 added + 1 modified)
    - tableDiffs.length === 1 (1 modified)
    - All sourceMapping values are correct

  it('DE-S11: reordered sections are NOT filtered')
    - Two sections that swap order but have identical content
    - sectionDiffs should contain entries with changeType 'reordered' (or 'moved')
    - These sections still appear (they are not 'unchanged')
    - Their paragraphDiffs may be empty (content unchanged), but the section entry itself is present

  it('DE-S12: moved paragraphs are NOT filtered')
    - Section where paragraphs are reordered
    - paragraphDiffs should contain entries with changeType 'moved'
    - These are not filtered (they're not 'unchanged')
```

### 2.5 JSON Serialization (`tests/unit/diff/diff-engine.test.ts`)

```
describe('JSON serialization — slim output')

  it('JS-S1: serialized JSON does not contain html field')
    - JSON.stringify(result) → parse → assert !('html' in parsed.oldFiling)

  it('JS-S2: serialized JSON does not contain oldSection/newSection')
    - For each sectionDiff in parsed: assert no oldSection/newSection keys

  it('JS-S3: serialized JSON does not contain oldParagraph/newParagraph')
    - For each paragraphDiff: assert no oldParagraph/newParagraph keys

  it('JS-S4: serialized JSON does not contain oldTable/newTable')
    - For each tableDiff: assert no oldTable/newTable keys

  it('JS-S5: JSON output size is dramatically smaller than pre-slim')
    - Build a doc with realistic section/table content
    - Compare JSON.stringify(slimResult).length vs estimated pre-slim size
    - Assert at least 10x reduction

  it('JS-S6: full round-trip preserves all kept fields')
    - JSON.stringify → JSON.parse
    - sectionDiffs.length, summary, paragraphDiffs, tableDiffs, cellDiffs all preserved
    - Temporal types serialize to ISO strings
```

---

## 3. Integration Tests

### 3.1 Full Pipeline with Slim Output (`tests/integration/diff-pipeline.integration.test.ts`)

```
describe('diff pipeline integration — slim output')

  it('I-S1: full pipeline produces slimmed output without embedded source objects')
    - Build docs with mixed paragraph + table content
    - diffFilings() → assert no oldSection/newSection, oldParagraph/newParagraph, oldTable/newTable
    - Assert paragraphDiffs/tableDiffs only contain changed entries

  it('I-S2: source mappings in slimmed output point to valid offsets')
    - For all sourceMapping at section, paragraph, table, cell levels:
    - old (when present): 0 <= start < end <= oldHtml.length
    - new (when present): 0 <= start < end <= newHtml.length
    - (Same validation as I-DP-2 through I-DP-4 but now also verifying slim structure)

  it('I-S3: filtering preserves all changed content while removing unchanged')
    - Multi-section doc: section with 5 paragraphs (3 unchanged, 2 changed) + 3 tables (2 unchanged, 1 changed)
    - paragraphDiffs contains exactly the 2 changed entries
    - tableDiffs contains exactly the 1 changed entry
    - No information loss — all changeTypes, wordChanges, cellDiffs intact

  it('I-S4: metadata preserved without html in multi-section pipeline')
    - diffFilings result with multiple sections
    - result.oldFiling has accessionNumber, cik, formType, filingDate, primaryDocumentFilename, fetchedAt
    - result.oldFiling does not have html
    - Same for result.newFiling

  it('I-S5: added/removed section table stubs are slim')
    - Removed section: tableDiffs entries have changeType 'removed', rowDiffs=[], cellDiffs=[]
    - No oldTable/newTable properties
    - sourceMapping.old is set (from table.source)

  it('I-S6: unchanged section has empty paragraphDiffs and tableDiffs')
    - Two identical sections
    - sectionDiff.changeType === 'unchanged'
    - paragraphDiffs === [], tableDiffs === []
```

### 3.2 Backward Compatibility Concerns

```
describe('slim output — consumer compatibility')

  it('I-S7: filtering by changeType still works on paragraphDiffs')
    - result.sectionDiffs[0].paragraphDiffs.filter(pd => pd.changeType === 'added')
    - Returns correct entries (filtering on already-filtered list)

  it('I-S8: cellDiffs flat list is consistent with filtered rowDiffs')
    - For each TableDiff: td.cellDiffs equals td.rowDiffs.flatMap(rd => rd.cellDiffs)
    - (Even after unchanged row filtering)

  it('I-S9: summary.cellsChanged still matches cellDiffs.length')
    - For each TableDiff: td.summary.cellsChanged === td.cellDiffs.length
```

---

## 4. End-to-End Tests

### 4.1 Full Pipeline E2E (`tests/e2e/diff/diff-pipeline.e2e.test.ts`)

Extend existing E2E tests. The existing E2E-1 through E2E-5 and E2E-T1 through E2E-T7 test real Apple 10-K filings. After slimming, update and add:

```
describe('E2E: slim StructuredDiff')

  it('E2E-S1: output JSON size is within target bounds')
    - parseFiling → diffFilings on Apple 10-K fixtures
    - JSON.stringify(result).length should be < 1MB (was ~22MB)
    - Log actual size for manual inspection

  it('E2E-S2: no embedded source objects in real filing diff')
    - Walk all sectionDiffs, paragraphDiffs, tableDiffs
    - Assert no oldSection/newSection, oldParagraph/newParagraph, oldTable/newTable

  it('E2E-S3: unchanged elements filtered from real filing diff')
    - For sections that have changeType 'unchanged':
      - paragraphDiffs should be empty (all paragraphs unchanged → filtered)
      - tableDiffs should be empty
    - For sections with changeType 'modified':
      - paragraphDiffs should only contain non-unchanged entries

  it('E2E-S4: self-diff produces fully empty diff contents')
    - diffFilings(oldDoc, oldDoc)
    - All sectionDiffs have changeType 'unchanged'
    - All paragraphDiffs === [] (everything filtered as unchanged)
    - All tableDiffs === [] (everything filtered as unchanged)

  it('E2E-S5: JSON round-trip with slim output')
    - JSON.stringify(result) → JSON.parse
    - No oldSection/newSection, oldParagraph/newParagraph, oldTable/newTable in parsed
    - All kept fields survive round-trip
    - Temporal types are ISO strings

  it('E2E-S6: oldFiling/newFiling metadata preserved, html stripped')
    - result.oldFiling.accessionNumber matches expected
    - result.oldFiling.cik matches expected
    - !('html' in result.oldFiling)

  it('E2E-S7: source mappings remain valid after slimming')
    - All sourceMapping ranges are valid offsets
    - Direction (old-only, new-only, both) matches changeType
    - (Same as E2E-T4 but explicitly verifying nothing broke in slimming)

  it('E2E-S8: deterministic slim output')
    - Run diffFilings twice
    - JSON.stringify of both results (excluding generatedAt) should be identical
```

### 4.2 Example Script Updates (`tests/e2e/examples.e2e.test.ts`)

Existing example scripts access fields that are being removed. They need updates:

```
describe('example scripts — slim output compatibility')

  it('EX-S1: diff-simple.ts works with slim output')
    - Script accesses: sd.paragraphDiffs, sd.tableDiffs, sd.changeType
    - These are all kept fields — should work
    - But script writes full JSON.stringify(result) — verify no html bloat
    - Assert exit code 0

  it('EX-S2: diff-with-tables.ts works with slim output')
    - Script accesses: td.summary, td.cellDiffs, cd.oldNumericValue, cd.newNumericValue
    - All kept fields — should work
    - Assert exit code 0

  it('EX-S3: diff-to-json.ts produces valid slim JSON')
    - Capture stdout
    - JSON.parse succeeds
    - No html field in oldFiling/newFiling
    - No oldSection/newSection in sectionDiffs
```

**Note:** The example scripts (`diff-simple.ts`, `diff-with-tables.ts`, `diff-structural.ts`, `diff-to-json.ts`) currently use only kept fields (`sd.paragraphDiffs`, `sd.tableDiffs`, `td.summary`, `td.cellDiffs`, etc.) and should not require code changes. The main benefit is that `diff-to-json.ts` will produce dramatically smaller output files.

---

## 5. Boundary Conditions

```
describe('boundary conditions — slim output')

  it('B-S1: empty diff (identical filings) → all sections unchanged, all diffs empty')
    - diffFilings with identical documents
    - All sectionDiffs have changeType 'unchanged'
    - All paragraphDiffs === [] (filtered)
    - All tableDiffs === [] (filtered)
    - Summary: added=0, removed=0, modified=0, unchanged=N

  it('B-S2: all sections changed → no filtering occurs')
    - Every section has modified paragraphs and tables
    - All paragraphDiffs and tableDiffs are populated
    - No entries filtered (none are unchanged)

  it('B-S3: all sections unchanged → all paragraphDiffs and tableDiffs empty')
    - Identical documents
    - Every sectionDiff: paragraphDiffs === [], tableDiffs === []

  it('B-S4: section with only added paragraphs → all appear in paragraphDiffs')
    - Old section empty blocks, new section has 3 paragraphs
    - paragraphDiffs.length === 3, all changeType 'added'
    - No sourceMapping.old on any entry

  it('B-S5: section with only removed paragraphs → all appear in paragraphDiffs')
    - Old section has 3 paragraphs, new section empty blocks
    - paragraphDiffs.length === 3, all changeType 'removed'
    - No sourceMapping.new on any entry

  it('B-S6: table with only cell value changes → table in tableDiffs, only modified rows in rowDiffs')
    - Table with 5 rows, 1 row has cell changes
    - tableDiffs.length === 1 (table is modified)
    - rowDiffs contains only the 1 modified row (4 unchanged filtered)
    - summary.rowsUnchanged === 4, summary.rowsModified === 1

  it('B-S7: table with structural changes (rows added/removed) → present in rowDiffs')
    - Table with added and removed rows
    - rowDiffs contains added + removed rows (not unchanged)
    - summary reflects all row counts

  it('B-S8: section with 1 changed paragraph among 100 → paragraphDiffs.length === 1')
    - Large section, only 1 paragraph modified
    - Assert only the modified paragraph appears

  it('B-S9: section with 1 changed table among 20 → tableDiffs.length === 1')
    - Large section, only 1 table modified
    - Assert only the modified table appears

  it('B-S10: both documents empty (no sections) → empty slim result')
    - diffFilings with 0 sections each
    - sectionDiffs === [], summary all zeros
    - oldFiling/newFiling present without html
```

---

## 6. Error Conditions

```
describe('error conditions — slim output')

  it('E-S1: malformed source locations (start > end) in input → passed through as-is')
    - Source mapping validation is the parser's responsibility
    - diffFilings should not crash if a sourceMapping has odd values
    - (Defensive — should not happen with valid parser output)

  it('E-S2: section with empty blocks array → slim output has empty diffs')
    - Matched sections with blocks = []
    - paragraphDiffs === [], tableDiffs === []
    - No crash

  it('E-S3: diffFilings never throws for valid inputs (fuzz with slim output)')
    - Variety of section/block combinations (same as existing E-5)
    - Assert no exceptions
    - Additionally verify slim properties: no embedded source objects

  it('E-S4: table with 0 rows → valid slim tableDiff if table is matched')
    - Two empty tables matched
    - If changeType 'unchanged' → filtered out (not in tableDiffs)
    - If somehow in tableDiffs, rowDiffs === []

  it('E-S5: RawFiling with empty html string → stripped correctly')
    - Filing with html: '' → after stripping, no html field
    - No crash
```

---

## 7. Test Data: Fixtures and Helpers

### 7.1 Existing Helpers (Updates Needed)

| Helper | File | Status |
|--------|------|--------|
| `makeParagraph(text, start)` | `tests/helpers/diff-fixtures.ts` | No change |
| `makeTable(rows, start)` | `tests/helpers/diff-fixtures.ts` | No change |
| `makeSection(id, heading, blocks, start)` | `tests/helpers/diff-fixtures.ts` | No change |
| `makeStructuredDoc(sections)` | `tests/helpers/diff-fixtures.ts` | No change |
| `makeTable(rows)`, `makeTableRow`, `makeTableCell` | `tests/helpers/table-diff-helpers.ts` | No change |
| `makeRawFiling(html, overrides)` | `tests/helpers/ground-truth.ts` | No change |

### 7.2 New Helpers Needed

**`assertSlimSectionDiff(sd: SectionDiff)`** — reusable assertion for slim output:

```typescript
function assertSlimSectionDiff(sd: SectionDiff): void {
  expect(sd).not.toHaveProperty('oldSection');
  expect(sd).not.toHaveProperty('newSection');
  expect(sd).toHaveProperty('id');
  expect(sd).toHaveProperty('heading');
  expect(sd).toHaveProperty('changeType');
  expect(sd).toHaveProperty('paragraphDiffs');
  expect(sd).toHaveProperty('tableDiffs');
  expect(sd).toHaveProperty('sourceMapping');
  for (const pd of sd.paragraphDiffs) {
    assertSlimParagraphDiff(pd);
  }
  for (const td of sd.tableDiffs) {
    assertSlimTableDiff(td);
  }
}
```

**`assertSlimParagraphDiff(pd: ParagraphDiff)`**:

```typescript
function assertSlimParagraphDiff(pd: ParagraphDiff): void {
  expect(pd).not.toHaveProperty('oldParagraph');
  expect(pd).not.toHaveProperty('newParagraph');
  expect(pd.changeType).not.toBe('unchanged'); // filtered
  expect(pd).toHaveProperty('changeType');
  expect(pd).toHaveProperty('sourceMapping');
}
```

**`assertSlimTableDiff(td: TableDiff)`**:

```typescript
function assertSlimTableDiff(td: TableDiff): void {
  expect(td).not.toHaveProperty('oldTable');
  expect(td).not.toHaveProperty('newTable');
  expect(td.changeType).not.toBe('unchanged'); // filtered
  expect(td).toHaveProperty('changeType');
  expect(td).toHaveProperty('rowDiffs');
  expect(td).toHaveProperty('cellDiffs');
  expect(td).toHaveProperty('sourceMapping');
  expect(td).toHaveProperty('summary');
  // Verify no unchanged rows in rowDiffs
  for (const rd of td.rowDiffs) {
    expect(rd.changeType).not.toBe('unchanged');
  }
}
```

**`assertDiffFilingMetadata(filing: DiffFilingMetadata)`**:

```typescript
function assertDiffFilingMetadata(filing: Record<string, unknown>): void {
  expect(filing).not.toHaveProperty('html');
  expect(filing).toHaveProperty('accessionNumber');
  expect(filing).toHaveProperty('cik');
  expect(filing).toHaveProperty('formType');
  expect(filing).toHaveProperty('filingDate');
  expect(filing).toHaveProperty('primaryDocumentFilename');
  expect(filing).toHaveProperty('fetchedAt');
}
```

These helpers go in `tests/helpers/slim-assertions.ts` and are used across unit, integration, and e2e tests.

### 7.3 Fixture Strategy

| Test Level | Fixture Source |
|------------|---------------|
| Unit tests | Inline via `makeTable`, `makeParagraph`, `makeSection` helpers |
| Integration | Inline StructuredDocuments built from helpers |
| E2E | Real HTML fixtures: `apple-fy2023.htm`, `apple-fy2024.htm` from `spikes/diff-algorithm/fixtures/` |

### 7.4 Existing Test Updates Summary

Tests that reference removed fields and need updating:

**Type: Field access removals (compile errors after type change):**

| Test | File | Issue |
|------|------|-------|
| DT-U8 | `diff-types.test.ts:117` | Accesses `m.oldParagraph?.text` and `m.newParagraph?.text` → use `wordChanges` instead |
| DT-U9 | `diff-types.test.ts:135` | Accesses `m.oldParagraph?.text` and `m.newParagraph?.text` → use `wordChanges` instead |
| PD-U2 | `paragraph-differ.test.ts:35` | Accesses `changes[1].newParagraph?.text` → check `sourceMapping.new` instead |
| PD-U3 | `paragraph-differ.test.ts:45` | Accesses `removed[0].oldParagraph?.text` → check `sourceMapping.old` instead |
| PD-U6 | `paragraph-differ.test.ts:82` | Accesses `m.oldParagraph`/`m.newParagraph` → remove these accesses |
| PD-U7 | `paragraph-differ.test.ts:107` | Accesses `c.oldParagraph?.text.includes(...)` → check via `wordChanges` content |
| PD-U19 | `paragraph-differ.test.ts:229` | Accesses `c.oldParagraph?.text` → check via `sourceMapping` or remove |
| I-DP-7 | `diff-pipeline.integration.test.ts:309-320` | Accesses `td.oldTable`, `td.newTable` → verify via `sourceMapping` |
| I-DP-8 | `diff-pipeline.integration.test.ts:347-377` | Accesses `td.oldTable`, `td.newTable` → verify absence instead |
| table-differ | `table-differ.test.ts:280-281` | `result[0].newTable` → verify via `!('newTable' in result[0])` |
| table-differ | `table-differ.test.ts:290` | `result[0].oldTable` → verify via `!('oldTable' in result[0])` |

**Type: Behavioral changes (filtering):**

| Test | File | Issue |
|------|------|-------|
| PD-U1 | `paragraph-differ.test.ts:22` | No change needed — `diffParagraphs()` still returns unchanged entries |
| PD-U11 | `paragraph-differ.test.ts:142` | No change needed — `diffParagraphs()` still returns unchanged entries |
| PD-U16 | `paragraph-differ.test.ts:198` | No change needed — `diffParagraphs()` still returns unchanged entries |
| DF-U1 | `diff-filings.test.ts:30` | Need to check `result.oldFiling` is `DiffFilingMetadata` (no `html`) |
| row alignment tests | `table-differ.test.ts` | Unchanged row assertions change — `rowDiffs` no longer contains unchanged rows |

**Type: DiffFilingMetadata migration:**

| Test | File | Issue |
|------|------|-------|
| DF-U* | `diff-filings.test.ts` | `result.oldFiling`/`result.newFiling` is now `DiffFilingMetadata` — no `html` field |
| I-DP-5 | `diff-pipeline.integration.test.ts:213` | Reference equality check `result.oldFiling === oldDoc.filing` no longer holds (new object) |
| E2E-2 | `diff-pipeline.e2e.test.ts:55` | Custom Temporal replacer may be simplified (but still works) |

---

## 8. Implementation Design Alignment

Per the implementation design (`implementation-design.md`), the implementation:

1. **Removes fields from TypeScript interfaces** — not just omits at runtime, but removes from type definitions so TypeScript enforces the contract
2. **Creates `DiffFilingMetadata` type** — explicit named type in `diff/types.ts` (not `Omit<RawFiling, 'html'>`) for `StructuredDiff.oldFiling`/`newFiling`
3. **Uses `toDiffFilingMetadata()` helper** — private function in `diff-engine.ts` that constructs `DiffFilingMetadata` from `RawFiling`
4. **Filters unchanged paragraphs/tables in `makeSectionDiff()`** — not in the diff algorithm functions themselves
5. **Filters unchanged rows in `diffTable()`** — summary computed BEFORE filtering, then rows filtered
6. **Uses `InternalParagraphDiff`** — internal type extending `ParagraphDiff` with `_oldParagraph`/`_newParagraph` for intermediate computation, stripped at `diffParagraphs()` boundary
7. **Keeps `summary` counts from full data** — `TableDiff.summary` reflects total row counts even though `rowDiffs[]` is filtered
8. **Ensures `cellDiffs` consistency** — derived from filtered `rowDiffs` only (unchanged rows have no cellDiffs, so naturally consistent)

---

## Module Interface Summary

| Module | File | What Changes |
|--------|------|-------------|
| Types | `src/diff/types.ts` | Add `DiffFilingMetadata`; remove `oldSection`/`newSection` from SectionDiff, `oldParagraph`/`newParagraph` from ParagraphDiff, `oldTable`/`newTable` from TableDiff. Change `StructuredDiff.oldFiling`/`newFiling` to `DiffFilingMetadata`. |
| Diff engine | `src/diff/diff-engine.ts` | Add `toDiffFilingMetadata()` helper. Filter unchanged paragraphDiffs/tableDiffs in `makeSectionDiff()`. Remove `oldSection`/`newSection` from return. Remove `oldTable`/`newTable` from added/removed section table stubs. |
| Paragraph differ | `src/diff/paragraph-differ.ts` | Add `InternalParagraphDiff` internal type. Strip `_oldParagraph`/`_newParagraph` at `diffParagraphs()` boundary. No filtering (still returns unchanged). |
| Table differ | `src/diff/table-differ.ts` | Remove `oldTable`/`newTable` from `diffTable()` and `diffTables()` output. Filter unchanged rows from `rowDiffs` (summary computed before filtering). No table-level filtering (still returns unchanged tables). |
| Barrel exports | `src/diff/index.ts`, `src/index.ts` | Export `DiffFilingMetadata` type. |

### Test File Locations

| Test Type | File |
|-----------|------|
| Type contracts | `tests/unit/diff-types.test.ts` (update existing + add slim tests) |
| Paragraph differ | `tests/unit/paragraph-differ.test.ts` (update existing + add slim tests) |
| Table differ | `tests/unit/table-differ.test.ts` (update existing + add slim tests) |
| Diff engine | `tests/unit/diff/diff-engine.test.ts` (add slim tests) |
| Integration | `tests/integration/diff-pipeline.integration.test.ts` (update + add slim tests) |
| E2E | `tests/e2e/diff/diff-pipeline.e2e.test.ts` (update + add slim tests) |
| Slim assertions helper | `tests/helpers/slim-assertions.ts` (new) |
