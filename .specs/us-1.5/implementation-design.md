---
title: "US-1.5: Section-Level Diff — Implementation Design"
story: edgar-diff-vda.6
created: "2026-03-07"
status: final
---

# US-1.5: Compute Section-Level Diff — Implementation Design

## 1. Approach

Implement section-level diffing between two `StructuredDocument` instances by aligning sections using Jaro-Winkler similarity on normalized headings, then classifying each section as added, removed, modified, unchanged, or reordered.

**Strategy**: Two-phase alignment validated in Spike B:
1. **Section alignment** — Greedy best-match on Jaro-Winkler similarity of normalized headings (threshold 0.75). Spike B achieved 100% alignment accuracy on Apple and Microsoft consecutive 10-K pairs.
2. **Classification** — Matched sections are classified by comparing content; unmatched sections are added/removed. Reorder detection compares position indices.

**Rationale**: Standard line-diff algorithms (Myers, patience) treat the document as a flat token stream and would misalign sections that changed position. Heading-based alignment leverages the standardized structure of SEC filings (Item 1, Item 1A, etc.) for semantically correct matching.

## 2. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `src/diff/types.ts` | Diff-specific types: ChangeType, DiffRange, SectionDiff, StructuredDiff, ParagraphDiff, TableDiff |
| `src/diff/section-aligner.ts` | Production section alignment using Jaro-Winkler similarity |
| `src/diff/diff-engine.ts` | Orchestrator: `diffFilings(oldDoc, newDoc) -> StructuredDiff` |
| `src/diff/index.ts` | Barrel exports for diff module |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Add `diffFilings` export and diff types |
| `src/parser/section-extractor.ts` | No changes needed — `normalizeHeading` is already exported |

**Note on `normalizeHeading`**: The function is already exported from `src/parser/section-extractor.ts`. The diff module will import it directly. Per module boundary rules (`diff/` imports only from parser types), we have two options:
- **Option A**: Re-export `normalizeHeading` from `src/parser/index.ts` so diff imports from the parser barrel. **(Preferred — respects module boundaries)**
- **Option B**: Move `normalizeHeading` to `src/types.ts` as a shared utility.

We choose **Option A** — re-export from `src/parser/index.ts` and import in diff as `import { normalizeHeading } from '../parser/index.js'`.

## 3. Interfaces and Types

All types are defined per the architecture doc (section 5). The exact TypeScript definitions:

```typescript
// src/diff/types.ts

import type {
  SourceLocation,
  FilingSection,
  Paragraph,
  Table,
  StructuredDocument,
} from '../types.js';
import type { RawFiling } from '../client/types.js';

/** Classification of a diff element. */
export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged' | 'reordered';

/** Source locations in the old and/or new filing. */
export interface DiffRange {
  old?: SourceLocation;
  new?: SourceLocation;
}

/** Diff result for a single paragraph (placeholder for US-1.6). */
export interface ParagraphDiff {
  changeType: ChangeType;
  oldParagraph?: Paragraph;
  newParagraph?: Paragraph;
  sentenceDiffs?: Array<{ type: 'equal' | 'insert' | 'delete'; value: string }>;
  sourceMapping: DiffRange;
}

/** Diff result for a single table (placeholder for US-1.7). */
export interface TableDiff {
  changeType: ChangeType;
  oldTable?: Table;
  newTable?: Table;
  cellDiffs?: Array<{
    row: number;
    col: number;
    changeType: Exclude<ChangeType, 'reordered'>;
    oldValue?: string;
    newValue?: string;
    sourceMapping: DiffRange;
  }>;
  sourceMapping: DiffRange;
}

/** Diff result for a single section. */
export interface SectionDiff {
  id: string;
  heading: string;
  changeType: ChangeType;
  oldSection?: FilingSection;
  newSection?: FilingSection;
  paragraphDiffs: ParagraphDiff[];
  tableDiffs: TableDiff[];
  subsectionDiffs: SectionDiff[];
  sourceMapping: DiffRange;
}

/** Top-level diff result. */
export interface StructuredDiff {
  oldFiling: RawFiling;
  newFiling: RawFiling;
  sectionDiffs: SectionDiff[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    reordered: number;
  };
  generatedAt: Temporal.Instant;
}

/** Options for section alignment. */
export interface AlignmentOptions {
  /** Minimum Jaro-Winkler similarity to consider a match. Default: 0.75. */
  threshold?: number;
}

/** Options for diffFilings. */
export interface DiffOptions extends AlignmentOptions {}
```

