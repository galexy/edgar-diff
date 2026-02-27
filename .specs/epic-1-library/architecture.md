---
title: SEC Filing Diff Library — Architecture
epic: edgar-diff-vda
created: "2026-02-26"
status: draft
---

# Architecture: SEC Filing Diff Library (Epic 1)

## Fixed Decisions

- Language: TypeScript on Node.js
- Package manager: pnpm
- Monorepo tooling: Nx
- Date/time: Temporal API (via `@js-temporal/polyfill` until native support ships)
- Testing framework: vitest

---

## 1. Project Structure

```
edgar-diff/
├── apps/                             # Applications (Epic 2 web app, etc.)
├── libs/
│   └── edgar-diff-lib/               # Core library (Epic 1)
│       ├── src/
│       │   ├── index.ts              # Public API re-exports only
│       │   ├── client/
│       │   │   ├── edgar-client.ts   # HTTP fetcher + rate limiter
│       │   │   └── types.ts
│       │   ├── parser/
│       │   │   ├── parser.ts              # Orchestrator
│       │   │   ├── section-extractor.ts   # Heuristic heading detection
│       │   │   ├── table-extractor.ts
│       │   │   └── types.ts
│       │   ├── diff/
│       │   │   ├── diff-engine.ts        # Orchestrator
│       │   │   ├── section-aligner.ts
│       │   │   ├── paragraph-differ.ts
│       │   │   ├── table-differ.ts
│       │   │   └── types.ts
│       │   └── types.ts              # Shared: SourceLocation, SourceMapped
│       ├── tests/
│       │   ├── unit/
│       │   ├── integration/
│       │   │   └── fixtures/         # Real SEC HTML committed to repo
│       │   └── fuzz/
│       ├── spikes/                   # Throwaway prototypes; not shipped
│       │   ├── source-mapping/
│       │   └── diff-algorithm/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── project.json              # Nx project configuration
├── nx.json                           # Nx workspace configuration
├── pnpm-workspace.yaml
└── package.json                      # Root package.json
```

The repo is an Nx monorepo managed with pnpm. `libs/` contains shared libraries (starting with `edgar-diff-lib`). `apps/` will contain applications (Epic 2 web app, etc.). Nx handles task orchestration (build, test, lint) with caching and dependency-aware execution order.

Module boundary rules: `client` has no dependency on `parser` or `diff`. `parser` imports only from `client/types`. `diff` imports only from `parser/types`. The barrel `src/index.ts` is the sole public surface — no internal module paths are exported. Nx enforce-module-boundaries lint rule should be configured to enforce these constraints.

---

## 2. HTML Parsing Library

**Options evaluated:**

| Library | Mechanism | Key property |
|---|---|---|
| `htmlparser2` | SAX-style streaming + DomHandler tree builder | Exposes `startIndex`/`endIndex` on every token |
| `cheerio` | Wraps parse5 (or htmlparser2) with jQuery API | No native byte-offset access on nodes |
| `linkedom` | WHATWG DOM in Node.js | No position data on nodes |
| `parse5` | Full WHATWG-spec tree builder | No position data by default |
| `node-html-parser` | Lightweight, exposes `range` on nodes | Less actively maintained |

**Recommendation: `htmlparser2`.**

The core requirement is character-level source mappings on every node (section 3). `htmlparser2` uniquely exposes `startIndex` and `endIndex` on each token during SAX parsing — available at parse time with no second pass, no heuristic substring search. We build a minimal DOM-like tree during the SAX pass (via `DomHandler`) with position data attached directly to each node.

Cheerio, linkedom, and parse5 are convenient for querying but require post-hoc position reconstruction by searching the original HTML string for node content — fragile when SEC filing HTML contains repeated boilerplate paragraphs. `htmlparser2`'s position data is authoritative; derived reconstruction is not.

---

## 3. Source Mapping Strategy

### Options Evaluated

**A. Byte offsets** — Each node stores `{ start: number, end: number }` as character offsets into the original HTML string. Directly available from `htmlparser2`. Serializes as JSON integers. Enables `html.slice(start, end)`. The web app can inject highlight spans by preprocessing the HTML string before rendering.

**B. DOM path references** — XPath or CSS nth-child paths (e.g., `body > div:nth-child(3) > p:nth-child(2)`). Browser-native; drives `document.querySelector`. Fragile when DOM structure differs between old/new filing versions. Requires browser re-parse and query — adds coupling to Epic 2's rendering model.

**C. Both** — Byte offsets as canonical, DOM paths derived on demand.

