# Implementation Design: HTML Pattern Catalog (edgar-diff-vda.13)

## 1. Approach

Collect 10-15 real 10-K filings from SEC EDGAR, analyze their HTML structure for section heading patterns, and produce a structured catalog at `.specs/epic-1-library/html-patterns.md`.

### Fetching Strategy

Filings are fetched from SEC EDGAR using two endpoints:

1. **Company submissions** — `https://data.sec.gov/submissions/CIK{cik}.json` to discover 10-K accession numbers
2. **Filing HTML** — `https://www.sec.gov/Archives/edgar/data/{CIK}/{accession-no-dashes}/{primary-doc-filename}`

**SEC Rate Limits:**
- Max 10 requests/second per the SEC fair access policy
- Must include a `User-Agent` header with company name and email (SEC requirement)
- Respect `Retry-After` headers on 429/503 responses
- Implement exponential backoff: 3 retries with 1s base delay

The fetch script will be throttled to ~5 req/s (conservative margin) and will save raw HTML to the fixtures directory for offline analysis.

### Workflow

1. Run fetch script to download filings (one-time, cached locally)
2. Run analysis script on downloaded filings to extract heading metadata
3. Manually review analysis output and categorize patterns
4. Write findings into `html-patterns.md`

---

## 2. Company Selection

14 companies across sectors and known filing agents. Primary set uses FY2024; 3 companies also include FY2023 for cross-year pattern stability testing.

### Primary Set (FY2024)

| # | Company | Ticker | CIK | Sector | Expected Filing Agent |
|---|---------|--------|-----|--------|----------------------|
| 1 | Apple | AAPL | 0000320193 | Technology | Workiva |
| 2 | Microsoft | MSFT | 0000789019 | Technology | DFIN (RR Donnelley) |
| 3 | Amazon | AMZN | 0001018724 | Consumer/Tech | Toppan Merrill |
| 4 | JPMorgan Chase | JPM | 0000019617 | Financial Services | Toppan Merrill |
| 5 | Johnson & Johnson | JNJ | 0000200406 | Healthcare | DFIN |
| 6 | ExxonMobil | XOM | 0000034088 | Energy | Toppan Merrill |
| 7 | Berkshire Hathaway | BRK-B | 0001067983 | Conglomerate/Insurance | Likely in-house |
| 8 | Walmart | WMT | 0000104169 | Retail | Workiva |
| 9 | Procter & Gamble | PG | 0000080424 | Consumer Staples | DFIN |
| 10 | Bank of America | BAC | 0000070858 | Financial Services | DFIN |
| 11 | UnitedHealth Group | UNH | 0000731766 | Healthcare/Insurance | TBD |
| 12 | Chevron | CVX | 0000093410 | Energy | TBD |

### Cross-Year Filings (FY2023 + FY2024)

To validate pattern stability across years and enable integration test I4 (cross-filing consistency):

| Company | Ticker | Years |
|---------|--------|-------|
| Apple | AAPL | FY2023, FY2024 |
| Microsoft | MSFT | FY2023, FY2024 |
| JPMorgan Chase | JPM | FY2023, FY2024 |

### Historical Filing (Pre-2015)

To test boundary condition B1 (older filings with `<font>` tags, table-based layouts):

| Company | Ticker | Year | Rationale |
|---------|--------|------|-----------|
| ExxonMobil | XOM | FY2012 | Energy sector, likely pre-iXBRL legacy HTML |

### Optional Stretch

| # | Company | Ticker | Sector | Notes |
|---|---------|--------|--------|-------|
| 13 | Tesla | TSLA | Automotive/Energy | Existing simplified fixture |
| 14 | Pfizer | PFE | Pharmaceuticals | Additional pharma coverage |

### Total Filing Count: 16 fixtures (12 primary + 3 cross-year + 1 historical)

**Selection rationale:**
- Covers all 3 major filing agents (DFIN, Toppan Merrill, Workiva) plus potential in-house (BRK) and unknowns (UNH, CVX)
- Diverse sectors: tech, finance, healthcare, energy, retail, consumer, insurance
- All large-cap with readily available recent 10-K filings
- Mix of filing complexity (BRK has enormous filings; WMT is more standard)
- Cross-year pairs enable pattern stability validation
- Historical filing tests legacy HTML patterns (`<font>` tags, table layouts)

