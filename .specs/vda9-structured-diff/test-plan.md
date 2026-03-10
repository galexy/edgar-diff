# Test Plan: US-1.8 — Produce a Structured Diff Output

**Bead:** edgar-diff-55m
**Story:** US-1.8 — Produce a structured diff output
**Scope:** Integration of US-1.5 (section-level diff), US-1.6 (paragraph-level diffs), and US-1.7 (table-level diffs) into a single coherent `StructuredDiff` output from `diffFilings()`.

---

## 1. Acceptance Criteria (BDD Scenarios)

### AC-1: Diff is a structured object, not rendered text

```gherkin
Given two parsed StructuredDocuments (old and new)
When I call diffFilings(oldDoc, newDoc)
Then the result is an object conforming to the StructuredDiff interface
And the result is NOT a string or rendered HTML
```

### AC-2: Includes metadata (accession numbers, filing dates, form type, CIK)

```gherkin
Given oldDoc with filing { accessionNumber: "0000320193-23-000106", cik: "0000320193", formType: "10-K", filingDate: "2023-11-03" }
And newDoc with filing { accessionNumber: "0000320193-24-000123", cik: "0000320193", formType: "10-K", filingDate: "2024-11-01" }
When I call diffFilings(oldDoc, newDoc)
Then result.oldFiling.accessionNumber === "0000320193-23-000106"
And result.newFiling.accessionNumber === "0000320193-24-000123"
And result.oldFiling.cik === "0000320193"
And result.oldFiling.formType === "10-K"
And result.oldFiling.filingDate is Temporal.PlainDate for "2023-11-03"
And result.newFiling.filingDate is Temporal.PlainDate for "2024-11-01"
```

### AC-3: Section diffs include heading, change type, and content diffs

```gherkin
Given oldDoc with sections [Item 1. Business, Item 2. Properties]
And newDoc with sections [Item 1. Business (modified), Item 3. Legal (new)]
When I call diffFilings(oldDoc, newDoc)
Then each sectionDiff has: id, heading, changeType, paragraphDiffs, tableDiffs, subsectionDiffs, sourceMapping
And sectionDiff changeTypes are one of: added, removed, modified, unchanged, reordered
And Item 2 has changeType "removed"
And Item 3 has changeType "added"
```

### AC-4: Paragraph diffs include source mappings to both old and new filing HTML

```gherkin
Given two matched sections with modified paragraphs
When I call diffFilings(oldDoc, newDoc)
Then modified paragraphDiffs have sourceMapping.old with valid SourceLocation
And modified paragraphDiffs have sourceMapping.new with valid SourceLocation
And added paragraphDiffs have sourceMapping.new only (old is undefined)
And removed paragraphDiffs have sourceMapping.old only (new is undefined)
And unchanged paragraphDiffs have both sourceMapping.old and sourceMapping.new
```

### AC-5: Table diffs are included within their containing sections

```gherkin
Given oldDoc section "Item 8" contains 3 financial tables
And newDoc section "Item 8" contains 3 financial tables with cell changes
When I call diffFilings(oldDoc, newDoc)
Then the sectionDiff for "Item 8" has tableDiffs.length >= 1
And each tableDiff has: changeType, rowDiffs, cellDiffs, sourceMapping, summary
And tableDiffs with changeType "modified" have non-empty cellDiffs
```

### AC-6: Serializable to JSON for storage/transmission

```gherkin
Given result = diffFilings(oldDoc, newDoc)
When I call structuredDiffToJSON(result)
Then the result is a plain object with no Temporal types
And JSON.parse(JSON.stringify(jsonResult)) succeeds without error
And jsonResult.generatedAt is a valid ISO-8601 instant string
And jsonResult.oldFiling.filingDate is a valid ISO-8601 date string (YYYY-MM-DD)
And jsonResult.oldFiling does NOT contain an "html" property
And jsonResult.sectionDiffs.length === result.sectionDiffs.length
And jsonResult.summary deep-equals result.summary
```

### AC-7: Output format supports rendering diff highlights as overlays

```gherkin
Given result = diffFilings(oldDoc, newDoc) using real filings
When I examine section-level sourceMapping
Then sourceMapping.old.start and sourceMapping.old.end define a valid byte range in oldDoc.filing.html
And sourceMapping.new.start and sourceMapping.new.end define a valid byte range in newDoc.filing.html
And extracting oldDoc.filing.html.slice(start, end) returns the section's HTML content
When I examine paragraph-level sourceMapping
Then paragraph sourceMapping.old points to valid offsets within the section's source range
And paragraph sourceMapping.new points to valid offsets within the section's source range
```

---