### Recommendation: Byte offsets as the canonical source map.

Rationale:
1. `htmlparser2` provides them at zero cost during parsing.
2. The diff engine operates server-side on strings — offsets are the natural representation.
3. The web app (Epic 2) can inject highlights by slicing and reassembling the HTML string before `innerHTML` assignment, which is simpler than DOM path queries on a re-parsed document.
4. DOM paths can be derived from offsets later; the reverse is not true.

Note: `htmlparser2` indices are character positions (JS UTF-16 string indices), not raw byte offsets. Spike A must document this distinction for any `Buffer`-based consumers.

```typescript
export interface SourceLocation {
  /** Character offset of the opening `<` in the original HTML string (JS string index). */
  start: number;
  /** Character offset one past the last character of this node's closing tag. */
  end: number;
}

export interface SourceMapped {
  source: SourceLocation;
  /** Raw HTML substring. Only populated when parseOptions.includeSourceHtml is true. */
  sourceHtml?: string;
}
```

---

## 4. Diff Algorithm

### Options Evaluated

**A. Myers diff** — Standard O(ND) algorithm. Minimizes edit distance. No content awareness — treats each paragraph as an opaque token. Produces noisy output when sections move or when large unchanged blocks appear between two changed paragraphs.

**B. Patience diff** — Preprocessing layer over Myers. Identifies tokens appearing exactly once in both versions as anchors, divides documents at anchors, applies Myers recursively on each segment. Common unique paragraphs (specific legal boilerplate, financial labels) become natural anchors in SEC filings.

**C. Custom section aligner + patience diff** — Two phases: (1) match sections using normalized heading similarity; (2) within matched section pairs, run patience diff on paragraphs. Does not treat the document as a flat token stream.

### Recommendation: Custom section aligner (phase 1) + patience diff (phase 2).

The section-level alignment problem is not a standard line-diff problem. 10-K filings have standardized headings ("Item 1A. Risk Factors") that are stable across years. Running any line diff across a full document would align by proximity, not semantic identity — sections that moved position would appear as mass-delete followed by mass-insert.

The custom aligner uses Jaro-Winkler similarity on normalized heading text (lowercased, "item 1a" normalization). Threshold ~0.75: above = same section (possibly modified), below = added or removed. This handles renames ("Risk Factors" → "Risk Factors and Uncertainties") as modifications rather than delete+add pairs.

Within matched sections, patience diff (via the `diff` npm package) operates on paragraph text. Patience is preferred over raw Myers because SEC filings reuse boilerplate — unique paragraphs become anchors that keep the diff aligned even when new paragraphs are inserted nearby. For sentence-level diffs within modified paragraphs, Myers on sentence tokens is acceptable (sentences are short enough that Myers is not noisy at that granularity).

Spike B validates the similarity threshold and output quality before committing this approach.

---

## 5. API Surface

### Public Exports (`src/index.ts`)

```typescript
export { createEdgarClient } from './client/edgar-client';
export { parseFiling } from './parser/parser';
export { diffFilings } from './diff/diff-engine';
export type {
  EdgarClientOptions, RawFiling, FormType, StructuredDocument,
  StructuredDiff, FilingSection, SectionDiff, SourceLocation,
} from './types';
```

### Core Types