We already have real Apple fixture (`spikes/source-mapping/fixtures/apple-10k.html`) and simplified AAPL/TSLA test fixtures.

---

## 3. Analysis Methodology

For each filing, examine and document:

### 3a. Heading Element Patterns

- **Element type**: `<h1>`-`<h6>`, `<p>`, `<div>`, `<span>`, `<font>`, `<b>`, `<strong>`, `<a>`
- **Nesting structure**: e.g., `<div><span style="font-weight:700">Item 1. Business</span></div>`
- **Whether headings use semantic HTML elements** vs styled block/inline elements

### 3b. Inline Style Signals

- `font-weight: bold` / `font-weight: 700`
- `text-transform: uppercase`
- `font-size` (absolute or relative — compare heading vs body text sizes)
- `text-decoration: underline`
- `text-align: center`
- `line-height`, `margin-top`/`padding-top` (visual separation above headings)
- `text-indent` (negative indent for "Item N." style formatting)

### 3c. CSS Classes

- Named classes (e.g., `.sectionHeading`, `.itemTitle`)
- Whether classes are semantic or auto-generated (e.g., `cls_123`)

### 3d. Structural Conventions

- **TOC presence**: Does the filing include a table of contents that duplicates Item headings?
- **TOC format**: Hyperlinks (`<a href="#...">`) vs plain text
- **Page breaks**: `page-break-before/after`, `break-before/after` CSS, or `<hr>` tags
- **iXBRL inline markup**: `<ix:nonNumeric>`, `<ix:nonFraction>`, or other inline XBRL tags wrapping heading text — this is a **normal structural convention** in all post-2020 filings, not an error condition. The analyzer should document whether `ix:*` tags wrap headings and how deeply.
- **Nested div structures**: How deeply nested are heading elements?
- **Part-level headings**: How are "PART I", "PART II" etc. marked up?

### 3e. Split-Element Headings

Some filings split heading text across sibling elements, e.g.:
```html
<b>Item </b><b>1A.</b> <b>Risk Factors</b>
```
The analyzer must detect and flag this pattern. The current section-extractor accumulates text within a single block element's subtree, so split-sibling headings should still be captured — but this needs explicit verification per filing. Any filing exhibiting this pattern will be called out in the catalog with its exact HTML.

### 3f. Item Heading Markup Specifically

For each filing, capture the exact HTML for at least 3 Item headings:
- Item 1 (Business)
- Item 1A (Risk Factors)
- Item 7 (MD&A)

This gives a representative sample of heading markup patterns per filer.

---

## 4. Catalog Structure

`html-patterns.md` will be organized as follows:

```
# SEC 10-K HTML Heading Pattern Catalog

## Summary of Pattern Families
- Table: pattern family → characteristics → companies using it → frequency

## Pattern Family Details
### Family A: Styled div>span (Workiva)
- Description, example HTML, detection heuristic

### Family B: ... (DFIN)
### Family C: ... (Toppan Merrill)
### Family D: ... (Other/in-house)

## Per-Company Analysis
### Apple (AAPL) — Workiva
- Filing agent, filing date, accession number
- Heading element pattern
- Example HTML for Item 1, Item 1A, Item 7
- TOC structure
- Notable quirks

### Microsoft (MSFT) — DFIN
- ...
(repeat for each company)

## Detection Heuristic Recommendations
- Ranked signal list for section-extractor.ts
- Pattern priority: semantic h-tags > bold+item-regex > uppercase+item-regex > font-size > plain text
- Scoring rubric proposal
- TOC deduplication strategy

## Risk Assessment
- Number of distinct pattern families observed
- Estimated detection accuracy per family
- Overall coverage assessment vs 80% threshold
```

---

## 5. Tooling

### 5a. Filing Fetch Script

`scripts/fetch-filings.ts` — TypeScript script using native `fetch`:

```typescript
// Pseudocode
for each company:
  1. GET submissions JSON from data.sec.gov
  2. Find most recent 10-K accession number
  3. Extract primary document filename
  4. GET filing HTML from sec.gov
  5. Save to fixtures directory
  6. Throttle: await 200ms between requests
```

**Dependencies:** None beyond Node.js built-ins (native fetch, fs). Uses `tsx` to run TypeScript directly.