### Internal Types (section-aligner.ts)

```typescript
/** A matched pair of sections with similarity score. */
interface SectionMatch {
  oldIndex: number;
  newIndex: number;
  oldSection: FilingSection;
  newSection: FilingSection;
  similarity: number;
}

/** Result of the alignment phase. */
interface AlignmentResult {
  matched: SectionMatch[];
  added: FilingSection[];
  removed: FilingSection[];
}
```

## 4. Data Flow

`diffFilings(oldDoc, newDoc, options?) -> StructuredDiff`:

```
                  oldDoc.sections ──┐
                                    ├──> [1] Normalize headings
                  newDoc.sections ──┘         │
                                              v
                                    [2] Compute similarity matrix
                                         (Jaro-Winkler on normalized headings)
                                              │
                                              v
                                    [3] Greedy match (highest similarity first)
                                         threshold >= 0.75
                                              │
                                              v
                                    [4] Classify sections
                                         ├── matched → compare content first
                                         │     ├── content differs → 'modified'
                                         │     └── content equal → check position
                                         │           ├── position changed → 'reordered'
                                         │           └── position same → 'unchanged'
                                         ├── unmatched old → 'removed'
                                         └── unmatched new → 'added'
                                              │
                                              v
                                    [5] Build SectionDiff[]
                                         ├── paragraphDiffs: [] (US-1.6)
                                         ├── tableDiffs: [] (US-1.7)
                                         └── subsectionDiffs: [] (future)
                                              │
                                              v
                                    [6] Compute summary counts
                                              │
                                              v
                                    [7] Return StructuredDiff
```

### Step Details

**Step 1: Normalize headings**
- Use `normalizeHeading()` from `parser/section-extractor.ts` on each section's `heading` field.
- This lowercases, collapses whitespace, strips edge punctuation.

**Step 2: Compute similarity matrix**
- For each `(oldSection, newSection)` pair, compute `jaroWinkler(normalizedOld, normalizedNew)`.
- Store only pairs where similarity >= threshold (skip obvious non-matches early).

**Step 3: Greedy match**
- Sort candidate pairs by similarity descending.
- Iterate: if neither old nor new section is already used, record the match.
- This is the same algorithm validated in the spike.

**Step 4: Classify sections**
- **Reorder detection**: For each matched pair, compare the old section's index in `oldDoc.sections` with the new section's index in `newDoc.sections`. If the relative ordering changes (i.e., there exists another matched pair where the order is inverted), mark as `'reordered'`.
  - Implementation: after matching, check if the sequence of new indices (ordered by old index) is strictly increasing. Any pair that breaks monotonicity is reordered.
- **Modified vs unchanged**: Compare content blocks of matched sections. Use a serialization-based comparison:
  - Serialize each section's `blocks` array to a canonical string (JSON.stringify of text content).
  - If serialized content is identical → `'unchanged'`, otherwise → `'modified'`.
  - This is simple and correct. Hash-based comparison (e.g., SHA-256) is an optimization we don't need yet.
- **Reordered + modified**: A section can be both reordered and have different content. We use `'modified'` as the changeType when content differs (content change takes precedence). `'reordered'` is only used when a section moved position but content is unchanged. Rationale: content changes are more actionable for consumers; positional changes are secondary. This also simplifies testing — reorder detection and content comparison are independent concerns.

