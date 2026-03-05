---
title: "Implementation Design: HTML Pattern Catalog (vda.13)"
story: edgar-diff-vda.13
created: "2026-03-05"
status: draft
---

# Implementation Design: Catalog HTML Heading Patterns from Sample Filings

## 1. Approach

**Strategy: Automated fetch + manual-assisted analysis, documented in structured markdown.**

We will write a lightweight Node.js/TypeScript script (`analyze-headings.ts`) that:
1. Fetches each sample filing's HTML from EDGAR
2. Extracts all candidate heading elements (elements whose text matches `ITEM \d+[A-Z]?` or `PART [IVX]+`)
3. For each candidate, records: element tag, parent chain (3 levels), inline styles, CSS classes, text content, character offset
4. Outputs a structured JSON report per filing

The script automates the tedious extraction work. A human (or agent) then reviews the JSON reports, identifies pattern families, and writes the final `html-patterns.md` catalog.

**Why not fully manual?** 15 filings × 20+ Item headings each = 300+ heading instances. Manual HTML inspection would be error-prone and slow. The script ensures we capture every heading occurrence consistently.

**Why not fully automated?** The catalog is a design artifact, not production code. Human judgment is needed to identify pattern families, assess edge cases, and write prose descriptions that inform the heuristic extractor design.

## 2. Sample Filing Selection

### Selected Filings (15 total)

| # | Company | Ticker | CIK | Accession Number | Filing Date | Filing Agent | Industry |
|---|---------|--------|-----|-----------------|-------------|-------------|----------|
| 1 | Apple Inc. (FY2025) | AAPL | 0000320193 | 0000320193-25-000079 | 2025-10-31 | Workiva | Technology |
| 2 | Apple Inc. (FY2022) | AAPL | 0000320193 | 0000320193-22-000108 | 2022-10-28 | Workiva | Technology |
| 3 | Microsoft Corp | MSFT | 0000789019 | 0000950170-25-100235 | 2025-07-30 | DFIN | Technology |
| 4 | Tesla, Inc. | TSLA | 0001318605 | 0001628280-26-003952 | 2026-01-29 | Workiva | Auto/Energy |
| 5 | Amazon.com Inc | AMZN | 0001018724 | 0001018724-26-000004 | 2026-02-06 | Workiva | E-commerce |
| 6 | Meta Platforms | META | 0001326801 | 0001628280-26-003942 | 2026-01-29 | Workiva | Technology |
| 7 | JPMorgan Chase | JPM | 0000019617 | 0001628280-26-008131 | 2026-02-13 | Workiva | Finance |
| 8 | Bank of America | BAC | 0000070858 | 0000070858-26-000157 | 2026-02-25 | Workiva | Finance |
| 9 | Berkshire Hathaway | BRK-A | 0001067983 | 0001193125-26-083899 | 2026-03-02 | DFIN | Conglomerate |
| 10 | Johnson & Johnson | JNJ | 0000200406 | 0000200406-26-000016 | 2026-02-11 | Workiva | Healthcare |
| 11 | Pfizer Inc. | PFE | 0000078003 | 0000078003-26-000026 | 2026-02-26 | Workiva | Pharma |
| 12 | ExxonMobil Corp | XOM | 0000034088 | 0000034088-26-000045 | 2026-02-18 | Workiva | Energy |
| 13 | Procter & Gamble | PG | 0000080424 | 0000080424-25-000076 | 2025-08-04 | Workiva | Consumer |
| 14 | Photronics Inc | PLAB | 0000810136 | 0001140361-25-045801 | 2025-12-17 | Broadridge/CompSci | Semiconductors |
| 15 | AtlasClear Holdings | ATCH | 0001963088 | 0001104659-25-094578 | 2025-09-29 | Toppan Merrill | Finance (small-cap) |

### Diversity Rationale