```typescript
// ---- Shared ----

export interface SourceLocation { start: number; end: number; }
export interface SourceMapped { source: SourceLocation; sourceHtml?: string; }

// ---- Client ----

export interface EdgarClientOptions {
  userAgent: string;               // "Company Name email@example.com"
  maxRequestsPerSecond?: number;   // Default: 10
  fetch?: typeof globalThis.fetch; // Override for testing
}

export type FormType =
  | '10-K' | '10-K/A'
  | '10-Q' | '10-Q/A'
  | '8-K'  | '8-K/A'
  | '20-F' | '20-F/A'
  | 'S-1'  | 'S-1/A'
  | 'DEF 14A'
  | 'SC 13D' | 'SC 13D/A';

export interface RawFiling {
  accessionNumber: string;         // "0000320193-23-000106"
  cik: string;                     // "0000320193"
  formType: FormType;
  filingDate: Temporal.PlainDate;  // e.g., Temporal.PlainDate.from("2023-11-03")
  primaryDocumentFilename: string;
  html: string;
  fetchedAt: Temporal.Instant;     // e.g., Temporal.Now.instant()
}

// ---- Parser ----

export interface Paragraph extends SourceMapped { type: 'paragraph'; text: string; }

export interface TableCell extends SourceMapped {
  text: string; numericValue?: number; colspan: number; rowspan: number;
}
export interface TableRow extends SourceMapped { cells: TableCell[]; isHeader: boolean; }
export interface Table extends SourceMapped { type: 'table'; rows: TableRow[]; }

export type ContentBlock = Paragraph | Table;

export interface FilingSection extends SourceMapped {
  id: string;           // Normalized: "item-1a"
  heading: string;      // Raw: "Item 1A. Risk Factors"
  level: number;        // 1 = top-level Item, 2 = subsection
  blocks: ContentBlock[];
  subsections: FilingSection[];
}

export interface StructuredDocument {
  filing: RawFiling;
  sections: FilingSection[];
  parseWarnings: string[];
}

// ---- Diff ----

export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged' | 'reordered';
export interface DiffRange { old?: SourceLocation; new?: SourceLocation; }

export interface ParagraphDiff {
  changeType: ChangeType;
  oldParagraph?: Paragraph;
  newParagraph?: Paragraph;
  sentenceDiffs?: Array<{ type: 'equal' | 'insert' | 'delete'; value: string }>;
  sourceMapping: DiffRange;
}

export interface TableDiff {
  changeType: ChangeType;
  oldTable?: Table;
  newTable?: Table;
  cellDiffs?: Array<{
    row: number; col: number;
    changeType: Exclude<ChangeType, 'reordered'>;
    oldValue?: string; newValue?: string;
    sourceMapping: DiffRange;
  }>;
  sourceMapping: DiffRange;
}

export interface SectionDiff {
  id: string; heading: string; changeType: ChangeType;
  oldSection?: FilingSection; newSection?: FilingSection;
  paragraphDiffs: ParagraphDiff[];
  tableDiffs: TableDiff[];
  subsectionDiffs: SectionDiff[];
  sourceMapping: DiffRange;
}

export interface StructuredDiff {
  oldFiling: RawFiling;
  newFiling: RawFiling;
  sectionDiffs: SectionDiff[];
  summary: { added: number; removed: number; modified: number; unchanged: number; reordered: number };
  generatedAt: Temporal.Instant;
}

// ---- Function signatures ----

export declare function createEdgarClient(options: EdgarClientOptions): {
  fetchFiling(accessionNumber: string): Promise<RawFiling>;
};
export declare function parseFiling(
  raw: RawFiling,
  options?: { includeSourceHtml?: boolean; logger?: Logger },
): StructuredDocument;
export declare function diffFilings(
  oldDoc: StructuredDocument,
  newDoc: StructuredDocument,
): StructuredDiff;

export interface Logger { warn(msg: string): void; }
```

---

## 6. HTML Pattern Catalog

SEC filings are produced by various filing agents (DFIN, Toppan Merrill, Workiva, and others) whose HTML templates are undocumented. Rather than attempting to detect and branch on the filing agent, the parser uses a single heuristic-based approach that handles all observed heading patterns generically.

**Cataloging steps:**

1. Collect 10-15 sample 10-K filings from a variety of large-cap filers. Aim for diversity in HTML structure rather than targeting specific agents.
2. For each filing, document the HTML patterns used for section headings — element types (`<h1>`–`<h4>`, `<p>`, `<div>`), inline styles (bold, uppercase, font-size), CSS classes, and structural conventions (table-of-contents presence, page breaks).
3. Commit findings to `.specs/epic-1-library/html-patterns.md` as a structured catalog of observed heading patterns.
4. Build a single `section-extractor.ts` that applies a ranked set of heuristics: (a) scan for elements matching `ITEM \d+[A-Z]?` in normalized text, (b) weight matches by heading signals (h-tag > bold > uppercase > plain), (c) use scoring to break ties when multiple candidates match.

**Risk gate (per PRD):** If more than 3 distinct HTML pattern families are needed and the heuristic approach can't cover them reliably (< 80% section detection accuracy across sample filings), escalate the parser to its own epic.

---

## 7. Error Handling Strategy

**Network (client layer):** `EdgarNetworkError` with `statusCode` and `retryAfter`. Client retries 429/503 with exponential backoff (3 attempts, 1s base). Callers see the error only after all retries fail. The internal token bucket enforces 10 req/s — callers do not see rate-limit errors under normal operation.

**Parse (parser layer):** Parser never throws on valid HTML. Unrecognized sections go into `id: 'unrecognized'` catch-all. Structural anomalies are collected in `StructuredDocument.parseWarnings`. A pluggable `Logger` (default: no-op) accepts warnings via `parseFiling(raw, { logger })`.