## 2. Unit Tests

**File:** `tests/unit/diff/diff-engine.test.ts` (extend existing)

These tests use inline fixtures via `makeDocumentPair()`, `makeFilingSection()`, `makeParagraph()`, `makeTable()` from `tests/helpers/diff-helpers.ts` and `tests/helpers/diff-fixtures.ts`.

### 2.1 StructuredDiff shape and metadata

| ID | Test | What it verifies |
|----|------|-----------------|
| U-SD-1 | `diffFilings returns StructuredDiff with all required top-level fields` | Result has `oldFiling`, `newFiling`, `sectionDiffs`, `summary`, `generatedAt` |
| U-SD-2 | `oldFiling and newFiling reference input document filings` | `result.oldFiling === oldDoc.filing`, `result.newFiling === newDoc.filing` |
| U-SD-3 | `generatedAt is a valid Temporal.Instant` | `result.generatedAt instanceof Temporal.Instant` |
| U-SD-4 | `metadata fields are preserved through diff` | accessionNumber, cik, formType, filingDate match inputs |

> **Note:** U-SD-1, U-SD-2, U-SD-3 already exist as U-DF-1, U-DF-2, U-DF-3. U-SD-4 is new — it verifies specific metadata field preservation.

### 2.2 Sections with tables

| ID | Test | What it verifies |
|----|------|-----------------|
| U-ST-1 | `section with only tables populates tableDiffs, paragraphDiffs is empty` | Table blocks in sections route to `tableDiffs` |
| U-ST-2 | `section with only paragraphs has empty tableDiffs` | No false table diffs when section has no tables |
| U-ST-3 | `section with mixed content has both paragraphDiffs and tableDiffs` | Both differ pipelines invoked for mixed-content sections |
| U-ST-4 | `added section lists all tables as tableDiffs with changeType added` | Added section: tables are all `changeType: 'added'` |
| U-ST-5 | `removed section lists all tables as tableDiffs with changeType removed` | Removed section: tables are all `changeType: 'removed'` |
| U-ST-6 | `self-diff produces tableDiffs with changeType unchanged` | Tables in identity diff are `unchanged` |
| U-ST-7 | `modified section detects table cell changes` | When table cell values change between filings, `tableDiffs[].cellDiffs` is non-empty |

### 2.3 Summary counts

| ID | Test | What it verifies |
|----|------|-----------------|
| U-SM-1 | `summary counts match actual sectionDiff changeTypes` | `summary.added + removed + modified + unchanged + reordered === sectionDiffs.length` |
| U-SM-2 | `empty documents produce all-zero summary` | Edge case: no sections |
| U-SM-3 | `all unchanged sections produce summary with only unchanged > 0` | Self-diff scenario |
| U-SM-4 | `mixed changes produce correct counts per changeType` | Multi-section mixed scenario |

> **Note:** U-SM-1 already exists as U-DF-5. U-SM-2, U-SM-3, U-SM-4 validate edge cases.

### 2.4 SectionDiff structure

| ID | Test | What it verifies |
|----|------|-----------------|
| U-SS-1 | `each sectionDiff has id, heading, changeType, paragraphDiffs, tableDiffs, subsectionDiffs, sourceMapping` | Shape completeness |
| U-SS-2 | `added section has sourceMapping.new defined, sourceMapping.old undefined` | Correct source mapping for added sections |
| U-SS-3 | `removed section has sourceMapping.old defined, sourceMapping.new undefined` | Correct source mapping for removed sections |
| U-SS-4 | `matched section (modified/unchanged/reordered) has both sourceMapping.old and sourceMapping.new` | Correct source mapping for matched sections |

### 2.5 Serialization (`structuredDiffToJSON`)

**File:** `tests/unit/diff/serialization.test.ts` (new)

| ID | Test | What it verifies |
|----|------|-----------------|
| U-SZ-1 | `converts generatedAt to parseable ISO-8601 instant string` | `typeof result.generatedAt === 'string'` and `Temporal.Instant.from(result.generatedAt)` succeeds |
| U-SZ-2 | `converts filingDate to ISO-8601 date string (YYYY-MM-DD)` | `result.oldFiling.filingDate === '2024-01-01'` (exact match) |
| U-SZ-3 | `converts fetchedAt to ISO-8601 instant string` | `typeof result.oldFiling.fetchedAt === 'string'` and parseable |
| U-SZ-4 | `omits html from RawFilingJSON` | `'html' in result.oldFiling === false` and `'html' in result.newFiling === false` |
| U-SZ-5 | `preserves sectionDiffs by reference` | `result.sectionDiffs === input.sectionDiffs` (same array reference, no deep copy needed since SectionDiff is already JSON-safe) |
| U-SZ-6 | `preserves summary as-is` | `result.summary` deep-equals `input.summary` |
| U-SZ-7 | `round-trip: JSON.parse(JSON.stringify(structuredDiffToJSON(diff))) produces valid output` | Full round-trip preserves all fields, no Temporal serialization errors |
| U-SZ-8 | `preserves accessionNumber, cik, formType in RawFilingJSON` | Metadata fields survive serialization |
| U-SZ-9 | `tableDiffs within sectionDiffs survive JSON round-trip` | `cellDiffs[].oldValue`, `newValue`, `row`, `col` preserved through `JSON.parse(JSON.stringify(...))` |