**Output:** Raw HTML files saved to `libs/edgar-diff-lib/tests/integration/fixtures/`

### 5b. Heading Pattern Analyzer Script

`scripts/analyze-headings.ts` — TypeScript script using `htmlparser2`:

```typescript
// For each downloaded filing:
1. Parse HTML with htmlparser2 (DomHandler, withStartIndices/withEndIndices)
2. Walk DOM tree looking for text matching /item\s+\d+[a-z]?/i
3. For each match, record:
   - Element tag name and ancestors (up to 3 levels)
   - Inline styles on the element and ancestors
   - CSS classes
   - Whether inside TOC (heuristic: before first actual content section)
   - Text content
   - Byte offset in file
4. Output JSON summary per filing
5. Aggregate: group patterns by element structure and style signals
```

**Output:** JSON analysis files per filing + aggregated summary to stdout.

### 5c. Ground Truth Generation

The `analyze-headings.ts` script also outputs a **draft** ground truth file per filing in the format agreed with the test plan:

```json
{
  "ticker": "JPM",
  "year": 2024,
  "cik": "0000019617",
  "accessionNumber": "0000019617-24-000XXX",
  "filingDate": "2024-02-XX",
  "patternFamily": "TBD",
  "hasTOC": true,
  "hasIXBRL": true,
  "filingAgentHint": "Toppan Merrill (from HTML comment)",
  "expectedItems": [
    { "id": "item-1", "heading": "Item 1. Business", "sourceOffset": 12345 },
    { "id": "item-1a", "heading": "Item 1A. Risk Factors", "sourceOffset": 23456 }
  ]
}
```

Saved as `meta-10k-{ticker}-{year}.json` alongside the HTML fixture. This merges filing metadata and expected items into a single companion file.

**Ground truth workflow:**
1. `analyze-headings.ts` produces draft `meta-*.json` files with auto-detected items
2. Human reviews and corrects each draft (adds missing items, removes false positives, assigns pattern family)
3. Corrected files become the ground truth for integration test accuracy measurement
4. Integration tests load `meta-*.json` to compare against `extractSections()` output

### 5d. Automation vs Manual

The scripts automate data collection, initial pattern extraction, and draft ground truth generation. Final categorization into pattern families and writing the catalog narrative requires manual review of the script output, since judgment is needed to decide what constitutes a "pattern family."

---

## 6. Filing Storage

### Directory Structure

```
libs/edgar-diff-lib/tests/integration/fixtures/
  10k-aapl-2024.html          # Filing HTML
  meta-10k-aapl-2024.json     # Combined metadata + ground truth
  10k-aapl-2023.html          # Cross-year comparison
  meta-10k-aapl-2023.json
  10k-msft-2024.html
  meta-10k-msft-2024.json
  10k-xom-2012.html           # Historical filing (legacy patterns)
  meta-10k-xom-2012.json
  ...etc
```

**Naming convention:**
- Filing HTML: `10k-{ticker}-{year}.html` (lowercase)
- Companion metadata: `meta-10k-{ticker}-{year}.json` (merged filing metadata + expected items)

**Size considerations:**
- Real 10-K filings range from 1-10 MB (Apple ~1.5 MB, Microsoft ~7-10 MB)
- 16 filings could total 40-80 MB
- These should be committed to the repo (per architecture doc section 8: "Real SEC HTML files committed to `tests/integration/fixtures/`")
- Consider `.gitattributes` with `filter=lfs` for filings over 5 MB if repo size becomes a concern
- Note: if git LFS is used, CI/CD must be configured for LFS checkout

**Existing fixtures:**
- `spikes/source-mapping/fixtures/apple-10k.html` — real Apple 10-K, can be copied/symlinked to standard location
- `10k-aapl-2023.html` and `10k-tsla-2023.html` — simplified test fixtures (not real filings), keep as-is for unit tests

---

## 7. Risk Assessment

### 80% Detection Accuracy Threshold

Per the PRD: "Test coverage across 10 sample filings drops below 80% section detection accuracy" is a risk signal for escalating the parser to its own epic.

