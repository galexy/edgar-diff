# US-1.6: Paragraph-Level Diffs Within Matched Sections — Implementation Design

## 1. Approach

Migrate the validated spike code (`spikes/diff-algorithm/`) into a production `src/diff/` module, adapting it to work with the real `StructuredDocument` and `ContentBlock` types. Key changes from spike:

- **Use real types**: Spike operates on plain `string[]` paragraphs. Production code operates on `ContentBlock[]` (which includes `Paragraph` and `Table`) with `SourceMapped` metadata.
- **Source mappings**: Every diff output type references `SourceLocation` from both old and new documents, enabling overlay/highlight rendering on original HTML.
- **Myers only**: Per spike findings, Myers (`diffArrays`) is recommended over Patience for paragraph-level diffing. Drop Patience implementation.
- **Word-level diffs**: Use `diffWords` for modified paragraphs (spike-validated). The issue mentions "sentence-level diffs" but word-level provides finer granularity and was validated in the spike. We use word-level.
- **Tables deferred**: `Table` blocks are passed through as opaque content blocks. US-1.7 handles table-level diffing. This module marks them as `tablePlaceholder` change types so the pipeline knows they need separate processing.

## 2. Files to Create/Modify

### New Files

#### `src/diff/types.ts` — Diff output types

All diff-specific types. Imports only from `../types.js` (shared types).

```typescript
import type { SourceLocation, Paragraph, Table, ContentBlock } from '../types.js';

/** A word-level change within a modified paragraph. */
export interface WordChange {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

/** A change to a single paragraph between old and new documents. */
export interface ParagraphChange {
  type: 'added' | 'removed' | 'modified' | 'unchanged' | 'moved';
  /** Source location in the old document. Present for removed, modified, unchanged, moved. */
  oldSource?: SourceLocation;
  /** Source location in the new document. Present for added, modified, unchanged, moved. */
  newSource?: SourceLocation;
  /** Normalized text from old document. */
  oldText?: string;
  /** Normalized text from new document. */
  newText?: string;
  /** Word-level diff breakdown. Present for 'modified' and 'moved' (when text also changed). */
  wordChanges?: WordChange[];
}

/**
 * Placeholder for a table block that needs separate diffing (US-1.7).
 * Preserves position in the block sequence so downstream can correlate.
 */
export interface TablePlaceholder {
  type: 'table';
  /** Source location of the table in old document (if present). */
  oldSource?: SourceLocation;
  /** Source location of the table in new document (if present). */
  newSource?: SourceLocation;
  /** The original old Table block, if present. */
  oldTable?: Table;
  /** The original new Table block, if present. */
  newTable?: Table;
}

/** Union of all block-level changes within a section. */
export type BlockChange = ParagraphChange | TablePlaceholder;

/** Diff result for a single matched section pair. */
export interface SectionDiff {
  /** Section ID (e.g., "item-1a"). From old section (or new if added). */
  sectionId: string;
  /** Heading from old document. Absent for added sections. */
  oldHeading?: string;
  /** Heading from new document. Absent for removed sections. */
  newHeading?: string;
  /** Source location of the section in old document. */
  oldSource?: SourceLocation;
  /** Source location of the section in new document. */
  newSource?: SourceLocation;
  /** Jaro-Winkler similarity score for matched sections. */
  similarity: number;
  /** Ordered list of block-level changes within this section. */
  changes: BlockChange[];
  stats: DiffStats;
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  /** Paragraphs detected as reordered (same or similar text, different position). */
  moved: number;
  /** Number of table blocks passed through (not diffed). */
  tables: number;
}

/** Top-level diff result for a filing pair. */
export interface FilingDiffResult {
  /** Diffs for matched section pairs. */
  sectionDiffs: SectionDiff[];
  /** Sections present only in the new document. */
  addedSections: SectionSummary[];
  /** Sections present only in the old document. */
  removedSections: SectionSummary[];
  totalStats: TotalDiffStats;
}

export interface SectionSummary {
  sectionId: string;
  heading: string;
  source: SourceLocation;
}

export interface TotalDiffStats {
  sectionsMatched: number;
  sectionsAdded: number;
  sectionsRemoved: number;
  totalAdded: number;
  totalRemoved: number;
  totalModified: number;
  totalUnchanged: number;
  totalMoved: number;
  totalTables: number;
}
```

