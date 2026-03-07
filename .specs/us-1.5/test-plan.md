# Test Plan: US-1.5 Section-Level Diff

## Overview

This test plan covers the section-level diff engine that aligns sections across two parsed filings (`StructuredDocument` instances) by heading text similarity. The engine identifies added, removed, modified, unchanged, and reordered sections.

**Modules under test:**
- `src/diff/section-aligner.ts` — Jaro-Winkler greedy section matching
- `src/diff/diff-engine.ts` — Orchestrator (`diffFilings`)
- `src/diff/types.ts` — Diff types (`SectionDiff`, `StructuredDiff`, `ChangeType`, `DiffRange`)

**Dependencies:**
- `src/types.ts` — `FilingSection`, `StructuredDocument`, `SourceLocation`
- `src/parser/index.ts` — `normalizeHeading()` (re-exported from parser barrel)

---

## 1. BDD Acceptance Criteria (Given/When/Then)

### AC-1: Identical section headings produce matched sections
**Given** two filings with identical section headings (Item 1, Item 1A, Item 7, etc.)
**When** `diffFilings(oldDoc, newDoc)` is called
**Then** all sections are classified as either "unchanged" or "modified" (none are "added" or "removed")
**And** `summary.added === 0` and `summary.removed === 0`

### AC-2: Renamed section is matched, not added+removed
**Given** an old filing with "Item 1A. Risk Factors" and a new filing with "Item 1A. Risk Factors and Uncertainties"
**When** diffed
**Then** the sections are matched as a single pair with `changeType: "modified"`
**And** `summary.added === 0` and `summary.removed === 0`

### AC-3: Reordered sections are identified
**Given** an old filing with sections [Item 1, Item 1A, Item 2] and a new filing with sections [Item 2, Item 1, Item 1A] (same content, different order)
**When** diffed
**Then** reordered sections have `changeType: "reordered"`
**And** the alignment correctly matches Item 1 to Item 1, Item 1A to Item 1A, Item 2 to Item 2

### AC-3b: Reordered sections with content changes are "modified"
**Given** an old filing with sections [Item 1, Item 2] and a new filing with sections [Item 2, Item 1] where Item 1 also has different content
**When** diffed
**Then** Item 1 has `changeType: "modified"` (content change takes precedence over reorder)
**And** Item 2 has `changeType: "reordered"` (position changed, content unchanged)

### AC-4: New section appears as "added"
**Given** an old filing without Item 1C and a new filing with Item 1C (Cybersecurity)
**When** diffed
**Then** Item 1C appears in `sectionDiffs` with `changeType: "added"`
**And** `oldSection` is undefined, `newSection` is populated
**And** `summary.added >= 1`

### AC-5: Removed section appears as "removed"
**Given** an old filing with Item 1C and a new filing without Item 1C
**When** diffed
**Then** Item 1C appears in `sectionDiffs` with `changeType: "removed"`
**And** `newSection` is undefined, `oldSection` is populated
**And** `summary.removed >= 1`

### AC-6: Identical filings produce all "unchanged"
**Given** two identical `StructuredDocument` instances (same sections, same content)
**When** diffed
**Then** all `sectionDiffs` have `changeType: "unchanged"`
**And** `summary.unchanged === sections.length`
**And** `summary.modified === 0`, `summary.added === 0`, `summary.removed === 0`

### AC-7: Same headings, different content produces "modified"
**Given** two filings with the same section headings but different paragraph content
**When** diffed
**Then** changed sections have `changeType: "modified"`
**And** `summary.modified > 0`

---

## 2. Unit Tests (`tests/unit/diff/`)

### 2.1 `section-aligner.test.ts`

#### `jaroWinklerSimilarity` wrapper
- U-JW-1: Returns 1.0 for identical strings
- U-JW-2: Returns > 0.9 for close matches ("risk factors" vs "risk factor")
- U-JW-3: Returns < 0.6 for unrelated strings ("risk factors" vs "financial statements")
- U-JW-4: Returns 0 for empty strings (per jaro-winkler library behavior)
- U-JW-5: Is symmetric (`sim(a,b) === sim(b,a)`)
- U-JW-6: Handles single-character strings

#### `normalizeHeading` (verify accessible from parser barrel)
- U-NH-1: Verify `normalizeHeading` can be imported from `parser/index.ts` barrel by diff code
- U-NH-2: Confirm normalization is applied before similarity comparison in `alignSections`

