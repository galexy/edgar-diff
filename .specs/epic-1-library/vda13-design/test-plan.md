# Test Plan: HTML Pattern Catalog (edgar-diff-vda.13)

## Overview

This test plan validates the HTML pattern catalog for 10-K section headings. The catalog documents heading patterns from 10-15 diverse large-cap filers and ensures the section extractor achieves >=80% detection accuracy across all observed patterns.

---

## 1. BDD Acceptance Criteria

### Scenario 1: Catalog completeness — filing count
```
Given the catalog task
When 10-15 10-K filings are collected from diverse large-cap filers
Then each filing has an entry in html-patterns.md
And each entry identifies the filer, CIK, accession number, and fiscal year
```

### Scenario 2: Per-filing pattern documentation
```
Given a filing entry in the catalog
When its HTML patterns are analyzed
Then the entry documents:
  - Element types used for headings (h1-h6, p, div, span, td, font)
  - Inline styles (font-weight, text-transform, font-size, text-decoration)
  - CSS classes applied to heading elements
  - Structural conventions (TOC presence, page-break markers, PART groupings)
  - Nesting structure (e.g., div>span, p>b, td>p>font)
```

### Scenario 3: Filer diversity
```
Given the full set of collected filings
When the filing agents / HTML template families are reviewed
Then at least 3 distinct HTML pattern families are represented
And no single filing agent accounts for more than 50% of the sample
```

### Scenario 4: Section detection accuracy (key metric)
```
Given a filing with N known standard 10-K item headings
When the section extractor runs against that filing
Then at least 80% of item headings (ceil(0.8 * N)) are correctly detected
And detected headings have correct item IDs (item-1, item-1a, item-7, etc.)
```

### Scenario 5: Catalog informs extractor design
```
Given the completed catalog
When all documented pattern families are reviewed
Then the section extractor's heuristics cover every observed pattern family
And any uncovered pattern family is logged as a known gap with a follow-up issue
```

### Scenario 6: TOC deduplication
```
Given a filing with a table of contents listing all Item headings
When the section extractor processes the filing
Then each Item heading is detected exactly once (the actual heading, not the TOC entry)
And the detected heading's source offset points to the body section, not the TOC
```

---

## 2. Validation Tests — Catalog Completeness

### V1: Filing metadata completeness
For each filing entry in `html-patterns.md`:
- [ ] Company name, ticker, CIK, accession number, fiscal year present
- [ ] Filing URL or reference to local fixture present
- [ ] HTML pattern section is non-empty

### V2: Standard item coverage
For each filing entry:
- [ ] All standard 10-K Part I items documented (Items 1, 1A, 1B, 1C, 2, 3, 4)
- [ ] All standard 10-K Part II items documented (Items 5, 6, 7, 7A, 8, 9, 9A, 9B)
- [ ] All standard 10-K Part III items documented (Items 10, 11, 12, 13, 14)
- [ ] All standard 10-K Part IV items documented (Items 15, 16)
- [ ] Items not present in the filing are noted as absent (some filings omit certain items)

### V3: Pattern family diversity
- [ ] At least 3 distinct pattern families identified (e.g., semantic h-tags, styled divs, table-based, font-tag based)
- [ ] Pattern family summary table at the top of the catalog
- [ ] Each pattern family has at least 2 example filings

### V4: Cross-reference with spike observations
- [ ] Apple `div>span style="..."` pattern confirmed and documented
- [ ] Microsoft short "Item 1" + uppercase "ITEM 1B." patterns confirmed
- [ ] TOC duplication issue documented with examples
- [ ] Any new patterns not observed in spikes are highlighted

---

## 3. Integration Tests — Extractor vs. Catalog

These tests run the existing `section-extractor.ts` (from `spikes/diff-algorithm/`) against each filing fixture and measure detection accuracy.

### I1: Per-filing section detection accuracy

```typescript
// Pseudocode — to be implemented as vitest tests
describe('section extractor accuracy per filing', () => {
  for (const fixture of ALL_FIXTURES) {
    it(`detects >=80% of items in ${fixture.ticker}-${fixture.year}`, () => {
      const html = loadFixture(fixture.filename);
      const sections = extractSections(html);
      const detectedItems = sections.map(s => extractItemNumber(s.heading));
      const expectedItems = fixture.expectedItems; // from catalog
      const accuracy = detectedItems.filter(d => expectedItems.includes(d)).length / expectedItems.length;
      expect(accuracy).toBeGreaterThanOrEqual(0.80);
    });
  }
});
```

### I2: Section ID correctness
```
For each detected section:
  - The item ID matches the expected pattern (item-1, item-1a, etc.)
  - The heading text contains the expected Item label
  - The section's source offset is in the body (not TOC)
```