#### `src/diff/section-aligner.ts` — Section alignment

Adapts the spike's section aligner to work with `FilingSection` instead of the spike's `Section` type.

```typescript
import jaroWinkler from 'jaro-winkler';
import type { FilingSection } from '../types.js';

export interface SectionMatch {
  oldSection: FilingSection;
  newSection: FilingSection;
  similarity: number;
}

export interface AlignmentResult {
  matched: SectionMatch[];
  added: FilingSection[];
  removed: FilingSection[];
}

export function alignSections(
  oldSections: FilingSection[],
  newSections: FilingSection[],
  threshold?: number,  // default 0.75
): AlignmentResult;
```

**Algorithm** (unchanged from spike):
1. Build similarity matrix: `jaroWinkler(oldSection.heading, newSection.heading)` for all pairs
2. Filter by threshold (default 0.75)
3. Greedy best-match: sort by descending similarity, pick each pair if neither index is used
4. Sort matched pairs by document order (old section source.start)
5. Unmatched old sections go to `removed`, unmatched new to `added`

**Key adaptation**: The spike normalizes headings via a custom `normalizedHeading` field. The production `FilingSection` has `heading` (raw text) and `id` (normalized like "item-1a"). We normalize headings inline before comparison: `heading.toLowerCase().replace(/\s+/g, ' ').trim()`.

#### `src/diff/paragraph-differ.ts` — Paragraph-level Myers diff

Core diffing logic. Adapted from spike to handle `ContentBlock[]` and produce source-mapped output.

```typescript
import type { FilingSection, ContentBlock, Paragraph } from '../types.js';
import type { SectionMatch } from './section-aligner.js';
import type { BlockChange, ParagraphChange, TablePlaceholder, WordChange, SectionDiff, DiffStats } from './types.js';

export function diffSections(matches: SectionMatch[]): SectionDiff[];
```

**Algorithm**:

1. For each matched section pair, extract `blocks: ContentBlock[]` from both old and new sections.

2. **Separate paragraphs from tables**: Walk both block arrays, extracting paragraphs into separate arrays while recording table positions. Strategy:
   - Extract all `Paragraph` blocks from old and new
   - Diff the paragraph arrays using Myers (`diffArrays` with normalized text as comparator)
   - Tables are emitted as `TablePlaceholder` entries in their original positions

3. **Paragraph diffing** (Myers via `diffArrays`):
   - Normalize text: `text.replace(/\s+/g, ' ').trim()` for comparison
   - `diffArrays(oldParagraphs, newParagraphs)` using normalized text as comparator
   - Process hunks:
     - Unchanged: emit `ParagraphChange` with `type: 'unchanged'`, both source locations
     - Added: emit with `type: 'added'`, only `newSource`
     - Removed: emit with `type: 'removed'`, only `oldSource`
     - Remove+Add pairs: emit `type: 'modified'` with both source locations and word-level diff

4. **Move detection** (post-processing pass to satisfy AC-3):
   After Myers processing, scan for matching remove+add pairs that represent reordered paragraphs:
   - Collect all `removed` and `added` entries from step 3
   - For each removed entry, find the best matching added entry by normalized text:
     - **Exact match** (normalized texts equal): reclassify both as `type: 'moved'`, populate both `oldSource` and `newSource`, no `wordChanges`
     - **High similarity** (Jaro-Winkler > 0.9 on normalized text): reclassify as `type: 'moved'`, populate both sources, compute `wordChanges` via `diffWords` to show what changed
   - Use greedy best-match (highest similarity first) to avoid conflicts
   - Remaining unmatched entries stay as `removed`/`added`
   - Complexity: O(R*A) where R=removed count, A=added count. For typical sections (tens of paragraphs) this is negligible.

5. **Word-level diff** for modified and moved-with-changes paragraphs:
   - `diffWords(oldText, newText)` from the `diff` package
   - Map each `Change` to a `WordChange { type, value }` — preserving the full structured data instead of the spike's compact string format
   - Applied to both `'modified'` paragraphs (from step 3) and `'moved'` paragraphs where text differs (from step 4)

6. **Interleave tables back**: After paragraph diffing, merge table placeholders back into the `changes` array in document order based on source positions.

#### `src/diff/index.ts` — Barrel + top-level entry point