#### `alignSections` — greedy matching algorithm
- U-AS-1: Empty old + empty new => no matches, no added, no removed
- U-AS-2: Empty old + N new => 0 matched, N added
- U-AS-3: N old + empty new => 0 matched, N removed
- U-AS-4: Identical headings => N matched, 0 added, 0 removed
- U-AS-5: One section added in new => (N-1) matched, 1 added
- U-AS-6: One section removed from old => (N-1) matched, 1 removed
- U-AS-7: Renamed heading (above threshold 0.75) => matched, not add+remove
- U-AS-8: Completely different headings (below threshold) => all added + all removed
- U-AS-9: Greedy matching is stable — matched pairs have highest similarity per old section
- U-AS-10: Sections with duplicate headings — each matched at most once
- U-AS-11: Threshold boundary — similarity exactly at 0.75 is matched; 0.749 is not

#### `classifySectionDiff` — modified vs unchanged vs reordered
- U-CS-1: Same heading, same content blocks, same position => "unchanged"
- U-CS-2: Same heading, different content blocks, same position => "modified"
- U-CS-3: Section moved to different relative position, same content => "reordered"
- U-CS-4: Section moved to different relative position, different content => "modified" (content change takes precedence over reorder)
- U-CS-5: Added section (no old) => "added"
- U-CS-6: Removed section (no new) => "removed"

#### `serializeSectionContent` — content comparison helper
- U-SC-1: Empty blocks array => empty string
- U-SC-2: Paragraph blocks => concatenated text joined by newline
- U-SC-3: Table blocks => concatenated cell texts, row by row
- U-SC-4: Mixed paragraph and table blocks => both serialized in order
- U-SC-5: Two sections with same text content => identical serialization

#### `buildSummary` — summary count computation
- U-BS-1: All unchanged => `{ added: 0, removed: 0, modified: 0, unchanged: N, reordered: 0 }`
- U-BS-2: Mixed changes => counts match number of each changeType in sectionDiffs
- U-BS-3: Empty sectionDiffs => all zeros
- U-BS-4: Only added => `added: N`, all others 0
- U-BS-5: Only removed => `removed: N`, all others 0

### 2.2 `diff-engine.test.ts`

#### `diffFilings` orchestrator
- U-DF-1: Returns valid `StructuredDiff` shape (all required fields present)
- U-DF-2: `oldFiling` and `newFiling` reference the input documents' filings
- U-DF-3: `generatedAt` is a valid `Temporal.Instant`
- U-DF-4: `sectionDiffs` length equals total unique sections across both documents
- U-DF-5: `summary` counts match actual sectionDiffs changeTypes

#### SectionDiff ordering
- U-DF-6: Matched sections appear in new-filing order
- U-DF-7: Added sections appear in new-filing order, interleaved with matched sections
- U-DF-8: Removed sections are grouped at end, in old-filing order
- U-DF-9: Mixed scenario: [matched, added, matched, removed] produces correct ordering

### 2.3 `types.test.ts` (optional — type-level assertions)
- U-T-1: `ChangeType` is a union of exactly 5 values
- U-T-2: `SectionDiff` requires `id`, `heading`, `changeType`, `sourceMapping`
- U-T-3: `DiffRange` allows optional `old` and `new` SourceLocations

---

## 3. Integration Tests (`tests/integration/diff/`)

### 3.1 Real filing alignment
- I-1: Parse two Apple 10-K filings (FY2023, FY2024), run `diffFilings`, verify all standard items are matched
- I-2: Verify matched pairs have identical item numbers (Item 1 matches Item 1, etc.)
- I-3: Verify at least 90% match rate (consistent with spike findings of 100%)
- I-4: Parse Apple + Microsoft filings, verify new Item 1C (Cybersecurity) detected as "added" (Microsoft FY2024 has it, FY2023 does not — per spike findings)

### 3.2 Structural differences
- I-5: Parse filings with different section counts, verify correct added/removed detection
- I-6: Verify `summary` counts are consistent with `sectionDiffs` array

### 3.3 Source mapping validation
- I-7: For all matched sections, verify `sourceMapping.old` and `sourceMapping.new` have valid offsets
- I-8: Verify source offsets reference valid ranges within original HTML (`start >= 0`, `end <= html.length`, `start < end`)

### 3.4 Fixtures
Use existing integration fixtures in `tests/integration/fixtures/`. If Apple/Microsoft FY2023-2024 fixtures aren't available there, reference the spike fixtures at `spikes/diff-algorithm/fixtures/`.

---

## 4. E2E Tests (`tests/e2e/diff/`)

### 4.1 Full pipeline: `parseFiling` -> `diffFilings`
- E2E-1: Parse two raw filings with `parseFiling`, pass results to `diffFilings`, verify complete `StructuredDiff` output
- E2E-2: Verify the `StructuredDiff` output is JSON-serializable (`JSON.stringify` does not throw). Note: `Temporal.Instant` requires custom serialization — verify it serializes to ISO string.
- E2E-3: Verify `DiffRange` source mappings reference valid offsets in original HTML strings