**Diff (diff layer):** No recoverable failure paths. Unmatched sections are emitted as added/removed pairs with no content diffs.

```typescript
export class EdgarNetworkError extends Error {
  readonly name = 'EdgarNetworkError';
  constructor(
    public readonly statusCode: number,
    public readonly accessionNumber: string,
    public readonly retryAfter?: number,
  ) { super(`EDGAR returned ${statusCode} for ${accessionNumber}`); }
}
```

---

## 8. Testing Approach

### Unit Tests (`tests/unit/`)

Test individual pure functions. HTML fixtures are inline tagged-template strings inside each test file — no external files for unit tests. Keep each fixture under 30 lines of HTML. Cover: section heading detection across HTML pattern variations (h-tags, bold, uppercase, font tags), table cell colspan/rowspan normalization, Jaro-Winkler threshold calibration, source offset arithmetic edge cases (empty elements, self-closing tags, comments).

### Integration Tests (`tests/integration/`)

Real SEC HTML files committed to `tests/integration/fixtures/`. Naming: `{agent}-{formtype}-{ticker}-{year}.html`. Start with 6 files (2 per agent). Assertions: (a) correct section count for a known filing, (b) specific section IDs present (`item-1a`, `item-7`), (c) source offset round-trip: `html.slice(section.source.start, section.source.end)` contains the section heading text. Diff integration tests: parse two consecutive annual filings for the same company, run `diffFilings`, assert summary counts are non-zero and no exception is thrown.

### Fuzz / Structural Variation Tests (`tests/fuzz/`)

A `FilingHtmlGenerator` generates structurally plausible but randomized 10-K HTML: random Item ordering, mixed heading styles (h2/bold-p/uppercase-p), tables with random colspan/rowspan values (including pathological overlap), empty sections, sections with duplicate headings, Unicode in heading text. Generate N=200 synthetic filings per CI run. For each, assert invariants: (a) no uncaught exception, (b) `sections.length >= 0` (empty is allowed), (c) all `source.start < source.end`, (d) all offsets within `[0, html.length)`. This surfaces off-by-one errors, greedy regex matches, and null-dereferences that targeted unit tests miss.

---

## 9. Spike Tasks

### Spike A: Source Mapping Prototype

**Goal:** Validate that `htmlparser2` `startIndex`/`endIndex` values provide accurate, reliable character-level positions on real SEC HTML before committing this architecture.

**Scope:** Fetch one real 10-K filing from EDGAR. Build a minimal SAX-based parser using `htmlparser2`'s `DomHandler`. Attach `startIndex`/`endIndex` to each node. Identify 5 section boundaries. Verify `html.slice(node.startIndex, node.endIndex)` captures expected content. Test with a filing containing multi-byte characters to clarify character-vs-byte indexing.

**Deliverable:** `spikes/source-mapping/` with runnable TypeScript and `NOTES.md` documenting: (a) character-vs-byte behavior, (b) any CDATA or comment anomalies in SEC HTML, (c) parse time for a full 10-K, (d) API stability across `htmlparser2` versions.

**Success criteria:** All 5 offset checks pass. Multi-byte behavior documented and handled. Parse time < 500ms.

**Fallback:** If `htmlparser2` offsets are unreliable, pivot to two-pass: parse with `linkedom` for structure, reconstruct positions by scanning the original HTML string for each node's outer HTML (with deduplication handling).

**Time box:** 2 days.

### Spike B: Diff Algorithm Prototype

**Goal:** Validate section alignment quality and patience-diff output on real filing pairs before committing the algorithm.

**Scope:** Two consecutive 10-K filing pairs (minimum; use two different companies). Implement custom section aligner with Jaro-Winkler similarity. For matched sections, apply patience diff at the paragraph level via the `diff` npm package. Compare output against naive Myers on the full document text. Manually review alignment and diff output readability.

**Deliverable:** `spikes/diff-algorithm/` with runnable TypeScript and `NOTES.md` documenting: (a) section alignment accuracy per filing pair (correctly matched / total), (b) optimal Jaro-Winkler threshold, (c) paragraph diff quality (subjective: does it highlight meaningful changes?), (d) full-pair performance, (e) cases where patience performs worse than Myers.

**Success criteria:** > 90% section alignment accuracy for both pairs. Paragraph diffs highlight meaningful changes, not whitespace/boilerplate noise. Full diff < 2 seconds per pair.

**Fallback:** If Jaro-Winkler heading similarity is insufficient, add TF-IDF scoring on section content as a secondary alignment signal.

**Time box:** 2 days.