### I3: Source offset round-trip
```
For each detected section:
  - html.slice(section.startIndex, section.endIndex) contains the heading text
  - The slice does not span into the previous or next section
```

### I4: Cross-filing consistency
```
For filings from the same company across different years (AAPL, MSFT, JPM — FY2023 + FY2024):
  - The same set of items is detected (modulo known additions/removals)
  - Section ordering is consistent (Item 1 before Item 1A before Item 2, etc.)
  - Pattern family is consistent across years for the same filer
```

### I5: Aggregate accuracy gate
```
Across all fixtures:
  - Mean detection accuracy >= 80%
  - No single filing has detection accuracy < 60% (would indicate a pattern family gap)
  - Total items detected / total items expected >= 80%
```

---

## 4. E2E Tests

### E2E-1: Download-extract-verify pipeline
```
Given a filing accession number from the catalog
When the filing HTML is fetched (from fixture or EDGAR)
And sections are extracted using the section extractor
Then the detected items match the catalog's documented items for that filing
And the detection accuracy meets the >=80% threshold
```

### E2E-2: Pattern family coverage
```
Given at least one filing from each identified pattern family
When the section extractor processes all pattern-family representatives
Then each pattern family achieves >=80% detection accuracy independently
```

### E2E-3: New filing validation (stretch goal — follow-up task)
```
Given a newly downloaded filing not in the original catalog
When it is processed by the extractor
Then the results can be compared against a manual item listing
And the pattern family is identified and confirmed as covered or flagged as new
```
Note: This is a future-proofing test that requires manual effort per new filing. Out of scope for vda.13 catalog creation; tracked as follow-up work for ongoing validation.

---

## 5. Boundary Conditions

### B1: Filing structural edge cases
- **Very old filings (pre-2010)**: May use `<font>` tags, table-based layouts, or `<center>` elements for headings
- **Amendment filings (10-K/A)**: May have different structure, partial content, or reference original filing
- **Filings with missing TOC**: Some filings omit the table of contents; extractor should not depend on TOC presence
- **Filings with non-standard Item numbering**: Some filers use "ITEM 1" vs "Item 1" vs "Item 1." — all should match
- **iXBRL inline markup**: Most post-2020 filings use inline XBRL (`<ix:nonNumeric>`, `<ix:nonFraction>`) wrapping heading and content text. This is a normal structural convention, not an error. The section extractor must walk through `ix:*` elements transparently (htmlparser2 treats them as regular elements). The catalog should document which filings use iXBRL and whether `ix:*` tags wrap heading text.

### B2: Heading format variations
- **Uppercase only**: `ITEM 1A. RISK FACTORS`
- **Mixed case**: `Item 1A. Risk Factors`
- **With PART prefix**: `PART I — Item 1. Business`
- **Bare item number**: `Item 1` (no description text)
- **Item with period**: `Item 1.` (trailing period, no description)
- **Unicode dashes**: em-dash, en-dash, hyphen in headings

### B3: DOM nesting depth
- **Deeply nested headings**: `<div><div><div><p><b><span>Item 1...</span></b></p></div></div></div>`
- **Table-wrapped headings**: Headings inside `<td>` elements (common in older filings)
- **Headings split across elements**: `<b>Item </b><b>1A.</b> <b>Risk Factors</b>` — text split across sibling elements

### B4: Content between sections
- **Empty sections**: Filing lists an Item heading but has no content before the next heading
- **Very long sections**: Item 1A (Risk Factors) can be 50+ pages — extractor should handle without timeout
- **Sections with only tables**: Item 8 (Financial Statements) may contain only tables, no paragraphs

---

## 6. Error Conditions

### E1: Filing download failures
- **HTTP 404**: Filing removed or accession number invalid — skip gracefully, log warning
- **HTTP 429**: EDGAR rate limit — retry with backoff per `edgar-client.ts` design
- **HTTP 503**: EDGAR maintenance — retry with backoff
- **Network timeout**: Connection drops — fail with descriptive error
- **Corrupted response**: Truncated HTML — parser should not crash (htmlparser2 is tolerant)

### E2: Malformed HTML
- **Unclosed tags**: Common in SEC filings — htmlparser2 handles gracefully
- **Mismatched closing tags**: `<div><p>text</span></div>` — should not crash
- **Missing `<body>`**: Some filings lack proper document structure
- **Duplicate `<html>` tags**: Seen in some filing agent output

### E3: Unexpected content
- **Empty HTML**: Zero-length response — return empty sections array
- **Non-HTML content**: Binary or PDF content accidentally served — fail gracefully
- **Extremely large filings**: Some conglomerates have 500+ page 10-Ks — should process within 5s