- **Filing agents**: 10 Workiva, 2 DFIN, 1 Broadridge/CompSci, 1 Toppan Merrill (4 distinct agents). This reflects the actual market: Workiva dominates large-cap filings, DFIN is second. Broadridge/CompSci and Toppan Merrill are rare but produce structurally distinct HTML.
- **Industries**: Technology (3), Finance (2), Healthcare/Pharma (2), Energy (1), Consumer (1), Auto (1), Conglomerate (1), E-commerce (1), Semiconductors (1).
- **Years**: 2022 (1 filing), 2025 (5 filings), 2026 (9 filings) — includes an older Apple filing for temporal diversity to detect pattern evolution within Workiva.
- **Filing size diversity**: Ranges from small (AtlasClear ~3MB) to very large (JPMorgan ~12MB, Bank of America ~12MB). This tests parser performance on different document sizes.
- **Same-company temporal pair**: Apple 2022 + Apple 2025 enables direct comparison of how Workiva templates evolved over 3 years.

**Key findings from research:**

1. The filing agent market has consolidated heavily toward Workiva. DFIN is second. Toppan Merrill and Broadridge/CompSci are rare among large-cap filers.
2. **A 4th filing agent was discovered**: Broadridge/CompSci (via `CompSci Transform` and `Broadridge PROfile`). Photronics uses this agent, which has a structurally distinct table-based heading pattern (headings inside `<table class="DSPFListTable">` with `<td>` cells). This is important because:
   - It uses CSS classes (`DSPFListTable`) — unique among agents we found
   - Heading text is split across table cells, not spans
   - It uses `<a name="ITEM1.BUSINESS">` anchors with `<!--Anchor-->` comments
3. **Risk gate implication**: 4 pattern families > the architecture's threshold of 3 (section 6: "If more than 3 distinct HTML pattern families are needed..."). The catalog must include an explicit risk assessment evaluating whether a single heuristic approach can still achieve ≥80% accuracy. Early indications are positive — all 4 families use bold text and `ITEM \d` patterns as universal signals.
4. **No semantic heading tags**: Across all 15 filings, ZERO use of `<h1>`-`<h6>` for section headings. All agents use `<div>`, `<p>`, `<span>`, `<b>`, `<td>`, or `<font>` with inline styles. This is a critical finding for the section-extractor — it cannot rely on heading tags.
5. **Item 1C (Cybersecurity) and Item 9C**: All 2024+ filings include Item 1C (mandated Dec 2023) and Item 9C. The standard 10-K now has 22 Items (not the 20 listed in the architecture doc). The catalog must document all 22.

## 3. Analysis Methodology

### Step-by-step process per filing

1. **Fetch the filing HTML** from EDGAR using the standard URL pattern:
   ```
   https://www.sec.gov/Archives/edgar/data/{CIK}/{accession-no-dashes}/{primary-doc}
   ```

2. **Identify the filing agent** from HTML comments:
   - Workiva: `<!--XBRL Document Created with the Workiva Platform-->` (or older: `<!--XBRL Document Created with Wdesk from Workiva-->`)
   - DFIN: `<!-- DFIN New ActiveDisclosure (SM) Inline XBRL Document -->`
   - Toppan Merrill: `<!--Enhanced HTML document created with Toppan Merrill Bridge-->`
   - Broadridge/CompSci: `<!-- Generated by CompSci Transform (tm) -->` and `<!-- Licensed to: Broadridge Financial Solutions -->`

3. **Extract heading elements** — find all DOM elements whose normalized text content matches:
   - `ITEM \d+[A-Z]?\.?\s` (item headings)
   - `PART [IVX]+` (part headings)
   Record for each match:
   - Element tag name (div, p, span, b, font, td, h1-h6)
   - Parent element chain (up to 3 levels)
   - All inline styles on the element and its ancestors
   - CSS classes (if any)
   - Text content (normalized)
   - Whether it's in a TOC (has `<a href>` pointing to an anchor)
   - Whether it's a body heading (the actual section start)
   - Character offset (start/end)