**Measurement methodology:**
1. For each filing, load ground truth from `meta-10k-{ticker}-{year}.json` (produced by analyzer, human-verified)
2. Run the section-extractor against each filing
3. Calculate per-filing accuracy: `correctly_detected_items / total_items_in_ground_truth`
4. Calculate aggregate accuracy: `sum(correctly_detected) / sum(expected)` across all filings
5. Per-filing floor: no single filing may drop below 60% accuracy (flags a pattern family gap)
6. An item is "correctly detected" if:
   - The extractor returns a section with the correct item ID (item-1, item-1a, etc.)
   - The heading text matches the ground truth heading (normalized comparison)
   - The section's source offset is in the body, not the TOC

This definition is shared with the test plan (sections I1, I5, and Accuracy Measurement Protocol).

**Current state (from Spike B):**
- Apple: 22/22 sections detected (100%) — using `div>span` with `font-weight:700`
- Microsoft: 21-22 sections detected (~100%) — using mixed patterns
- Both use Workiva/DFIN agents respectively

**Risk factors:**
- Filings from less common agents or in-house tools may use unexpected patterns
- Older filings may use `<font>` tags or table-based layouts
- Some filings embed headings in table cells (seen in TOC patterns)
- XBRL inline markup can wrap heading elements, adding noise to element traversal

**Mitigation:**
- The current regex-based approach (`/item\s+\d+[a-z]?/i`) is element-agnostic — it works on text content regardless of HTML structure
- Adding a scoring system (h-tag bonus, bold bonus, uppercase bonus) helps disambiguate TOC entries from real headings
- The "take last occurrence" heuristic (from section-extractor.ts) already handles TOC deduplication

### Pattern Family Count

The architecture doc says: "if more than 3 distinct HTML pattern families are needed... escalate the parser to its own epic."

**Expected outcome:** Based on the spike findings, we expect 2-3 primary families:
1. **Styled div>span** (Workiva): `<div><span style="font-weight:700">Item N. Title</span></div>`
2. **Semantic or bold headings** (DFIN): possibly `<p style="font-weight:bold">` or `<b>ITEM N. TITLE</b>`
3. **Font-tag or legacy** (Toppan Merrill / older): `<font size="2"><b>Item N.</b></font>`

The single heuristic approach (text regex + heading signal scoring) is designed to handle all families generically, so the number of families may not matter if the heuristic covers them all.

---

## 8. Resolved Decisions

These were originally open questions, now resolved through design-test alignment:

1. **Filing year**: FY2024 for all 12 primary companies. FY2023 also fetched for AAPL, MSFT, JPM (cross-year testing). One pre-2015 filing (XOM FY2012) for legacy HTML patterns.

2. **iXBRL handling**: Handle natively in the section-extractor. htmlparser2 treats `ix:*` as regular elements, so the text regex walks through them transparently. The analyzer documents iXBRL presence per filing as a structural convention (not an error condition). Integration tests verify this works.

3. **Filing agent identification**: Record agent hints from HTML comments/meta tags when available (e.g., "Created with the Workiva Platform"), but pattern families emerge from the data empirically. Agent identity is informational, not a gating factor.

4. **Fixture size budget**: Commit all filings to git (per architecture doc section 8). 16 fixtures at 1-10 MB each = ~40-80 MB. Add git LFS tracking for files over 5 MB. CI/CD must be configured for LFS checkout if used.

5. **Simplified vs real fixtures**: Keep simplified fixtures (`10k-aapl-2023.html`, `10k-tsla-2023.html`) as-is for fast unit tests. Real filings use the same naming convention in the same directory.

6. **Metadata format**: Single `meta-10k-{ticker}-{year}.json` per filing, merging filing metadata and expected items ground truth. Generated as draft by `analyze-headings.ts`, human-reviewed for correctness.

## 9. Open Questions

1. **Split-element headings**: If the analyzer discovers filings where heading text is split across sibling elements (e.g., `<b>Item </b><b>1A.</b>`), does the current extractor's text accumulation within block elements handle this correctly? Needs empirical verification during analysis. If common, the extractor may need sibling-aware text joining.

2. **Part-level heading detection**: The current extractor focuses on "Item N" headings. Should we also detect and catalog "PART I", "PART II", etc. as first-class headings, or treat them as organizational markers only? The architecture doc's `FilingSection.level` field suggests a hierarchy (level 1 = top-level Item, level 2 = subsection), which could accommodate Part-level grouping.
