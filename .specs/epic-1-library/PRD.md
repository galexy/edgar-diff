# Epic 1: SEC Filing Diff Library

## Overview

A library that fetches SEC filings from EDGAR, parses them into a structured document model, and computes structured diffs between two filings. This is the core engine that all downstream consumers (web app, chat, programmatic users) depend on.

## Goals

- Fetch any full-text SEC filing by its accession number from EDGAR
- Parse filings into a normalized, structured document representation with source mappings back to the original HTML
- Produce a structured, section-aware diff between two parsed filings
- Expose a clean programmatic API suitable for embedding in other systems

## Non-Goals

- Web UI or any visual presentation (Epic 2)
- LLM-powered chat or Q&A (Epic 3)
- Real-time filing monitoring or alerting
- Filing search or discovery (listing available filings for a company is a separate concern)
- XBRL parsing or extraction (future epic)
- Local caching of fetched filings (future feature)
- Package distribution (consumed as a local dependency only)

## Target Users

- Developers building on top of the library (including ourselves for Epics 2 and 3)
- Power users who want programmatic access to filing diffs

---

## EDGAR Concepts

The library operates on SEC EDGAR data. Key concepts:

- **CIK (Central Index Key):** A 10-digit numeric identifier assigned by the SEC to every filing entity. Example: `0000320193` (Apple Inc.).
- **Accession Number:** The unique identifier for a specific filing submission. Format: `{filer-CIK}-{YY}-{sequence}`, e.g., `0000320193-23-000106`. The first 10 digits are the CIK of the submitting entity, followed by a 2-digit year and a sequence number.
- **Primary Document:** Each filing submission contains one or more documents. The primary document is the main filing (e.g., the 10-K HTML). It is identified by filename within the submission.
- **Filing URL pattern:** `https://www.sec.gov/Archives/edgar/data/{CIK}/{accession-number-no-dashes}/{primary-document-filename}`

The SEC provides a free REST API at `data.sec.gov` that returns JSON without authentication. The submissions endpoint (`https://data.sec.gov/submissions/CIK{padded-cik}.json`) returns a company's filing history including accession numbers, filing dates, form types, and primary document filenames. This API is how callers of our library would discover filing identifiers before passing them to us, but that discovery is outside the scope of this library.

**Rate limit policy:** SEC limits programmatic access to 10 requests/second and requires a `User-Agent` header identifying the caller (format: `"Company Name email@domain.com"`).

---

## User Stories

### EDGAR Client

**US-1.1: Fetch a filing by accession number**
As a developer, I want to fetch a specific SEC filing by providing its accession number so that I can retrieve the full-text document for processing.

Acceptance criteria:
- Accepts an accession number (e.g., `0000320193-23-000106`) as the filing identifier
- Retrieves the primary HTML document from EDGAR Archives
- Returns the raw HTML content along with filing metadata (CIK, form type, filing date, accession number)
- Includes a proper `User-Agent` header as required by SEC

**US-1.2: Respect SEC rate limits**
As a developer, I want the client to respect SEC EDGAR rate limits so that requests don't get blocked.

Acceptance criteria:
- Enforces maximum 10 requests/second to EDGAR endpoints
- Backs off on 429 or 503 responses
- Rate limiting is implemented within the library's HTTP layer (callers should not need to manage this externally)

Note: Rate limiting is a cross-cutting concern. The idiomatic approach for a library is to provide a configurable HTTP client with sensible defaults (built-in rate limiter) while allowing callers to inject their own client if they need different behavior (e.g., a shared rate limiter across multiple library instances).

### Filing Parser

**US-1.3: Parse a filing into structured sections with source mappings**
As a developer, I want to parse a raw HTML filing into a structured document model with pointers back to the original HTML so that I can work with logical sections and later render highlights on the original document.

Acceptance criteria:
- Identifies standard 10-K sections (Item 1, 1A, 1B, 2, 3, 4, 5, 6, 7, 7A, 8, 9, 9A, 9B, 10, 11, 12, 13, 14, 15)
- Handles common HTML patterns for section headings (h-tags, bold paragraphs, font tags, uppercase text)
- Produces a document tree: Document > Section > Subsection > Content blocks (paragraphs, tables, lists)
- Each node in the tree includes source location references (byte offsets or DOM node identifiers) pointing back to the corresponding range in the original HTML
- Source mappings enable downstream consumers to overlay diff highlights on the original HTML rendering
- Handles filings from major filing agents (Donnelley Financial Solutions, Toppan Merrill, Workiva)

Note on filing agents: These three agents cover the vast majority of large-cap SEC filings. They do not publish public documentation on their HTML templates. The practical approach is to collect sample filings from each agent and reverse-engineer the HTML patterns (CSS classes, heading styles, document structure conventions) used for section boundaries.