4. **Classify each heading** as:
   - **TOC entry**: Appears in a table-of-contents section, typically has `<a href="#...">` links
   - **Body heading**: The actual section heading in the document body
   - **Reference**: Inline mention of an Item in body text (e.g., "see Part II, Item 7")

5. **Document structural conventions**:
   - TOC presence and format (table-based vs. list-based)
   - Page break indicators (CSS `page-break-before`, `break-before`)
   - XBRL inline markup wrapping (`<ix:nonNumeric>`, `<ix:nonFraction>`)
   - Empty spacing elements (`visibility:hidden`, `&#8203;` zero-width spaces)

6. **Record the heading signal strengths**:
   - Element type weight: h-tag > div > p > span > td
   - Style signals: bold (`font-weight:bold|700`), font-size increase, uppercase (`text-transform:uppercase` or all-caps text)
   - Structural signals: margin-top (visual separation), text-indent (hanging indent)

### Heading classification heuristics to validate

For each filing, verify whether these heuristics correctly identify body headings vs TOC entries vs references:

| Signal | Weight | Rationale |
|--------|--------|-----------|
| Text matches `ITEM \d+[A-Z]?` | Required | Base pattern |
| No `<a href>` ancestor/wrapper | High | Excludes TOC entries |
| `font-weight: bold` or `<b>` tag | High | Universal heading signal |
| `font-size` ≥ 11pt | Medium | Headings often larger than body |
| Not inside `<td>` (unless entire row is the heading, as in Broadridge) | Medium | Avoids TOC table cells; Broadridge uses `<td>` for body headings |
| Preceded by significant margin-top | Low | Visual separation |
| UPPERCASE text | Low | Some filings use uppercase, others don't |

## 4. Output Format

### `html-patterns.md` Structure

```markdown
# HTML Heading Pattern Catalog

## Filing Agent Identification
[How to detect which agent produced a filing]

## Pattern Family 1: Workiva
### Heading Element Structure
[Element types, nesting, inline styles]
### TOC Structure
[Table of contents patterns]
### Body Heading Patterns
[Actual section heading markup]
### Variations Across Companies
[Differences within the Workiva family]
### XBRL Wrapping
[How inline XBRL affects heading detection]

## Pattern Family 2: DFIN (Donnelley Financial Solutions)
[Same subsections as above]

## Pattern Family 3: Toppan Merrill
[Same subsections as above]

## Pattern Family 4: Broadridge/CompSci
[Same subsections as above]

## Cross-Family Commonalities
[Patterns shared across all agents]

## Part-Level Heading Patterns
[Part I, Part II, Part III, Part IV heading markup per family]
[Hierarchical relationship: Part > Item > Subsection]

## Heading Detection Heuristics
[Ranked signal list with weights]
### Recommended Algorithm
[Pseudocode for section-extractor.ts]

## Risk Gate Assessment
[Evaluation of 4 pattern families against architecture section 6 threshold of 3]
[Heuristic coverage feasibility: can a single approach achieve ≥80% accuracy?]

## Edge Cases and Anomalies
[Unusual patterns found during analysis]

## Filing Size and Performance Notes
[Document sizes, parse complexity observations]

## Appendix: Per-Filing Analysis
[One subsection per filing with raw findings]
```

Each pattern family section will include:
- **Canonical example**: Actual HTML snippet from a representative filing
- **Variations observed**: Differences across filings using the same agent
- **Distinguishing features**: What makes this family unique
- **Detection reliability**: How reliably the heuristic identifies headings for this family

## 5. Tooling

### Analysis Script: `scripts/analyze-headings.ts`

A throwaway script (not shipped in the library) that:

1. **Fetches** a filing from EDGAR given its accession number
2. **Parses** the HTML using `htmlparser2` with `DomHandler` (validates the architecture's chosen library)
3. **Walks** the DOM tree looking for text nodes matching Item/Part patterns
4. **Collects** heading metadata (tag, styles, classes, parent chain, offset)
5. **Classifies** each match as TOC / body-heading / reference
6. **Outputs** JSON report to `analysis-output/{ticker}-{year}.json`

```typescript
interface HeadingMatch {
  text: string;               // Normalized text content
  rawHtml: string;            // Raw HTML of the heading element
  elementTag: string;         // Tag name of the innermost element
  parentChain: string[];      // Parent tags (up to 3 levels)
  inlineStyles: Record<string, string>; // Parsed inline styles
  cssClasses: string[];       // CSS class names
  isBold: boolean;            // font-weight: bold/700 or <b> tag
  fontSize: string | null;    // font-size value if present
  isUppercase: boolean;       // All-caps text
  hasAnchorLink: boolean;     // Contains or wrapped in <a href>
  hasNamedAnchor: boolean;    // Has <a name="..."> nearby
  classification: 'toc' | 'body-heading' | 'reference';
  charOffset: { start: number; end: number };
}

interface FilingAnalysis {
  ticker: string;
  accessionNumber: string;
  filingAgent: 'workiva' | 'dfin' | 'toppan-merrill' | 'broadridge-compsci' | 'unknown';
  fileSizeBytes: number;
  headingMatches: HeadingMatch[];
  hasToc: boolean;
  tocFormat: 'table' | 'list' | 'none';
  hasPageBreaks: boolean;
  hasXbrlInline: boolean;
}
```

**Runtime**: The script is run once during the cataloging phase. It is not production code and lives in `scripts/` (outside `libs/edgar-diff-lib/`).

**Dependencies**: `htmlparser2`, `domhandler`, `domutils` (already planned for the library), plus `node-fetch` or native fetch for HTTP. No additional dependencies needed.

### Execution Plan

```bash
# From the repo root
npx tsx scripts/analyze-headings.ts --all    # Analyze all 15 filings
npx tsx scripts/analyze-headings.ts --ticker AAPL  # Analyze one filing
```

The script respects SEC rate limits (max 10 req/s, proper User-Agent header). All 15 filings can be fetched sequentially with ~0.2s delay between requests.

## 6. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `.specs/epic-1-library/vda13-design/implementation-design.md` | Create | This document |
| `scripts/analyze-headings.ts` | Create | Heading analysis script |
| `scripts/filing-list.json` | Create | JSON list of the 15 sample filings with metadata |
| `analysis-output/*.json` | Create | Per-filing JSON analysis reports (gitignored) |
| `.specs/epic-1-library/html-patterns.md` | Create | Final structured catalog (primary deliverable) |
| `.gitignore` | Modify | Add `analysis-output/` directory |

## 7. Edge Cases

### Identified During Research

1. **Split heading text across multiple `<span>` elements**: Both Workiva and DFIN frequently split heading text across multiple `<span>` elements within the same `<p>` or `<div>`. Example (DFIN/Microsoft):
   ```html
   <span ...>ITEM 1. B</span><span ...>USINESS</span>
   ```
   The analysis script must concatenate text from sibling spans before pattern matching.

2. **XBRL inline wrapping**: SEC filings use iXBRL markup (`<ix:nonNumeric>`, etc.) that wraps heading content. The heading detection must look through XBRL tags to find the actual text content.
   ```html
   <ix:nonNumeric contextRef="c-1" name="cyd:...">
     For discussion, see Item 1A...
   </ix:nonNumeric>
   ```

3. **TOC vs body heading disambiguation**: Every filing has both a table of contents and body headings with identical text. The analysis must distinguish between these. Key signals:
   - TOC entries contain `<a href="#...">` links
   - Body headings may contain `<a name="...">` anchors (Toppan Merrill) or `id` attributes (Workiva)
   - Body headings are typically bold; TOC entries may or may not be

4. **Inline references to Items**: Body text frequently references other Items (e.g., "see Part II, Item 7"). These must not be detected as section headings. Key signals:
   - Inline references appear within paragraph text, not as standalone elements
   - They lack heading styles (bold, large font)
   - They're surrounded by other text content

5. **Entity-encoded characters**: `&#160;` (non-breaking space), `&#8217;` (right single quote), `&#8220;`/`&#8221;` (smart quotes) are common. Text normalization must handle these before pattern matching.

6. **Very large filings**: JPMorgan and Bank of America filings are 10-15MB of HTML. The analysis script should stream or handle these without excessive memory usage. `htmlparser2`'s SAX mode handles this naturally.

7. **Custom font families**: JPMorgan uses a font called 'Sons' (sans-serif). This is unusual and worth documenting, though it doesn't affect heading detection.

8. **Zero-width spaces and invisible elements**: Toppan Merrill uses `&#8203;` (zero-width space) in `<font style="visibility:hidden">` elements as spacers. These must be stripped during text normalization.

9. **"Item 6. [Reserved]"**: Since 2023, Item 6 is reserved and contains no content. Some filings include it as a heading, others omit it. The extractor should handle both cases.

10. **Heading text variations**: The same Item heading may appear differently:
    - "ITEM 1. BUSINESS" (DFIN, uppercase)
    - "Item 1. Business" (Workiva/Apple, title case)
    - "Item 1. Business." (JPMorgan, with trailing period)
    - "Item 1. Business Description" (Berkshire, custom title)

11. **Table-based heading layout (Broadridge/CompSci)**: Photronics (Broadridge) uses `<table class="DSPFListTable">` with heading text split across `<td>` cells: "ITEM 1." in the first cell, "BUSINESS" in the second. This is distinct from Workiva/DFIN which use `<div>` or `<p>`. The heading detector must handle `<td>` as a valid heading container when the table has a `DSPFListTable` class or similar pattern.
    ```html
    <a name="ITEM1.BUSINESS"><!--Anchor--></a>
    <table class="DSPFListTable" ...>
      <tr>
        <td style="width: 54pt; font-weight: bold;">ITEM 1.</td>
        <td style="font-weight: bold;">BUSINESS</td>
      </tr>
    </table>
    ```

12. **CSS classes as heading signals**: Among all agents, only Broadridge/CompSci uses meaningful CSS classes (`DSPFListTable`). Workiva, DFIN, and Toppan Merrill rely entirely on inline styles. The heading detector should check for CSS classes as an optional signal but not require them.

13. **No semantic heading tags observed**: Across all 15 sample filings, ZERO use of `<h1>`–`<h6>` for 10-K Item headings. All agents use `<div>`, `<p>`, `<span>`, `<b>`, `<td>`, or `<font>` with inline styles. The section-extractor must not rely on heading tags as a primary signal.

14. **Standard Items count is 22, not 20**: Post-2023 10-K filings include Item 1C (Cybersecurity, SEC mandate Dec 2023) and Item 9C (Disclosure Regarding Foreign Jurisdictions). Item 16 (Form 10-K Summary) is technically standard but universally omitted. The catalog should document all 22 standard Items, noting Item 16 as typically absent.

## 8. Open Questions (Resolved)

| # | Question | Resolution |
|---|----------|------------|
| 1 | Non-standard filing agent? | **Yes — added Photronics (Broadridge/CompSci).** Discovered a 4th filing agent with a structurally distinct table-based pattern. This replaces the Walmart filing to keep the total at 15. |
| 2 | Older filings for temporal diversity? | **Yes — added Apple FY2022 (filed 2022-10-28).** Enables same-company comparison (Apple 2022 vs 2025) to document Workiva pattern evolution. Replaces Goldman Sachs to keep total at 15. |
| 3 | Preserve analysis script? | **Yes.** Keep in `scripts/` for regression testing when new pattern families emerge. Mark as not-shipped (outside `libs/`). |
| 4 | Filing size thresholds? | **Yes.** Document observed file sizes and parse time estimates per filing. JPMorgan (12MB) and Bank of America (12MB) are the stress cases. |
| 5 | Part-level headings? | **Yes.** Part headings (Part I–IV) provide hierarchical structure above Items. The catalog will document Part heading patterns per family since the section-extractor needs both Part and Item patterns. |