### 4.2 Pipeline invariants
- E2E-4: Diffing a document against itself produces all "unchanged" sections
- E2E-5: Diffing produces deterministic output (same inputs always yield same sectionDiffs)

---

## 5. Boundary Conditions

| ID | Condition | Expected |
|----|-----------|----------|
| BC-1 | Empty StructuredDocument (0 sections) diffed with empty | 0 sectionDiffs, all summary counts 0 |
| BC-2 | Single-section document diffed with single-section (same heading) | 1 sectionDiff, "unchanged" or "modified" |
| BC-3 | Old has 0 sections, new has N sections | N "added" sectionDiffs |
| BC-4 | Old has N sections, new has 0 sections | N "removed" sectionDiffs |
| BC-5 | All sections modified (same headings, all content changed) | N "modified", 0 "unchanged" |
| BC-6 | Large number of sections (100+) | Completes without timeout, correct alignment |
| BC-7 | Sections with identical headings but different content | Matched and classified as "modified" |
| BC-8 | Sections with very similar headings (similarity near 0.75 threshold) | Correctly classified as matched or unmatched based on threshold |
| BC-9 | Document where all sections are reordered (reverse order) | All sections matched with "reordered" changeType |
| BC-10 | Sections with identical headings AND identical content | "unchanged" changeType |
| BC-11 | Documents with same sections but different subsections arrays (future-proofing) | Subsection differences do not affect section-level changeType (subsections: [] currently) |
| BC-12 | Performance: 100+ sections in each document | Alignment completes in < 500ms (greedy O(n*m) does not degrade) |

---

## 6. Error Conditions

| ID | Condition | Expected |
|----|-----------|----------|
| EC-1 | Malformed FilingSection (missing `id` or `heading`) | Graceful handling — skip or treat as unmatched |
| EC-2 | Empty heading strings | Sections with empty headings are not matched (similarity = 0) |
| EC-3 | Null/undefined StructuredDocument input | TypeScript prevents at compile time; runtime should throw or return empty diff |
| EC-4 | Section with `source.start > source.end` (invalid) | DiffRange propagates as-is (garbage in, garbage out — parser's responsibility) |
| EC-5 | FilingSection with empty `blocks` array | Treated as "unchanged" if headings match (no content to diff at section level) |

---

## 7. Test Data and Helpers

### Helper functions (in `tests/helpers/diff-helpers.ts`)

```typescript
/** Create a minimal StructuredDocument for testing */
function makeStructuredDocument(
  sections: FilingSection[],
  overrides?: Partial<StructuredDocument>,
): StructuredDocument

/** Create a minimal FilingSection for testing */
function makeFilingSection(
  id: string,
  heading: string,
  options?: {
    blocks?: ContentBlock[];
    source?: SourceLocation;
    level?: number;
    subsections?: FilingSection[];
  },
): FilingSection

/** Create a pair of documents with specified section configurations */
function makeDocumentPair(
  oldSections: Array<{ id: string; heading: string; content?: string }>,
  newSections: Array<{ id: string; heading: string; content?: string }>,
): { oldDoc: StructuredDocument; newDoc: StructuredDocument }
```

### Inline HTML fixtures (unit tests)
- Small HTML snippets (< 30 lines) directly in test files
- Cover 2-3 section documents with varied heading styles

### Integration fixtures
- Reference existing fixtures in `tests/integration/fixtures/`
- If needed, reference spike fixtures at `spikes/diff-algorithm/fixtures/` for Apple/Microsoft filing pairs

---

## 8. Test File Structure

```
tests/
  unit/
    diff/
      section-aligner.test.ts    # U-JW-*, U-AS-*, U-CS-*, U-BS-*
      diff-engine.test.ts        # U-DF-*
  integration/
    diff/
      section-alignment.integration.test.ts  # I-*
  e2e/
    diff/
      diff-pipeline.e2e.test.ts  # E2E-*
  acceptance/
    diff/
      section-diff.acceptance.test.ts  # AC-* (property-based BDD)
  helpers/
    diff-helpers.ts              # makeStructuredDocument, makeFilingSection, makeDocumentPair
```

---

## 9. Coverage Goals

- **Unit tests**: 100% branch coverage for `alignSections`, `classifySectionDiff`, `buildSummary`
- **Integration tests**: Validate against at least 2 real filing pairs
- **Acceptance tests**: All 8 BDD scenarios (AC-1 through AC-7, including AC-3b) pass with property-based generation
- **Performance**: Section alignment completes in < 100ms for typical filing pairs (per spike: ~2ms)