**Step 5: Build SectionDiff[]**
- For matched sections: populate both `oldSection` and `newSection`, set `sourceMapping` with both old and new locations.
- For added sections: only `newSection`, `sourceMapping.new` only.
- For removed sections: only `oldSection`, `sourceMapping.old` only.
- `paragraphDiffs`, `tableDiffs`, `subsectionDiffs`: empty arrays (US-1.6, US-1.7, future).
- Order SectionDiffs by: matched sections in new document order, then added sections in new document order, then removed sections in old document order. (This gives a natural reading order.)

**Step 6: Compute summary**
- Count each changeType across all `sectionDiffs`.

**Step 7: Return StructuredDiff**
- Set `generatedAt` to `Temporal.Now.instant()`.

## 5. Key Design Decisions

### 5.1 Threshold: Configurable, default 0.75
Per spike findings, 0.75 provides tolerance for minor heading variations while avoiding false positives. The threshold is exposed via `DiffOptions` for callers who need different sensitivity.

### 5.2 Reorder Detection
Reorder detection only applies to matched sections whose content is unchanged (see 5.3). `'modified'` takes precedence over `'reordered'`.

A section is "reordered" if its position relative to other matched sections changed between old and new. Two matched pairs `(o1, n1)` and `(o2, n2)` are in consistent order if `(o1 < o2) === (n1 < n2)`. Any pair that violates this with any other pair is reordered.

This is exposed as a named function `isReordered(matchedPairs, targetPair)` for testability.

### 5.3 Modified vs Unchanged: Content Comparison
Exposed as a named function `serializeSectionContent(section: FilingSection): string` for testability.

Serialization extracts text from each `ContentBlock`:
- `Paragraph` → `block.text`
- `Table` → concatenation of all cell texts, row by row

Join all block texts with `\n` and compare the resulting strings. This ignores formatting-only changes (which is appropriate for section-level classification — formatting changes will surface in paragraph/table diffs).

Edge cases:
- Empty `blocks` array → empty string (two empty sections compare as equal → `'unchanged'`)
- Section with only tables → table cell text is compared
- Section with mixed content types → paragraphs and tables are serialized in order

Classification is exposed as `classifySectionDiff(match, allMatches): ChangeType` which calls `serializeSectionContent` internally and checks reorder via `isReordered`.

### 5.4 paragraphDiffs and tableDiffs: Empty Arrays
These fields are left as empty arrays `[]` for this story. US-1.6 will populate `paragraphDiffs`, US-1.7 will populate `tableDiffs`. The types are defined now so the interface is stable.

### 5.5 subsectionDiffs: Empty Arrays (Designed for Future)
The `FilingSection` type has a `subsections: FilingSection[]` field, but the parser currently produces `subsections: []` (only level-1 sections). The `subsectionDiffs` field is included in `SectionDiff` for forward compatibility. When the parser adds subsection detection, the aligner can recurse: for each matched section pair, align their subsections using the same algorithm.

### 5.6 normalizeHeading Reuse
Import `normalizeHeading` from `../parser/index.js` (after adding it to the parser barrel export). This avoids duplicating normalization logic and ensures consistency between parsing and diffing.

### 5.7 SectionDiff Ordering
SectionDiffs in the output are ordered to provide a natural reading experience:
1. Sections present in the new filing (matched + added), in new-filing order
2. Removed sections appended at the end, in old-filing order

This means a consumer reading `sectionDiffs` in order sees the new filing's structure with removed sections noted at the end.

### 5.8 SectionDiff.id and .heading
- For matched sections: use the new section's `id` and `heading` (the current version).
- For added sections: use the new section's `id` and `heading`.
- For removed sections: use the old section's `id` and `heading`.

## 6. Module Structure

```
src/diff/
  ├── types.ts             # All diff types (exported)
  ├── section-aligner.ts   # alignSections, serializeSectionContent, isReordered, classifySectionDiff
  ├── diff-engine.ts       # diffFilings, buildSummary
  └── index.ts             # Barrel exports (see below)
```