---

## 3. Integration Tests

**File:** `tests/integration/diff/structured-diff.integration.test.ts` (new)

These tests use real filing HTML fixtures parsed via `parseFiling()` + `makeRawFiling()` from `tests/helpers/ground-truth.ts`.

### 3.1 Real filing pair → full StructuredDiff

| ID | Test | Fixtures | What it verifies |
|----|------|----------|-----------------|
| I-SD-1 | `Apple FY2023 vs FY2024 produces StructuredDiff with populated tableDiffs` | `apple-fy2023.htm`, `apple-fy2024.htm` (spike fixtures) | `sectionDiffs` have non-empty `tableDiffs` for financial sections |
| I-SD-2 | `MSFT 2023 vs 2024 produces StructuredDiff with populated tableDiffs` | `10k-msft-2023.html`, `10k-msft-2024.html` | Validates table integration across a different filer |
| I-SD-3 | `paragraphDiffs source mappings point to valid HTML offsets` | Any fixture pair | For each `paragraphDiff.sourceMapping.old`, `start >= 0` and `end <= html.length` |
| I-SD-4 | `tableDiffs source mappings point to valid HTML offsets` | Any fixture pair | Same validation for table source mappings |

### 3.2 Determinism and consistency

| ID | Test | What it verifies |
|----|------|-----------------|
| I-SD-5 | `diffFilings is deterministic: same input → same output` | Run `diffFilings` twice on same input, compare sectionDiffs ids, changeTypes, and summary |
| I-SD-6 | `self-diff on real filing produces all unchanged with zero table cellDiffs` | `diffFilings(doc, doc)` → all sections unchanged, all tableDiffs unchanged, all cellDiffs empty |

---

## 4. End-to-End Tests

**File:** `tests/e2e/diff/diff-pipeline.e2e.test.ts` (extend existing)

### 4.1 Full pipeline: parse → diff → serialize → deserialize

| ID | Test | What it verifies |
|----|------|-----------------|
| E2E-SD-1 | `full pipeline: parse two filings, diff, structuredDiffToJSON, JSON round-trip, verify structure` | Round-trip: `parseFiling → diffFilings → structuredDiffToJSON → JSON.stringify → JSON.parse` preserves `sectionDiffs.length`, `summary`, `tableDiffs` counts, `paragraphDiffs` counts |
| E2E-SD-2 | `serialized StructuredDiff includes all metadata, html omitted` | Deserialized JSON has `oldFiling.accessionNumber`, `newFiling.accessionNumber`, `oldFiling.cik`, `newFiling.formType`, `generatedAt`; no `html` field |
| E2E-SD-3 | `serialized tableDiffs preserve cellDiff details` | After round-trip, `cellDiffs[].oldValue`, `newValue`, `row`, `col` are preserved |

### 4.2 Performance

| ID | Test | What it verifies |
|----|------|-----------------|
| E2E-SD-4 | `diffFilings completes in under 1000ms for real Apple 10-K pair` | `performance.now()` delta < 1000ms for full diff including table integration. Rationale: table matching + grid normalization + cell-by-cell diffing adds overhead; 1000ms leaves CI headroom while catching quadratic regressions. Tighten after calibration. |

### 4.3 Source mapping overlay support

| ID | Test | What it verifies |
|----|------|-----------------|
| E2E-SD-5 | `section source mappings enable HTML slice extraction` | `oldDoc.filing.html.slice(sourceMapping.old.start, sourceMapping.old.end)` contains expected section heading text |
| E2E-SD-6 | `paragraph source mappings are nested within section source ranges` | For each sectionDiff, all paragraphDiff sourceMapping offsets fall within the section's source range |

---

## 5. Acceptance Tests (Property-Based)

**File:** `tests/acceptance/structured-diff.acceptance.test.ts` (new)

These follow the pattern established in `table-differ.acceptance.test.ts` and `paragraph-differ.acceptance.test.ts`: generate random inputs and verify structural invariants.