```typescript
export { alignSections } from './section-aligner.js';
export type { SectionMatch, AlignmentResult } from './section-aligner.js';
export { diffSections } from './paragraph-differ.js';
export { diffFilings } from './diff-filings.js';
export type {
  WordChange,
  ParagraphChange,
  TablePlaceholder,
  BlockChange,
  SectionDiff,
  DiffStats,
  FilingDiffResult,
  SectionSummary,
  TotalDiffStats,
} from './types.js';
```

#### `src/diff/diff-filings.ts` — Top-level orchestrator

The public entry point that ties alignment and diffing together.

```typescript
import type { StructuredDocument } from '../types.js';
import type { FilingDiffResult } from './types.js';
import { alignSections } from './section-aligner.js';
import { diffSections } from './paragraph-differ.js';

export interface DiffOptions {
  /** Jaro-Winkler threshold for section matching. Default 0.75. */
  similarityThreshold?: number;
}

/**
 * Compute paragraph-level diffs between two structured filings.
 * Tables are passed through as placeholders for US-1.7.
 */
export function diffFilings(
  oldDoc: StructuredDocument,
  newDoc: StructuredDocument,
  options?: DiffOptions,
): FilingDiffResult;
```

**Implementation**:
1. Flatten sections: recursively collect all `FilingSection` nodes (including subsections) from both documents
2. `alignSections(oldSections, newSections, threshold)`
3. `diffSections(alignment.matched)` to get section diffs
4. Map `alignment.added` and `alignment.removed` to `SectionSummary[]`
5. Aggregate stats and return `FilingDiffResult`

### Modified Files

#### `src/index.ts` — Add diff re-exports

```typescript
// Add to existing exports:
export { diffFilings, alignSections, diffSections } from './diff/index.js';
export type {
  DiffOptions,
  FilingDiffResult,
  SectionDiff,
  ParagraphChange,
  WordChange,
  TablePlaceholder,
  BlockChange,
  DiffStats,
  SectionMatch,
  AlignmentResult,
  SectionSummary,
  TotalDiffStats,
} from './diff/index.js';
```

#### `src/types.ts` — No changes needed

The existing types (`SourceLocation`, `SourceMapped`, `Paragraph`, `Table`, `ContentBlock`, `FilingSection`, `StructuredDocument`) are sufficient. The diff module references them as-is.

## 3. Data Flow

```
StructuredDocument (old)  ─┐
                           ├─► alignSections() ─► AlignmentResult
StructuredDocument (new)  ─┘       │                    │
                                   │              ┌─────┴─────┐
                                   │              │           │
                                   │         matched[]   added[]/removed[]
                                   │              │           │
                                   │              ▼           │
                                   │      diffSections()     │
                                   │              │           │
                                   │    per section pair:     │
                                   │    ┌─────────┴─────────┐ │
                                   │    │                   │ │
                                   │  paragraphs         tables
                                   │    │                   │
                                   │  diffArrays()    TablePlaceholder
                                   │    │                   │
                                   │  detectMoves()         │
                                   │  (reclassify           │
                                   │   removed+added        │
                                   │   pairs as moved)      │
                                   │    │                   │
                                   │  per modified/moved:   │
                                   │  diffWords()          │
                                   │    │                   │
                                   │    └───────┬───────────┘
                                   │            │
                                   │      BlockChange[] (interleaved by source position)
                                   │            │
                                   └────────────┴──► FilingDiffResult
```

## 4. Handling ContentBlock[] (Paragraphs + Tables)

The `ContentBlock[]` in each section interleaves `Paragraph` and `Table` blocks. Strategy:

1. **Extract paragraphs only** for Myers diffing — tables are structurally different and require specialized comparison (US-1.7).
2. **Emit `TablePlaceholder`** for each table block, recording its source location and the original `Table` object from old/new.
3. **Pair tables by position**: Within a matched section, tables at similar positions are paired. Simple heuristic: walk old and new block arrays, when consecutive tables appear in both, pair them. Unpaired tables are marked as added/removed.
4. **Interleave in output**: The final `changes: BlockChange[]` preserves document order — paragraphs and table placeholders appear in the order they occur in the document.

This means consumers can iterate `changes` and render a complete section diff, delegating `TablePlaceholder` entries to the table differ (US-1.7) when available.

## 5. Design Decisions

### Word-level vs sentence-level diffs

