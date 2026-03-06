# Implementation Design: US-1.3 Parse Filing into Structured Sections

## Approach

Parse raw 10-K HTML into a `StructuredDocument` with source-mapped `FilingSection` trees using htmlparser2's DomHandler.

**Strategy: Two-pass, tree-based extraction.**

1. **Pass 1 — Parse HTML into DOM tree.** Use `htmlparser2.parseDocument()` with `DomHandler` options `{ withStartIndices: true, withEndIndices: true }`. This produces a full DOM tree where every node has `startIndex`/`endIndex` (inclusive). Spike A confirmed this is reliable (~29ms for 1.5MB filing, 100% of nodes get valid indices).

2. **Pass 2 — Walk DOM tree to extract sections.** Recursively traverse the tree to find heading candidates, score them, deduplicate, then extract content blocks between section boundaries.

**Why DomHandler (tree) over SAX (streaming):**
- **Subsection nesting** requires knowing parent-child relationships to build `FilingSection.subsections`
- **Text accumulation** across child nodes (split-element headings like MSFT's `<span>ITEM </span><span>1. BUSINESS</span>`) is natural with tree traversal — just collect text from all descendants of a block element
- **Source offsets** are more accurate: `endIndex + 1` gives exclusive end for `SourceLocation`, validated in Spike A
- **Font-size scoring** requires comparing heading candidate's style against surrounding body text — easier with tree context

The SAX prototype in the spike worked but was fragile with split headings and lacked tree context for scoring. DomHandler adds negligible overhead (~29ms total parse time).

---

## Files to Create/Modify

### New files

| File | Purpose |
|------|---------|
| `src/types.ts` | Shared types: `SourceLocation`, `SourceMapped`, parser output types |
| `src/parser/types.ts` | Internal parser types: `HeadingCandidate`, `SectionBoundary`, `ExtractionContext` |
| `src/parser/section-extractor.ts` | Core heading detection + section boundary extraction |
| `src/parser/content-extractor.ts` | Extract `Paragraph` blocks from section HTML (tables stubbed for US-1.4) |
| `src/parser/parser.ts` | Orchestrator: `parseFiling()` entry point |
| `src/parser/index.ts` | Barrel exports for parser module |

### Modified files

| File | Change |
|------|--------|
| `src/index.ts` | Add re-exports for `parseFiling` and parser types |

---

## Interfaces and Types

### Shared types (`src/types.ts`)

```typescript
// Re-export client types for downstream consumers
export type { RawFiling, FormType } from './client/types.js';

/** Character offset range in the original HTML string (JS UTF-16 indices). */
export interface SourceLocation {
  /** Offset of the first character (inclusive). */
  start: number;
  /** Offset one past the last character (exclusive). */
  end: number;
}

/** Mixin for any node that maps back to source HTML. */
export interface SourceMapped {
  source: SourceLocation;
  /** Raw HTML substring. Only populated when parseOptions.includeSourceHtml is true. */
  sourceHtml?: string;
}

export interface Paragraph extends SourceMapped {
  type: 'paragraph';
  text: string;
}

export interface TableCell extends SourceMapped {
  text: string;
  numericValue?: number;
  colspan: number;
  rowspan: number;
}

export interface TableRow extends SourceMapped {
  cells: TableCell[];
  isHeader: boolean;
}

export interface Table extends SourceMapped {
  type: 'table';
  rows: TableRow[];
}

export type ContentBlock = Paragraph | Table;

export interface FilingSection extends SourceMapped {
  /** Normalized ID: "item-1a" */
  id: string;
  /** Raw heading text: "Item 1A. Risk Factors" */
  heading: string;
  /** 1 = top-level Item, 2 = subsection */
  level: number;
  blocks: ContentBlock[];
  subsections: FilingSection[];
}

export interface StructuredDocument {
  filing: import('./client/types.js').RawFiling;
  sections: FilingSection[];
  parseWarnings: string[];
}

export interface Logger {
  warn(msg: string): void;
}
```

### Internal parser types (`src/parser/types.ts`)

```typescript
import type { SourceLocation } from '../types.js';

/** A DOM element that matched the Item heading regex. */
export interface HeadingCandidate {
  /** Raw accumulated text content from the block element and its children. */
  text: string;
  /** Normalized item number: "1", "1a", "7a", etc. */
  itemNumber: string;
  /** Source location of the containing block element. */
  source: SourceLocation;
  /** Heuristic score (higher = more likely a real heading, not TOC/cross-ref). */
  score: number;
}

/** Defines a section boundary after deduplication and scoring. */
export interface SectionBoundary {
  /** Heading candidate that defines this boundary. */
  heading: HeadingCandidate;
  /** Offset where the section's content ends (exclusive). Start of next section or end of document. */
  contentEnd: number;
}

/** Mutable context passed through the extraction pipeline. */
export interface ExtractionContext {
  /** Original HTML string. */
  html: string;
  /** Accumulated parse warnings. */
  warnings: string[];
  /** Whether to populate sourceHtml on nodes. */
  includeSourceHtml: boolean;
  /** Optional logger for warnings. */
  logger?: import('../types.js').Logger;
}
```

---

## Data Flow

```
parseFiling(raw, options?)
  │
  ├─ 1. Parse HTML with htmlparser2 DomHandler
  │     htmlparser2.parseDocument(raw.html, { withStartIndices: true, withEndIndices: true })
  │     → Document (DOM tree with source indices on every node)
  │
  ├─ 2. Find heading candidates
  │     walkDom(document) → HeadingCandidate[]
  │     - Visit every Element node recursively
  │     - For each block element (div, p, h1-h6, td, tr):
  │       accumulate text content from all descendant text nodes
  │     - Test accumulated text against ITEM_HEADING_RE
  │     - If match: extract item number, compute score, push candidate
  │
  ├─ 3. Score candidates
  │     For each HeadingCandidate:
  │       +3  font-weight >= 700 or ancestor <b>/<strong>
  │       +2  font-size > body font-size (estimated from document)
  │       +2  text is ALL UPPERCASE
  │       +3  element has semantic id matching item pattern
  │       +1  text-align: center
  │       +1  text-decoration: underline
  │       -5  inside <a> tag (likely cross-reference link)
  │       -3  text prefixed with "see " or "refer to "
  │
  ├─ 4. Deduplicate
  │     Group candidates by itemNumber.
  │     For each group: take the LAST occurrence (handles TOC before body).
  │     Sort by document position.
  │
  ├─ 5. Build section boundaries
  │     SectionBoundary[] where each boundary's contentEnd = next boundary's start
  │     (or html.length for the last section)
  │
  ├─ 6. Extract content blocks
  │     For each SectionBoundary:
  │       - Re-walk DOM nodes within [source.start, contentEnd)
  │       - Extract Paragraph blocks from text-bearing block elements
  │       - Stub Table blocks (empty for now, US-1.4)
  │       - Attach SourceLocation to every Paragraph
  │
  ├─ 7. Build FilingSection tree
  │     For each boundary → FilingSection with:
  │       id: normalized "item-{number}"
  │       heading: raw text
  │       level: 1 (all Items are top-level; subsection detection deferred)
  │       blocks: extracted ContentBlock[]
  │       subsections: [] (deferred — could be enhanced later)
  │       source: { start: heading.source.start, end: contentEnd }
  │
  └─ 8. Return StructuredDocument
        { filing: raw, sections: FilingSection[], parseWarnings: string[] }
```

---

## Section Detection Heuristics

### Text matching

Primary regex for Item headings:

```typescript
const ITEM_HEADING_RE =
  /^\s*(?:PART\s+[IV]+\s*[\u2014\u2013\u2014\u2013—–-]?\s*)?item\s+(\d+[a-z]?)[\s.:,\u2014\u2013—–-]/i;

const ITEM_HEADING_SIMPLE_RE = /^\s*item\s+(\d+[a-z]?)\s*$/i;
```

The regex anchors to start-of-string (after trimming) to avoid matching mid-sentence references like "as described in Item 1A". The optional `PART` prefix handles headings like "PART I — Item 1".

**Non-breaking space handling:** WMT uses `ITEM&#160;1.` (`\u00a0` between "ITEM" and number). The regex `\s+` matches `\u00a0` in JavaScript, so this works out of the box. However, text accumulation from DOM nodes may produce `\u00a0` characters — the `extractItemNumber()` function should normalize `\u00a0` to regular spaces before regex matching to be safe:

```typescript
function extractItemNumber(rawText: string): string | null {
  const text = rawText.replace(/\u00a0/g, ' ');
  const match = text.match(ITEM_HEADING_RE) ?? text.match(ITEM_HEADING_SIMPLE_RE);
  // ...
}
```

### Known item numbers

```typescript
const KNOWN_ITEMS = new Set([
  '1', '1a', '1b', '1c', '2', '3', '4', '5', '6', '7', '7a', '8',
  '9', '9a', '9b', '9c', '10', '11', '12', '13', '14', '15', '16',
]);
```

Candidates with item numbers not in `KNOWN_ITEMS` are discarded (filters out Regulation S-K references like "Item 406").

### DOM walking strategy

Walk all DOM nodes recursively. At each block-level element (`div`, `p`, `h1`-`h6`, `td`, `tr`), accumulate text content from all descendant text nodes. This naturally handles:

- **Split-element headings** (MSFT: `<span>ITEM </span><span>1. BUSINESS</span>`) — text joins across children
- **iXBRL wrappers** (`<ix:nonNumeric>`) — htmlparser2 treats `ix:*` as regular elements; walk through transparently
- **Legacy font tags** (`<font>`) — text content is the same regardless of wrapper elements
- **Table-cell splits** (WMT: `<td>ITEM 1.</td><td>BUSINESS</td>`) — `<tr>`-level text accumulation joins cells

### Scoring

```typescript
function scoreCandidate(candidate: HeadingCandidate, element: Element, context: ExtractionContext): number {
  let score = 0;

  // Positive signals
  if (hasBoldSignal(element))          score += 3;  // font-weight:700/bold, <b>, <strong>
  if (hasLargerFontSize(element))      score += 2;  // font-size > estimated body size
  if (isAllUppercase(candidate.text))  score += 2;  // ALL CAPS text
  if (hasSemanticId(element))          score += 3;  // id="item_1_business"
  if (isCenterAligned(element))        score += 1;  // text-align:center
  if (hasUnderline(element))           score += 1;  // text-decoration:underline

  // Negative signals
  if (isInsideAnchor(element))         score -= 5;  // <a> tag = cross-reference
  if (hasCrossRefPrefix(candidate.text)) score -= 3; // "see ", "refer to "

  return score;
}
```

### TOC deduplication

**Last-occurrence heuristic:** For each item number, if multiple candidates exist, take the last one. This handles the common pattern where the Table of Contents lists all items (first occurrences) before the actual section headings appear in the document body.

This heuristic was validated in the spike prototype and matches the recommendation in the HTML pattern catalog. WMT's 66 TOC entries vs 5 body headings is the stress case — last-occurrence correctly selects the body headings.

### Split-element headings

Text accumulation across child nodes within a block element handles most split patterns:

| Pattern | Example | Handling |
|---------|---------|----------|
| Sibling spans | `<span>ITEM </span><span>1. BUSINESS</span>` | Join text of all children in parent `<p>`/`<div>` |
| Item + italic title | `<span>Item 1B. </span><span style="italic">Title</span>` | Same — join all text nodes |
| Sibling `<td>` cells | `<td>ITEM 1.</td><td>BUSINESS</td>` | Join text of all `<td>` within `<tr>` |

The `<tr>`-level joining for table-based headings (Family D) requires checking accumulated text at both `<td>` and `<tr>` levels.

---

## Dependencies

- **htmlparser2** (already installed) — HTML parsing with source indices
- **domhandler** (transitive dep of htmlparser2) — `Element`, `Text`, `Document` types and `isTag()` helper

No new external dependencies needed. The `domhandler` types ship with htmlparser2.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Empty HTML string | Return `{ sections: [], parseWarnings: ["Empty HTML content"] }` |
| HTML with no Item headings | Return `{ sections: [], parseWarnings: ["No Item headings found"] }` |
| Duplicate headings (TOC + body) | Last-occurrence heuristic selects body heading |
| Split-element headings | Text accumulation across children of block element |
| Very large filings (10MB+) | htmlparser2 handles in ~29ms for 1.5MB; linear scaling; no concern |
| Legacy `<font>` tag filings | Regex works on text content regardless of element structure |
| iXBRL wrappers (`<ix:*>`) | Transparent traversal — htmlparser2 treats as regular elements |
| Tables as content blocks | Stub as `Table` with empty `rows: []` (US-1.4 scope) |
| Regulation S-K refs (e.g., "Item 406") | Filtered by `KNOWN_ITEMS` set — not recognized as valid item numbers |
| Cross-references ("See Item 1A") | Filtered by: (a) start-of-string anchor in regex, (b) -3 score for "see/refer" prefix, (c) -5 for `<a>` wrapper |
| Multi-byte characters | htmlparser2 uses JS string indices (UTF-16); no byte-vs-char issues (Spike A confirmed) |
| Self-closing tags (`<br>`, `<hr>`) | Valid `startIndex`/`endIndex`; no impact on section extraction |
| Malformed/unclosed HTML | htmlparser2 is lenient; will produce best-effort DOM tree |

---

## Design Decisions (Resolved)

These questions were resolved during design review with the tester:

1. **Subsection detection (level > 1):** Deferred entirely for v1. All sections are `level: 1` with empty `subsections: []`. The architecture supports it, but there's no reliable heuristic without more research. Future enhancement.

2. **Body font-size estimation:** Hardcode 10pt as default body font-size for scoring. This works for 14/15 sample filings. JPM (12pt headings vs 10pt body) is the critical case this enables. If a filing uses a non-standard body size, font-size scoring simply won't contribute — other signals (bold, uppercase, position) still work. This is preferable to the complexity of computing mode across all text nodes.

3. **Content before first heading:** Discard silently for v1. Add a parseWarning: `"Content before first Item heading was skipped (N characters)"`. No synthetic preamble section — it would pollute the sections array and complicate downstream diff alignment.

4. **Score threshold:** No minimum score threshold for v1. The regex + KNOWN_ITEMS + last-occurrence combo provides sufficient filtering based on spike results. Score is computed and stored on `HeadingCandidate` for diagnostic logging and potential future tiebreaking, but does not gate acceptance.

5. **`includeSourceHtml`:** In scope for v1 (opt-in via `parseFiling(raw, { includeSourceHtml: true })`). Only populates `sourceHtml` when explicitly requested. The `html.slice(start, end)` cost is negligible per-node; the concern is aggregate memory for very large filings, but since it's opt-in, callers control this tradeoff.

6. **Table extraction scope:** Tables are detected as `<table>` elements within section boundaries and emitted as `Table` content blocks with `rows: []` (empty stub). This preserves their position in the `blocks` array and their `SourceLocation`, so downstream consumers know tables exist and where they are. Full row/cell extraction is US-1.4 scope. Tests should verify that `Table` stubs appear in `blocks` for sections containing `<table>` elements.

7. **Ground truth quality:** The draft meta JSON files contain known false positives (cross-references like `item-601`, body text snippets). Integration tests filter ground truth to only count IDs matching `/^item-\d+[a-z]?$/` where the number is in `KNOWN_ITEMS`. Ground truth cleanup is a separate task but does not block implementation.

---

## Open Questions

1. **`<tr>`-level text accumulation ordering:** When joining text across `<td>` cells in a `<tr>` (WMT pattern), insert a single space between cell texts to produce "ITEM 1. BUSINESS" rather than "ITEM 1.BUSINESS". Will verify during implementation that this doesn't break regex matching for other filings.

2. **`scoreCandidate()` visibility:** The scoring function is an internal implementation detail. It is not exported or directly unit-tested. Scoring correctness is validated indirectly through end-to-end accuracy tests (>=80% per filing). If accuracy drops, we can add targeted score tests. This avoids coupling tests to internal scoring weights that may be tuned.

3. **parseWarnings format:** Free-form human-readable strings for v1. No structured format. Tests check `parseWarnings.length > 0` for known anomaly cases and that `logger.warn()` receives them. Formalize later if consumers need machine-readable warnings.