### 5.1 Structural invariants

| ID | Test | Invariant |
|----|------|-----------|
| A-SD-1 | `summary total equals sectionDiffs count` | `added + removed + modified + unchanged + reordered === sectionDiffs.length` for any input |
| A-SD-2 | `every old section appears in matched or removed` | No old sections lost |
| A-SD-3 | `every new section appears in matched or added` | No new sections lost |
| A-SD-4 | `paragraphDiffs are populated for matched sections` | Matched sections (modified/unchanged/reordered) have `paragraphDiffs` array (possibly empty) |
| A-SD-5 | `tableDiffs are populated for matched sections` | Matched sections have `tableDiffs` array (possibly empty) |
| A-SD-6 | `added sections have paragraphDiffs === [] (empty array, not undefined) and tableDiffs entries all have changeType 'added'` | `paragraphDiffs` is `[]`; each `tableDiff.changeType === 'added'`; each `tableDiff.rowDiffs === []` and `tableDiff.cellDiffs === []` |
| A-SD-7 | `removed sections have paragraphDiffs === [] (empty array, not undefined) and tableDiffs entries all have changeType 'removed'` | `paragraphDiffs` is `[]`; each `tableDiff.changeType === 'removed'`; each `tableDiff.rowDiffs === []` and `tableDiff.cellDiffs === []` |
| A-SD-8 | `sourceMapping validity: old offsets are non-negative and ordered` | `sourceMapping.old.start < sourceMapping.old.end` where defined |
| A-SD-9 | `sourceMapping validity: new offsets are non-negative and ordered` | `sourceMapping.new.start < sourceMapping.new.end` where defined |
| A-SD-10 | `diffFilings never throws for any valid input` | No exceptions on well-formed input |

---

## 6. Boundary Conditions

Included within unit tests:

| ID | Test | Scenario |
|----|------|----------|
| U-BC-1 | `empty oldDoc and empty newDoc produce empty sectionDiffs and all-zero summary` | Both documents have 0 sections |
| U-BC-2 | `single section in both, identical content, 0 tables` | Minimal matching case |
| U-BC-3 | `section with many tables (10+) produces correct tableDiffs count` | Stress: many tables in one section |
| U-BC-4 | `section with empty table rows` | Table with 0-row table block |
| U-BC-5 | `section with single empty paragraph` | Degenerate content |
| U-BC-6 | `many sections (20+) produce correct summary` | Stress: many sections |

---

## 7. Error Conditions

| ID | Test | Scenario |
|----|------|----------|
| U-EC-1 | `diffFilings handles documents with parseWarnings gracefully` | Documents with non-empty `parseWarnings` still produce valid diff |
| U-EC-2 | `diffFilings handles sections with no blocks` | Sections that have `blocks: []` produce empty content diffs |

---

## 8. Test Data and Fixtures

### Existing helpers (reuse)

| Helper | File | Purpose |
|--------|------|---------|
| `makeDocumentPair()` | `tests/helpers/diff-helpers.ts` | Create old/new StructuredDocument pairs from section specs |
| `makeFilingSection()` | `tests/helpers/diff-helpers.ts` | Create a FilingSection with optional blocks and source |
| `makeParagraph()` | `tests/helpers/diff-helpers.ts` | Create a Paragraph content block |
| `makeTable()` | `tests/helpers/diff-helpers.ts` | Create a Table content block |
| `makeStructuredDocument()` | `tests/helpers/diff-helpers.ts` | Create a StructuredDocument from sections |
| `makeParagraph()` | `tests/helpers/diff-fixtures.ts` | Create a Paragraph with computed source offsets |
| `makeTable()` | `tests/helpers/diff-fixtures.ts` | Create a Table with computed source offsets |
| `makeSection()` | `tests/helpers/diff-fixtures.ts` | Create a FilingSection from content blocks |
| `makeStructuredDoc()` | `tests/helpers/diff-fixtures.ts` | Create a StructuredDocument with auto-sized HTML |
| `makeRawFiling()` | `tests/helpers/ground-truth.ts` | Create a RawFiling from HTML string with metadata overrides |
| `loadFixture()` | `tests/helpers/ground-truth.ts` | Load real filing HTML by ticker/year |
| `generateParagraphPair()` | `tests/acceptance/diff-test-generator.ts` | Random paragraph pair generation for property tests |
| `generateSectionPair()` | `tests/acceptance/diff-test-generator.ts` | Random section pair generation for property tests |
| `generateTablePair()` | `tests/acceptance/table-diff-generator.ts` | Random table pair generation for property tests |

### New helpers needed