### index.ts (barrel)

```typescript
// Public API
export { diffFilings } from './diff-engine.js';
export { buildSummary } from './diff-engine.js';

// Exported for testing / advanced consumers
export {
  alignSections,
  serializeSectionContent,
  isReordered,
  classifySectionDiff,
} from './section-aligner.js';
export type { SectionMatch, AlignmentResult } from './section-aligner.js';

// Types
export type {
  ChangeType, DiffRange, SectionDiff, StructuredDiff,
  ParagraphDiff, TableDiff, AlignmentOptions, DiffOptions,
} from './types.js';
```

### section-aligner.ts

```typescript
import jaroWinkler from 'jaro-winkler';
import type { FilingSection } from '../types.js';
import { normalizeHeading } from '../parser/index.js';
import type { AlignmentOptions } from './types.js';

const DEFAULT_THRESHOLD = 0.75;

export interface SectionMatch {
  oldIndex: number;
  newIndex: number;
  oldSection: FilingSection;
  newSection: FilingSection;
  similarity: number;
}

export interface AlignmentResult {
  matched: SectionMatch[];
  added: FilingSection[];
  removed: FilingSection[];
}

/** Align sections by normalized heading similarity. Exported for testing. */
export function alignSections(
  oldSections: FilingSection[],
  newSections: FilingSection[],
  options?: AlignmentOptions,
): AlignmentResult { ... }

/** Serialize a section's content blocks to a canonical string. Exported for testing. */
export function serializeSectionContent(section: FilingSection): string { ... }

/** Check if a matched pair is reordered relative to other matches. Exported for testing. */
export function isReordered(
  allMatches: SectionMatch[],
  target: SectionMatch,
): boolean { ... }

/** Classify a matched section pair. Exported for testing. */
export function classifySectionDiff(
  match: SectionMatch,
  allMatches: SectionMatch[],
): ChangeType { ... }
```

### diff-engine.ts

```typescript
import { Temporal } from '@js-temporal/polyfill';
import type { StructuredDocument } from '../types.js';
import type { StructuredDiff, SectionDiff, DiffOptions } from './types.js';
import { alignSections, classifySectionDiff } from './section-aligner.js';

/** Compute summary counts from sectionDiffs. Exported for testing. */
export function buildSummary(
  sectionDiffs: SectionDiff[],
): StructuredDiff['summary'] { ... }

export function diffFilings(
  oldDoc: StructuredDocument,
  newDoc: StructuredDocument,
  options?: DiffOptions,
): StructuredDiff { ... }
```

## 7. Edge Cases

| Case | Behavior |
|------|----------|
| **Empty sections** (both docs have 0 sections) | Return empty `sectionDiffs`, all summary counts 0 |
| **Identical documents** | All sections matched, all `'unchanged'`, no added/removed |
| **All sections renamed** (below threshold) | All old sections `'removed'`, all new sections `'added'` |
| **All sections added** (old doc empty) | All new sections `'added'` |
| **All sections removed** (new doc empty) | All old sections `'removed'` |
| **Single section in each doc** | One matched pair (or 1 added + 1 removed if below threshold) |
| **Duplicate headings** (two sections with same heading in one doc) | Greedy match assigns each to the best available partner; second occurrence may be unmatched |
| **Empty heading string** | `jaro-winkler` returns 0 for empty strings; will not match (correct) |

## 8. Resolved Questions

1. **Reordered + modified**: **`'modified'` takes precedence.** Content changes are more actionable for consumers. `'reordered'` is only used when content is unchanged but position changed. This simplifies testing — reorder and content checks are independent concerns.

2. **SectionDiff ordering**: **Removed sections grouped at end.** Interleaving is complex and ambiguous when multiple sections are removed. Can revisit if users find it confusing.

3. **Subsection matching**: **Follow-up issue to be created.** Parser produces `subsections: []`, so `subsectionDiffs: []` for this story. A follow-up issue will track parser subsection support and recursive diff matching.