---

## 7. Test Data — Filing Fixtures Needed

### Target: 12-15 filings from diverse filers

| # | Company | Ticker | Sector | Expected Pattern Family | Notes |
|---|---------|--------|--------|------------------------|-------|
| 1 | Apple Inc. | AAPL | Technology | `div>span style` | Existing spike fixture |
| 2 | Microsoft Corp. | MSFT | Technology | Mixed h-tags + uppercase | Existing spike fixture |
| 3 | JPMorgan Chase | JPM | Financials | Likely table-based | Large financial filer |
| 4 | Johnson & Johnson | JNJ | Healthcare | TBD | Established filer |
| 5 | ExxonMobil | XOM | Energy | TBD | Energy sector |
| 6 | Walmart | WMT | Consumer Staples | TBD | Retail sector |
| 7 | Berkshire Hathaway | BRK-B | Conglomerate/Insurance | TBD | Unique filing style, likely in-house |
| 8 | Amazon | AMZN | Technology | TBD | Large tech filer |
| 9 | UnitedHealth Group | UNH | Healthcare | TBD | Insurance sector |
| 10 | Procter & Gamble | PG | Consumer Staples | TBD | CPG sector |
| 11 | Chevron | CVX | Energy | TBD | Energy, different agent |
| 12 | Bank of America | BAC | Financials | TBD | Different bank template |

**Optional stretch (if unique patterns found):**

| 13 | Tesla | TSLA | Automotive/Energy | Similar to AAPL (Workiva)? | Existing fixture |
| 14 | Pfizer | PFE | Pharmaceuticals | TBD (Toppan Merrill) | Pharma sector |
| 15 | Meta Platforms | META | Technology | TBD | Recent IPO filer |

**Cross-year fixtures (for I4 cross-filing consistency tests):**

At least 3 companies should have both FY2023 and FY2024 fixtures to enable cross-year comparison. Suggested: AAPL, MSFT, JPM.

### Fixture storage convention
- **Location**: `libs/edgar-diff-lib/tests/integration/fixtures/`
- **Naming**: `10k-{ticker}-{year}.html` (e.g., `10k-jpm-2024.html`)
- **Metadata + ground truth**: `meta-10k-{ticker}-{year}.json` (single companion file per fixture)
- **Size**: Full filing HTML (typically 500KB-5MB each); git LFS for files >5 MB if needed
- **Git**: Committed to repo (per architecture doc section 8)
- **Simplified fixtures**: Existing `10k-aapl-2023.html` / `10k-tsla-2023.html` kept as-is for fast unit tests

### Combined metadata + ground truth format

Each fixture has a single companion `meta-10k-{ticker}-{year}.json` containing both filing metadata and expected items:

```json
{
  "ticker": "JPM",
  "year": 2024,
  "cik": "0000019617",
  "accessionNumber": "0000019617-24-XXXXXX",
  "filingDate": "2024-02-XX",
  "patternFamily": "table-based",
  "filingAgent": "Toppan Merrill",
  "hasTOC": true,
  "hasIXBRL": true,
  "expectedItems": [
    { "id": "item-1", "heading": "Item 1. Business" },
    { "id": "item-1a", "heading": "Item 1A. Risk Factors" }
  ]
}
```

### Ground truth creation process

1. The `analyze-headings.ts` script outputs a **draft** `meta-10k-{ticker}-{year}.json` per filing
2. A human reviews and corrects the draft (adds missing items, fixes false positives, confirms pattern family)
3. The corrected JSON becomes the committed ground truth
4. This avoids manual counting of 16-22 items per filing across 12+ filings

---

## 8. Accuracy Measurement Protocol

### Definition of "detection accuracy"
```
accuracy = (correctly detected items) / (total items present in filing)
```

A "correctly detected" item means:
1. The extractor returns a section with the correct item ID
2. The heading text matches the filing's actual heading (fuzzy: normalized comparison)
3. The section's source offset is in the body, not the TOC

### Reporting
After running all fixtures, produce a summary:
```
Filing           | Items Expected | Items Detected | Accuracy | Pattern Family
-----------------|---------------|----------------|----------|---------------
AAPL 2023        | 16            | 15             | 93.8%    | div>span style
MSFT 2023        | 16            | 14             | 87.5%    | mixed h-tags
JPM 2023         | 16            | 13             | 81.3%    | table-based
...
AGGREGATE        | 192           | 168            | 87.5%    | -
```

### Risk gate threshold
Per architecture doc section 6:
- If aggregate accuracy < 80%, the parser needs its own epic
- If any pattern family has < 60% accuracy, that family needs dedicated handling
- If > 3 distinct pattern families require special-case code, escalate complexity concern