| Helper | File | Purpose |
|--------|------|---------|
| `makeDocumentPairWithTables()` | `tests/helpers/diff-helpers.ts` | Variant of `makeDocumentPair` that accepts `tables?: string[][][]` per section and includes Table blocks alongside paragraphs |

### Real filing fixtures

| Fixture pair | Source |
|-------------|--------|
| Apple FY2023 vs FY2024 | `spikes/diff-algorithm/fixtures/apple-fy2023.htm` + `apple-fy2024.htm` |
| MSFT 2023 vs 2024 | `tests/integration/fixtures/10k-msft-2023.html` + `10k-msft-2024.html` |

---

## 9. Test Count Summary

| Tier | New Tests | Existing (covered) | Total |
|------|----------|-------------------|-------|
| Unit — StructuredDiff shape & metadata | 1 new (U-SD-4) | 3 existing (U-DF-1/2/3) | 4 |
| Unit — Sections with tables | 7 (U-ST-1 through U-ST-7) | 0 | 7 |
| Unit — Summary counts | 2 new (U-SM-2, U-SM-3/4) | 1 existing (U-DF-5) | 4 |
| Unit — SectionDiff structure | 4 (U-SS-1 through U-SS-4) | 0 | 4 |
| Unit — Serialization | 9 (U-SZ-1 through U-SZ-9) | 0 | 9 |
| Unit — Boundary conditions | 6 (U-BC-1 through U-BC-6) | 0 | 6 |
| Unit — Error conditions | 2 (U-EC-1, U-EC-2) | 0 | 2 |
| Integration | 6 (I-SD-1 through I-SD-6) | 0 | 6 |
| E2E | 6 (E2E-SD-1 through E2E-SD-6) | 5 existing (E2E-1 through E2E-5) | 11 |
| Acceptance (property-based) | 10 (A-SD-1 through A-SD-10) | 0 | 10 |
| **TOTAL** | **53 new** | **9 existing** | **63** |

---

## 10. Implementation Notes

### Key current gap: `tableDiffs` is always `[]`

In `diff-engine.ts:51`, `makeSectionDiff()` hardcodes `tableDiffs: []`. Per the implementation design, the fix is:
1. Add `extractTables()` helper to filter `ContentBlock[]` for tables
2. For matched sections: call `diffTables(extractTables(old.blocks), extractTables(new.blocks))`
3. For added sections: produce `TableDiff[]` with `changeType: 'added'`, empty `rowDiffs`/`cellDiffs`
4. For removed sections: produce `TableDiff[]` with `changeType: 'removed'`, empty `rowDiffs`/`cellDiffs`

### Serialization module

New `diff/serialization.ts` with `structuredDiffToJSON()` — converts `Temporal.Instant`/`Temporal.PlainDate` to ISO strings, omits `RawFiling.html`. Tested in `tests/unit/diff/serialization.test.ts`.

### Design decisions aligned with coder

- **Q4 — html omitted from JSON**: Agreed. Multi-MB HTML is not useful for JSON transmission. Tests verify `html` is absent from `RawFilingJSON`.
- **Q5 — empty rowDiffs for added/removed section tables**: Agreed. Consistent with existing `diffTables()` behavior. Tests U-ST-4 and U-ST-5 verify empty `rowDiffs`/`cellDiffs` with `changeType` set at table level.
- **subsectionDiffs deferred**: Parser produces `subsections: []`, so `subsectionDiffs: []` stays hardcoded. Not tested beyond shape verification.

### Test execution

```bash
# Run all tests
pnpm nx run edgar-diff-lib:test

# Run only US-1.8 tests (filter by file pattern)
pnpm nx run edgar-diff-lib:test -- --reporter=verbose tests/unit/diff/diff-engine.test.ts
pnpm nx run edgar-diff-lib:test -- --reporter=verbose tests/integration/diff/structured-diff.integration.test.ts
pnpm nx run edgar-diff-lib:test -- --reporter=verbose tests/e2e/diff/diff-pipeline.e2e.test.ts
pnpm nx run edgar-diff-lib:test -- --reporter=verbose tests/acceptance/structured-diff.acceptance.test.ts
```

### Test conventions (from existing codebase)

- Import vitest explicitly: `import { describe, it, expect } from 'vitest'`
- Use `assertDefined()` from `tests/helpers/assert-defined.ts` for narrowing
- Test IDs follow pattern: `{tier prefix}-{area}-{number}` (e.g., U-ST-1, I-SD-1, E2E-SD-1, A-SD-1)
- Property-based tests use env var for iteration count (e.g., `DIFF_TEST_COUNT`)
- Fixtures use `.js` extensions in imports (ESM)
