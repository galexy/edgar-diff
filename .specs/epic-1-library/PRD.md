# Epic 1: SEC Filing Diff Library

## Overview

A standalone library that fetches SEC filings from EDGAR, parses them into a structured document model, and computes structured diffs between two filings. This is the core engine that all downstream consumers (web app, chat, programmatic users) depend on.

## Goals

- Fetch any full-text SEC filing by company and filing type from EDGAR
- Parse filings into a normalized, structured document representation
- Produce a structured, section-aware diff between two parsed filings
- Expose a clean programmatic API suitable for embedding in other systems
- Package as a standalone library with no UI dependencies

## Non-Goals

- Web UI or any visual presentation (Epic 2)
- LLM-powered chat or Q&A (Epic 3)
- Real-time filing monitoring or alerting
- Coverage of every historical filing format variant (we scope to common filers, recent years)

## Target Users

- Developers building on top of the library (including ourselves for Epics 2 and 3)
- Power users who want programmatic access to filing diffs

---

## User Stories

### EDGAR Client

**US-1.1: Fetch a filing by company and filing type**
As a developer, I want to fetch a specific SEC filing by providing a company identifier (ticker or CIK) and filing type (10-K, 10-Q, etc.) so that I can retrieve the full-text document for processing.

Acceptance criteria:
- Accepts ticker symbol or CIK number as company identifier
- Supports filing types: 10-K, 10-Q, 8-K, DEF 14A at minimum
- Returns the raw HTML filing content
- Resolves ticker to CIK automatically

**US-1.2: List available filings for a company**
As a developer, I want to list all available filings of a given type for a company so that I can select which two filings to compare.

Acceptance criteria:
- Returns a list of filings with date, accession number, and filing type
- Supports filtering by filing type and date range
- Results are ordered by filing date (most recent first)

**US-1.3: Respect SEC rate limits**
As a developer, I want the client to automatically respect SEC EDGAR rate limits so that my application doesn't get blocked.

Acceptance criteria:
- Enforces maximum 10 requests/second to EDGAR
- Includes a proper User-Agent header as required by SEC
- Backs off gracefully on 429 or 503 responses

**US-1.4: Cache fetched filings locally**
As a developer, I want fetched filings to be cached locally so that repeated operations on the same filing don't require re-downloading.

Acceptance criteria:
- Filings are cached by accession number
- Cache is stored on the local filesystem
- Cache can be cleared or bypassed programmatically

### Filing Parser

**US-1.5: Parse a filing into structured sections**
As a developer, I want to parse a raw HTML filing into a structured document model so that I can work with logical sections rather than raw markup.

Acceptance criteria:
- Identifies standard 10-K sections (Item 1, 1A, 1B, 2, 3, 4, 5, 6, 7, 7A, 8, 9, 9A, 9B, 10, 11, 12, 13, 14, 15)
- Handles common HTML patterns for section headings (h-tags, bold paragraphs, font tags, uppercase text)
- Produces a document tree: Document > Section > Subsection > Content blocks (paragraphs, tables, lists)
- Handles filings from major filing agents (Donnelley, Toppan Merrill, Workiva)

**US-1.6: Parse tables into structured representations**
As a developer, I want tables in filings to be parsed into a structured row/column model so that table diffs can be computed at the cell level.

Acceptance criteria:
- Extracts HTML tables into a row/column data structure
- Preserves header rows and column labels
- Handles merged cells (colspan/rowspan) gracefully
- Retains numeric values as numbers where detectable

**US-1.7: Handle XBRL data for improved accuracy**
As a developer, I want the parser to leverage XBRL data when available so that financial statement sections are parsed more accurately.

Acceptance criteria:
- Detects whether a filing has inline XBRL (iXBRL) data
- Uses XBRL tags to improve section boundary detection
- Uses XBRL data to identify financial figures in tables
- Falls back to HTML-only parsing when XBRL is unavailable

### Diff Engine

**US-1.8: Compute a section-level diff between two parsed filings**
As a developer, I want to compute a diff that aligns sections across two filings so that I can see which sections were added, removed, or changed.

Acceptance criteria:
- Matches sections across filings by heading text similarity
- Identifies added sections (present in new filing only)
- Identifies removed sections (present in old filing only)
- Identifies modified sections (present in both, content differs)
- Identifies unchanged sections
- Handles renamed sections (e.g., "Risk Factors" -> "Risk Factors and Uncertainties")

**US-1.9: Compute paragraph-level diffs within matched sections**
As a developer, I want paragraph-level diffs within each section so that I can see exactly which paragraphs changed.

Acceptance criteria:
- Within matched sections, aligns paragraphs and detects additions, deletions, and modifications
- For modified paragraphs, provides word-level or sentence-level inline diffs
- Handles paragraph reordering without marking everything as changed

**US-1.10: Compute table-level diffs**
As a developer, I want table diffs computed at the cell level so that changes to financial statements and other tables are precise.

Acceptance criteria:
- Matches tables across filings by position and header similarity
- Computes cell-by-cell diffs for matched tables
- Identifies added/removed rows and columns
- Highlights changed cell values

**US-1.11: Produce a structured diff output**
As a developer, I want the diff output to be a structured data object so that any consumer (UI, summary generator, export tool) can work with it programmatically.

Acceptance criteria:
- Diff is returned as a structured object, not rendered text
- Includes metadata: filing identifiers, dates, company info
- Each section diff includes the section heading, change type, and content diffs
- Serializable to JSON for storage or transmission

---

## Technical Considerations

### Scoping the Parser

The parser is the highest-risk component. To keep this epic tractable:

- **Initial scope:** 10-K filings from S&P 500 companies, filed 2015 or later
- **Filing agents:** Focus on Donnelley (RR Donnelley), Toppan Merrill, and Workiva, which cover the majority of large-cap filers
- **Iteration plan:** Start with a small set of test filings (5-10 companies across filing agents), get those working reliably, then expand

### Parser Risk Signals

If any of these occur, consider splitting the parser into its own epic:
- More than 3 distinct HTML pattern families needed for section detection
- Table parsing requires filing-agent-specific logic for more than 2 agents
- Test coverage across 10 sample filings drops below 80% section detection accuracy

### API Surface

The public API should be minimal:

```
fetch_filing(company, filing_type, date?) -> RawFiling
list_filings(company, filing_type?, date_range?) -> [FilingMetadata]
parse_filing(raw_filing) -> StructuredDocument
diff_filings(doc_a, doc_b) -> StructuredDiff
```

### Technology Decisions (TBD)

- Programming language and package manager
- HTML parsing library
- Diff algorithm (Myers, patience, or custom for section alignment)
- Caching strategy (filesystem, SQLite, etc.)
- XBRL parsing approach

---

## Open Questions

1. **Language choice** — What language/runtime should the library target? Python is natural for data work and has strong HTML parsing libraries. TypeScript/Node would align if the web app is JS-based. Rust or Go if performance is a priority.
2. **Filing coverage scope** — Are S&P 500 filers from 2015+ the right initial scope, or should we go narrower/broader?
3. **XBRL priority** — Should XBRL support be in the initial release or deferred? It improves accuracy but adds complexity.
4. **Diff granularity** — Is word-level diff within paragraphs necessary for v1, or is paragraph-level sufficient?
5. **Distribution** — Should the library be published to a package registry from the start, or is it sufficient to consume it as a local dependency from the web app?