**US-1.4: Parse tables into structured representations**
As a developer, I want tables in filings to be parsed into a structured row/column model so that table diffs can be computed at the cell level.

Acceptance criteria:
- Extracts HTML tables into a row/column data structure
- Preserves header rows and column labels
- Handles merged cells (colspan/rowspan) gracefully
- Retains numeric values as numbers where detectable
- Each cell includes a source mapping back to its position in the original HTML

### Diff Engine

**US-1.5: Compute a section-level diff between two parsed filings**
As a developer, I want to compute a diff that aligns sections across two filings so that I can see which sections were added, removed, or changed.

Acceptance criteria:
- Matches sections across filings by heading text similarity
- Identifies added sections (present in new filing only)
- Identifies removed sections (present in old filing only)
- Identifies modified sections (present in both, content differs)
- Identifies unchanged sections
- Handles renamed sections (e.g., "Risk Factors" -> "Risk Factors and Uncertainties")
- Handles reordered sections (sections that moved position but are otherwise unchanged or modified)
- Handles subsection-level matching within matched sections

**US-1.6: Compute paragraph-level diffs within matched sections**
As a developer, I want paragraph-level diffs within each section so that I can see exactly which paragraphs changed.

Acceptance criteria:
- Within matched sections, aligns paragraphs and detects additions, deletions, and modifications
- For modified paragraphs, computes sentence-level diffs to show what changed within the paragraph
- Handles paragraph reordering without marking everything as changed
- Diff output includes source mappings so that changes can be rendered as overlays/highlights on the original HTML

**US-1.7: Compute table-level diffs**
As a developer, I want table diffs computed at the cell level so that changes to financial statements and other tables are precise.

Acceptance criteria:
- Matches tables across filings by position and header similarity
- Computes cell-by-cell diffs for matched tables
- Identifies added/removed rows and columns
- Highlights changed cell values

**US-1.8: Produce a structured diff output**
As a developer, I want the complete diff to be a structured data object so that any consumer (UI, summary generator, export tool) can work with it programmatically.

This story integrates the outputs of US-1.5 through US-1.7 into a single coherent diff structure.

Acceptance criteria:
- Diff is returned as a structured object, not rendered text
- Includes metadata: accession numbers, filing dates, form type, CIK
- Each section diff includes the section heading, change type (added/removed/modified/unchanged/reordered), and content diffs
- Paragraph diffs within sections include source mappings to both the old and new filing HTML
- Table diffs are included within their containing sections
- Serializable to JSON for storage or transmission
- Output format is designed to support rendering diff highlights as overlays on the original HTML documents

---

## Technical Considerations

### Parser Architecture: Source Mapping

The parser must maintain a bidirectional relationship between the structured document model and the original HTML. This is critical because:

1. **Rendering:** The web app (Epic 2) will render the original HTML and overlay diff highlights. It will not render the cleaned-up/canonical document model.
2. **Accuracy:** Source mappings let us verify that our structural parsing correctly captured the intended content boundaries.

Each node in the structured document tree should carry:
- `source_start`: byte offset (or DOM path) into the original HTML where this node's content begins
- `source_end`: byte offset (or DOM path) where this node's content ends
- `source_html`: optionally, the raw HTML slice for this node (for debugging and verification)

### Filing Agent HTML Patterns

Major filing agents do not publish public template documentation. The approach is empirical:
- Collect 5-10 sample filings from each of Donnelley Financial Solutions (DFIN), Toppan Merrill, and Workiva
- Catalog the HTML patterns each uses for section headings, subsections, tables, and document structure
- Build a pattern-matching layer that detects which agent produced a filing and applies the appropriate parsing rules
- Track pattern families; if more than 3 distinct families emerge, consider splitting parser work into its own epic

### Parser Risk Signals

If any of these occur, consider splitting the parser into its own epic:
- More than 3 distinct HTML pattern families needed for section detection
- Table parsing requires filing-agent-specific logic for more than 2 agents
- Test coverage across 10 sample filings drops below 80% section detection accuracy

### API Surface

The public API should be minimal. Callers provide specific filing identifiers (accession numbers), not search queries:

```
fetch_filing(accession_number) -> RawFiling
parse_filing(raw_filing) -> StructuredDocument
diff_filings(doc_a, doc_b) -> StructuredDiff
```

Filing discovery (listing/searching filings by company, type, date range) is out of scope for this library. The SEC's submissions API at `data.sec.gov/submissions/` provides this capability and callers can use it directly.

### Technology Decisions (TBD)

- Programming language and package manager
- HTML parsing library
- Diff algorithm (Myers, patience, or custom for section alignment)
- Source mapping strategy (byte offsets vs. DOM node references vs. both)

---

## Open Questions

1. **Language choice** -- What language/runtime should the library target? Python is natural for data work and has strong HTML parsing libraries. TypeScript/Node would align if the web app is JS-based. Rust or Go if performance is a priority.