**Decision: Word-level.** The issue mentions "sentence-level diffs" but the spike validated `diffWords` and it provides finer granularity. Sentence-level would require sentence boundary detection (non-trivial with abbreviations, legal citations, etc.) for minimal benefit. Word-level shows exactly what changed.

### Source mapping representation

**Decision: Reference by `SourceLocation`.** Each `ParagraphChange` and `TablePlaceholder` carries `oldSource?: SourceLocation` and `newSource?: SourceLocation` rather than embedding full `Paragraph`/`Table` objects. Rationale:
- Smaller output payload
- Consumers can slice the original HTML using `source.start`/`source.end` for rendering
- Full objects are available in the original `StructuredDocument` if needed

For `TablePlaceholder`, we also include `oldTable?`/`newTable?` references since US-1.7 will need the structured table data for diffing.

### Table handling

**Decision: Pass through as `TablePlaceholder`.** Tables are not diffed at paragraph level. They are preserved in position order with source mappings so that:
- US-1.7 can process them separately
- The block sequence is complete (no gaps in the change list)
- Consumers can render tables in their correct position even before US-1.7 is implemented

### Paragraph reordering (AC-3)

**Decision: Post-Myers move detection.** Myers diff treats reordered paragraphs as remove+add pairs. AC-3 requires detecting reordering without marking everything as changed. We add a post-processing pass that:
1. Collects all `removed` and `added` entries after Myers
2. Matches them by normalized text similarity (exact match or JW > 0.85)
3. Reclassifies matched pairs as `type: 'moved'`
4. For moved paragraphs with text changes, populates `wordChanges`

The `'moved'` type is a single type — a moved paragraph may or may not have `wordChanges`. If `wordChanges` is present, the paragraph was both relocated and edited. If absent, it was a pure positional move.

**Similarity threshold for moves: 0.9.** Intentionally strict — higher than the section alignment threshold (0.75) because paragraph-level false positives are more disruptive. Two unrelated paragraphs shouldn't be marked as "moved" just because they share some common words. At 0.9, only paragraphs with minor edits (e.g., year updates, small wording changes) are detected as moves.

### Algorithm choice

**Decision: Myers only.** Drop Patience diff. Spike showed <0.3% difference in results, and Myers is simpler, uses the battle-tested `diffArrays` from the `diff` package, and avoids maintaining a custom LIS-based implementation.

## 6. Edge Cases

| Case | Handling |
|---|---|
| Empty sections (no blocks) | Produce `SectionDiff` with empty `changes[]` and zero stats |
| Sections with only tables | All entries are `TablePlaceholder`, no paragraph changes |
| Identical documents | All paragraphs marked `unchanged`, similarity = 1.0 |
| One-sided sections (added) | Appear in `addedSections` summary; no block-level diff |
| One-sided sections (removed) | Appear in `removedSections` summary; no block-level diff |
| Paragraph reordering | Post-Myers pass detects matching remove+add pairs and reclassifies as `'moved'`. Exact text matches become pure moves; high-similarity matches (JW > 0.9) become moves with `wordChanges`. |
| Very large sections (900+ blocks) | Myers is O(ND) but the `diff` package is well-optimized. Spike showed <100ms even for Microsoft's largest sections. |
| Subsections | `diffFilings` flattens the section tree before alignment, so subsections are treated as top-level for matching purposes. Subsection nesting is preserved in the source locations. |

## 7. Dependencies

| Package | Version | Usage |
|---|---|---|
| `diff` | ^8.0.3 | `diffArrays` for paragraph-level, `diffWords` for word-level |
| `jaro-winkler` | ^0.2.8 | Section heading similarity |

Both already in `package.json`. No new dependencies needed.

## 8. Testing Strategy

- **Unit tests** (`tests/unit/`): Test each function in isolation with synthetic data
  - `section-aligner.test.ts`: alignment with known heading pairs, threshold behavior, empty inputs
  - `paragraph-differ.test.ts`: paragraph changes, word diffs, table placeholder generation, interleaving
  - `diff-filings.test.ts`: end-to-end with small synthetic `StructuredDocument` pairs
- **Integration tests** (`tests/integration/`): Use parser output from fixture HTML files as input to the diff module
- **Acceptance tests** (`tests/acceptance/`): Property-based tests verifying structural invariants (e.g., all source locations are valid ranges, stats sum correctly, no orphaned references)
