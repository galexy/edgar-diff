# Test Plan: HTML Pattern Catalog (vda.13)

Story: edgar-diff-vda.13 — "Catalog HTML heading patterns from sample filings"

## 1. BDD Acceptance Criteria

### Catalog Completeness

```gherkin
Scenario: Catalog covers sufficient filing diversity
  Given the HTML pattern catalog has been created
  When I count the number of filings analyzed
  Then at least 10 distinct 10-K filings are documented
  And filings span at least 5 different companies

Scenario: Catalog covers all standard 10-K Item sections
  Given the catalog documents observed heading patterns
  When I check the Item sections referenced across all sample filings
  Then all 22 standard 10-K Item sections are represented
    | Part I    | Item 1    | Item 5    | Item 9A  | Item 13  |
    |           | Item 1A   | Item 6    | Item 9B  | Item 14  |
    |           | Item 1B   | Item 7    | Item 9C  | Item 15  |
    |           | Item 1C   | Item 7A   | Item 10  |          |
    |           | Item 2    | Item 8    | Item 11  |          |
    |           | Item 3    | Item 9    | Item 12  |          |
    |           | Item 4    |           |          |          |
  Note: Item 1C (Cybersecurity) mandated Dec 2023 — present in all 2024+ filings.
  Note: Item 9C (Disclosure Regarding Foreign Jurisdictions) — present in 2024+ filings.
  Note: Item 16 (Form 10-K Summary) is technically standard but
    universally omitted — its absence is acceptable.

Scenario: Catalog documents diverse pattern families
  Given filings were selected from diverse large-cap filers
  When heading patterns are documented per filing
  Then at least 4 distinct HTML pattern families are identified
    (Workiva, DFIN, Toppan Merrill, Broadridge/CompSci)
  And each pattern family is represented by at least 1 sample filing
  And the dominant pattern family (Workiva) documents intra-family
    variations (e.g., font differences across filers)
  And families with 2+ filings (Workiva, DFIN) document intra-family
    consistency or variation
  Note: Toppan Merrill and Broadridge/CompSci are rare among
    large-cap filers. 1 filing per minority agent is acceptable.

Scenario: Catalog includes temporal comparison
  Given the sample set includes the same company across multiple years
  When the Apple FY2022 and Apple FY2025 filings are compared
  Then the catalog documents any Workiva template evolution
  And notes whether heading patterns changed between versions
```

### Pattern Documentation Quality

```gherkin
Scenario: Each pattern family has complete documentation
  Given a pattern family entry in the catalog
  Then it documents:
    | field                | description                                      |
    | Element types        | Which HTML elements are used (h1-h4, p, div, etc) |
    | Inline styles        | Bold, uppercase, font-size, color patterns         |
    | CSS classes          | Class names applied to heading elements             |
    | Structural signals   | TOC presence, page breaks, anchor tags              |
    | Example HTML snippet | Actual HTML from a cited filing                     |
    | Filings using it     | List of accession numbers exhibiting this pattern   |

Scenario: Patterns are traceable to source filings
  Given a documented pattern in the catalog
  When I look up the cited accession number on EDGAR
  Then the cited filing exists
  And the HTML pattern appears in that filing's source HTML

Scenario: Catalog informs section-extractor heuristic design
  Given the completed catalog
  When the section-extractor is designed (architecture doc section 6, step 4)
  Then every heuristic weight (h-tag > bold > uppercase > plain) maps to
    at least one observed pattern family in the catalog
  And the catalog provides enough signal to rank heading detection strategies
```

## 2. Unit Tests (Analysis Script)

If a pattern analysis script is built to assist cataloging, these unit tests apply.

### HTML Element Detection

**Important finding**: No sampled 10-K filings use semantic h1-h6 tags for Item headings.
All observed filings use `<div>`, `<p>`, `<span>`, `<b>`, or `<font>` with inline styles.
Tests for h-tags are retained as defensive cases for robustness.

| Test Case | Input | Expected | Notes |
|---|---|---|---|
| Detects h1-h4 tags | `<h2>Item 1A. Risk Factors</h2>` | element_type: "h2" | Defensive: not observed in practice |
| Detects heading-like p tags | `<p style="font-weight:bold">ITEM 1.</p>` | element_type: "p", has_bold: true | Common (Workiva, DFIN) |
| Detects heading-like div tags | `<div style="text-align:center"><b>Item 7</b></div>` | element_type: "div", has_bold: true | Common (Workiva) |
| Detects font tags (legacy) | `<font style="font-weight:700">ITEM 1A</font>` | element_type: "font", has_bold: true | Observed (Toppan Merrill) |
| Detects span-wrapped headings | `<p><span style="font-size:12pt"><b>Item 2</b></span></p>` | element_type: "p", has_bold: true, font_size: "12pt" | Common (Workiva, DFIN) |
| Detects b-tag wrapped in div | `<div><b>ITEM 1A. RISK FACTORS</b></div>` | element_type: "div", has_bold: true | Common (Workiva) |
| Detects heading in table cell | `<td style="font-weight:bold">ITEM 1.</td>` | element_type: "td", has_bold: true | Broadridge/CompSci |
| Detects heading split across table cells | `<tr><td>ITEM 1.</td><td>BUSINESS</td></tr>` | concatenated text: "ITEM 1. BUSINESS" | Broadridge/CompSci |

### Inline Style Parsing

| Test Case | Input Style | Expected |
|---|---|---|
| Bold via font-weight:bold | `font-weight:bold` | bold: true |
| Bold via font-weight:700 | `font-weight:700` | bold: true |
| Uppercase via text-transform | `text-transform:uppercase` | uppercase: true |
| Uppercase via literal text | `ITEM 1A. RISK FACTORS` (all caps) | text_uppercase: true |
| Font-size extraction (pt) | `font-size:14pt` | font_size: "14pt" |
| Font-size extraction (px) | `font-size:18px` | font_size: "18px" |
| Multiple styles combined | `font-weight:bold;text-transform:uppercase;font-size:14pt` | bold: true, uppercase: true, font_size: "14pt" |
| No relevant styles | `color:black;margin:0` | bold: false, uppercase: false |

### CSS Class Extraction

| Test Case | Input | Expected |
|---|---|---|
| Single class | `<h2 class="heading">` | classes: ["heading"] |
| Multiple classes | `<p class="bold-heading section-title">` | classes: ["bold-heading", "section-title"] |
| No classes | `<p style="font-weight:bold">` | classes: [] |
| Agent-specific class names | `<div class="rom_10k_heading">` | classes: ["rom_10k_heading"] |
| Broadridge DSPFListTable class | `<table class="DSPFListTable">` | classes: ["DSPFListTable"] |
| Broadridge heading table detection | `<table class="DSPFListTable"><tr><td>ITEM 1.</td>...` | Recognized as heading container via class |

### Section Heading Text Normalization

| Test Case | Input | Expected |
|---|---|---|
| Standard heading | `Item 1A. Risk Factors` | `item-1a` |
| Uppercase | `ITEM 1A. RISK FACTORS` | `item-1a` |
| Title case | `Item 1. Business` | `item-1` |
| Extra whitespace | `Item   1A.   Risk  Factors` | `item-1a` |
| No period | `Item 1A Risk Factors` | `item-1a` |
| With non-breaking spaces | `Item\u00a01A.\u00a0Risk Factors` | `item-1a` |
| With `&#160;` entities | `Item&#160;1A.&#160;Risk Factors` (decoded) | `item-1a` |
| Trailing period in heading | `Item 1. Business.` | `item-1` |
| Custom suffix | `Item 1. Business Description` | `item-1` |
| Trailing content | `Item 7. Management's Discussion and Analysis of Financial Condition` | `item-7` |
| Smart quotes | `Item 7. Management\u2019s Discussion` | `item-7` |
| Part headings | `PART I` | `part-i` |
| Part heading lowercase | `Part II` | `part-ii` |
| Item 1C (Cybersecurity) | `Item 1C. Cybersecurity` | `item-1c` |
| Item 9C (Foreign Jurisdictions) | `Item 9C. Disclosure Regarding Foreign Jurisdictions` | `item-9c` |
| Item 6 reserved | `Item 6. [Reserved]` | `item-6` |

### Text Concatenation from Split Spans

| Test Case | Input | Expected |
|---|---|---|
| Heading split across sibling spans | `<p><span>ITEM 1. B</span><span>USINESS</span></p>` | text: "ITEM 1. BUSINESS" |
| Heading with intervening whitespace spans | `<p><span>Item </span><span>1A.</span><span> Risk Factors</span></p>` | text: "Item 1A. Risk Factors" |
| Single span (no split) | `<p><span>Item 1. Business</span></p>` | text: "Item 1. Business" |

### XBRL Tag Handling

| Test Case | Input | Expected |
|---|---|---|
| Heading wrapped in ix:nonNumeric | `<ix:nonNumeric contextRef="c-1"><b>Item 1A. Risk Factors</b></ix:nonNumeric>` | Heading detected, XBRL tags transparent |
| Nested XBRL wrapping | `<div><ix:nonNumeric><span>Item 7</span></ix:nonNumeric></div>` | Heading detected through XBRL layer |
| XBRL around non-heading text | `<ix:nonNumeric>See Item 1A for details</ix:nonNumeric>` | Not classified as heading (inline reference) |

### Entity and Special Character Normalization

| Test Case | Input | Expected |
|---|---|---|
| Non-breaking space `&#160;` | `Item&#160;1A.` | Normalized to regular space |
| Zero-width space `&#8203;` | `Item\u200B 1A.` | Zero-width space stripped |
| Right single quote `&#8217;` | `Management\u2019s` | Preserved in text, normalized for ID |
| Smart double quotes | `\u201CRisk Factors\u201D` | Preserved in text |
| Invisible spacer elements | `<font style="visibility:hidden">&#8203;</font>` | Stripped entirely |

### Structural Signal Detection

| Test Case | Input | Expected |
|---|---|---|
| TOC link detected | `<a href="#item1a">Item 1A</a>` | is_toc_link: true |
| Body heading with named anchor | `<a name="item1a"></a><p><b>Item 1A</b></p>` | is_toc_link: false, has_named_anchor: true |
| Broadridge anchor with comment | `<a name="ITEM1.BUSINESS"><!--Anchor--></a>` | is_toc_link: false, has_named_anchor: true |
| Body heading with id attribute | `<div id="item1a"><b>Item 1A</b></div>` | is_toc_link: false |
| Page break before heading | `<hr style="page-break-before:always">` followed by heading | has_page_break: true |
| CSS break-before | `<div style="break-before:page">` before heading | has_page_break: true |
| Horizontal rule separator | `<hr>` before heading | has_hr_separator: true |

### Heading Classification (TOC vs Body vs Reference)

| Test Case | Input | Expected Classification |
|---|---|---|
| TOC entry with href | `<a href="#item1a">Item 1A. Risk Factors</a>` | toc |
| TOC entry in table | `<td><a href="#item1a">Item 1A</a></td>` | toc |
| Body heading (bold, standalone) | `<p style="font-weight:bold">Item 1A. Risk Factors</p>` | body-heading |
| Body heading (h2 tag) | `<h2>Item 1A. Risk Factors</h2>` | body-heading |
| Inline reference | `<p>For details, see Part II, Item 7.</p>` | reference |
| Cross-reference in paragraph | `<p>As described in Item 1A above, the risks include...</p>` | reference |

## 3. Integration Tests

### Analysis Script Against Known Fixture

```
Test: analyze_fixture_produces_expected_output
  Given a fixture file containing a known 10-K HTML snippet with:
    - 2 div+b headings (Items 1, 1A)
    - 2 bold-p headings (Items 7, 7A)
    - 1 span-with-inline-style heading (Item 8)
    - 1 TOC entry (Item 1, with <a href>)
    - 1 inline reference ("see Item 7")
  When the analysis script processes this fixture
  Then the output contains exactly 5 body-heading matches
  And 1 toc match and 1 reference match
  And each heading has: element_type, styles, classes, normalized_id, raw_text, classification
  Note: fixture uses realistic element types (no h-tags) per research findings
```

### Catalog Format Validation

```
Test: catalog_markdown_is_well_formed
  Given the completed html-patterns.md catalog
  When parsed as markdown
  Then it contains:
    - A metadata/summary section listing all analyzed filings
    - A filing agent identification section (HTML comment signatures)
    - A pattern families section with at least 4 subsections
      (Workiva, DFIN, Toppan Merrill, Broadridge/CompSci)
    - Each pattern family subsection contains:
      - Description of the pattern
      - HTML element types used
      - Inline style characteristics
      - CSS class names (if any — notably Broadridge uses classes, others don't)
      - At least one HTML code block with an example snippet
      - List of accession numbers exhibiting this pattern
    - A Part-level heading patterns section
    - A Risk Gate Assessment section (4 families > threshold of 3)
    - A coverage matrix mapping Item sections to pattern families
```

### End-to-End Pattern Detection

```
Test: real_filing_pattern_detection
  Given a real 10-K filing HTML (committed as a test fixture)
  When the analysis script processes it
  Then detected headings match manually-verified headings for that filing
  And no false positives (non-heading elements incorrectly flagged)
  And no false negatives (actual headings missed)
```

## 4. Validation Tests (Research Task Specific)

These validate the catalog deliverable itself, not just the tooling.

### Catalog Completeness

| Check | Criteria | Pass Condition |
|---|---|---|
| Filing count | Number of distinct filings analyzed | >= 10 |
| Company diversity | Number of distinct filers (by CIK) | >= 5 |
| Industry diversity | Sectors represented | >= 3 |
| Item coverage | All 22 standard 10-K Items seen across filings | All Items including 1C and 9C |
| Item 1C presence | Item 1C (Cybersecurity) in 2024+ filings | Present in all 2024+ sample filings |
| Item 9C presence | Item 9C (Foreign Jurisdictions) in 2024+ filings | Present in all 2024+ sample filings |
| Item 16 handling | Form 10-K Summary | Noted as universally omitted (acceptable) |
| Year spread | Filing years represented | >= 3 distinct years (2022, 2025, 2026) |
| Temporal pair | Same company compared across years | Apple FY2022 vs FY2025 documented |

### Catalog Diversity

| Check | Criteria | Pass Condition |
|---|---|---|
| Pattern families | Distinct filing agent pattern families | >= 4 (Workiva, DFIN, Toppan Merrill, Broadridge/CompSci) |
| Workiva sub-variations | Intra-Workiva pattern differences documented | >= 2 distinct Workiva sub-patterns |
| Element type variety | Different HTML elements used for headings | >= 4 (div, p, span, b, font, td) |
| Filing agent spread | Filings from different HTML generation tools | Workiva (10), DFIN (2), Broadridge (1), Toppan Merrill (1) |
| CSS class usage | CSS classes documented per agent | Broadridge uses classes; others use inline styles only |
| No semantic h-tags finding | Documented that h1-h6 not observed | Explicitly noted in catalog |
| Table-based headings | Broadridge/CompSci table pattern documented | DSPFListTable pattern with td-split text |

### Pattern Accuracy (Spot-Check)

For each documented pattern family, verify at least 1 instance (2 preferred where sample size allows):

```
Test: pattern_exists_in_cited_filing
  For each pattern family P in the catalog:
    For at least 1 cited accession number A:
      Given accession number A is fetchable from EDGAR
      When I retrieve the filing HTML
      Then the HTML contains elements matching pattern P's description
      And the element text matches a standard 10-K Item heading
  Note: For Workiva (dominant family), spot-check at least 2 sub-variations.
        For DFIN (2 filings), verify both cited filings.
        For Toppan Merrill and Broadridge/CompSci (1 each), verify the single cited filing.
```

### Cross-Reference Integrity

```
Test: all_patterns_map_to_filings
  Given the catalog
  When I check each pattern family
  Then every pattern cites at least one real accession number
  And every cited accession number appears in the filing list

Test: all_filings_map_to_patterns
  Given the catalog
  When I check each analyzed filing
  Then at least one pattern family is attributed to it
```

### Risk Gate Validation

```
Test: risk_gate_assessment
  Given the catalog documents 4 distinct pattern families
  And the architecture doc section 6 threshold is 3
  Then the catalog includes an explicit Risk Gate Assessment section
  And the assessment evaluates whether a single heuristic approach
    can achieve >= 80% section detection accuracy across all 4 families
  And documents universal signals shared across families
    (e.g., bold text + ITEM \d regex as common denominators)
  And provides a clear recommendation: proceed with single heuristic
    vs. escalate parser to its own epic
  Per architecture doc section 6 and PRD parser risk signals
```

## 5. Boundary Conditions

| Condition | Test Approach | Expected Behavior |
|---|---|---|
| Filing uses no standard h-tags | Include at least 1 fixture where all headings use styled `<p>` or `<div>` (e.g., Workiva filings) | Analysis script still detects headings via style signals; catalog documents this pattern family |
| Filing uses tables for heading layout (Broadridge) | Fixture with headings inside `<table class="DSPFListTable"><td>` cells (Broadridge/CompSci) | Script detects table-based headings; distinguishes from TOC tables via CSS class or structural context |
| TOC links confused with section headings | Fixture with `<a href="#item1a">Item 1A</a>` in TOC region | Script distinguishes TOC links from actual section headings using classification heuristics |
| Very large filing (>1MB HTML) | Test with at least 1 large real filing (JPMorgan ~12MB, BofA ~10MB) | Analysis completes without timeout or memory issues; document processing time recorded |
| Filing with multiple heading styles mixed | Fixture using h2 for some Items, bold-p for others in same document | All heading styles detected; catalog notes intra-filing style mixing |
| Empty or minimal filing | Fixture with valid HTML but no recognizable Item headings | Script produces empty or warning output; does not crash |
| Heading text split across multiple spans | DFIN-style filing where "ITEM 1. B" and "USINESS" are in separate `<span>` elements | Script concatenates sibling span text before pattern matching |
| XBRL inline markup wrapping headings | Filing with `<ix:nonNumeric>` wrapping heading content | Script sees through XBRL tags to detect heading text |
| Item 6 [Reserved] present | Filing that includes "Item 6. [Reserved]" as a heading with no content | Heading detected and normalized to `item-6`; noted as reserved |
| Item 6 [Reserved] absent | Filing that omits Item 6 entirely | No error; catalog notes this variation |
| Entity-encoded characters in headings | Filing with `&#160;`, `&#8217;`, `&#8203;` in heading text | Characters normalized correctly for pattern matching |
| Invisible spacer elements | Toppan Merrill-style `<font style="visibility:hidden">&#8203;</font>` spacers | Spacers stripped; heading text extracted cleanly |
| Custom font families | JPMorgan-style custom web fonts in headings | Font family recorded but does not affect heading detection |

## 6. Error Conditions

| Condition | Test Approach | Expected Behavior |
|---|---|---|
| Filing not found (404) | Attempt to fetch a non-existent accession number | Graceful error message; script continues with remaining filings |
| EDGAR rate limit (429) | Simulate or document handling of 429 response | Script respects rate limits per architecture doc section 7 |
| Malformed HTML | Fixture with unclosed tags, missing quotes on attributes | htmlparser2 handles gracefully (lenient parser); script does not crash |
| Character encoding (UTF-8) | Fixture with multi-byte characters (accented names, em-dashes) | Characters preserved correctly in extracted heading text |
| Character encoding (Latin-1) | Fixture with Latin-1 encoded content | Script handles or documents encoding detection approach |
| Network timeout | Simulate slow EDGAR response | Script has configurable timeout; fails gracefully |

## 7. Test Data & Fixtures

### Fixture Strategy

Fixtures live in the repo for reproducibility. Two categories:

#### Small Synthetic Fixtures (for unit tests)

Location: `libs/edgar-diff-lib/tests/unit/fixtures/` (or inline in test files per architecture doc section 8)

- **heading-htag.html**: Minimal HTML with h1-h4 section headings
- **heading-bold-p.html**: Headings via `<p style="font-weight:bold">`
- **heading-uppercase.html**: Headings via all-caps text in styled elements
- **heading-div-styled.html**: Headings via `<div>` with inline styles
- **heading-font-tag.html**: Legacy `<font>` tag headings
- **heading-mixed.html**: Single document with mixed heading styles
- **heading-in-table.html**: Headings nested inside layout tables
- **heading-table-based.html**: Broadridge/CompSci-style headings inside `<table class="DSPFListTable">` with text split across `<td>` cells
- **heading-split-spans.html**: Heading text split across sibling `<span>` elements (DFIN-style)
- **heading-xbrl-wrapped.html**: Heading content wrapped in `<ix:nonNumeric>` tags
- **heading-item6-reserved.html**: Filing with "Item 6. [Reserved]" present
- **toc-with-links.html**: Table of contents with anchor links to Items
- **toc-and-body.html**: Full filing snippet with both TOC entries and body headings for the same Items (tests classification)
- **inline-references.html**: Paragraph text containing "see Item 7" and similar cross-references (should not be detected as headings)
- **entity-encoded.html**: Headings with `&#160;`, `&#8217;`, `&#8203;` and smart quotes
- **invisible-spacers.html**: Toppan Merrill-style `<font style="visibility:hidden">&#8203;</font>` spacer elements
- **malformed.html**: Unclosed tags, missing attribute quotes
- **encoding-utf8.html**: Multi-byte characters in headings
- **encoding-latin1.html**: Latin-1 encoded heading text

Each fixture should be:
- Under 100 lines of HTML
- Self-contained (no external CSS/JS dependencies)
- Annotated with a comment at the top describing what it tests

#### Real Filing Fixtures (for integration tests)

Location: `libs/edgar-diff-lib/tests/integration/fixtures/`

Per architecture doc section 8, naming convention: `{formtype}-{ticker}-{year}.html`

Select filings to ensure coverage of:
- All 4 distinct HTML pattern families (Workiva, DFIN, Broadridge/CompSci, Toppan Merrill)
- At least 2 filing years
- At least 5 different companies
- At least 1 filing > 500KB

Store truncated excerpts for large filings. Truncation rules:
- Keep HTML valid (close all open tags)
- Preserve `<head>` and any XBRL namespace declarations in the document header
- Capture at least Part I completely (Items 1 through 4) — this covers the most common heading patterns
- Include the TOC section if present
- Add a comment at the truncation point: `<!-- TRUNCATED FOR FIXTURE: original accession {number}, original size {X}MB -->`
- Target fixture size: under 500KB per file

### Filing Selection Criteria

When selecting the 10-15 sample filings for the catalog:

1. **Large-cap diversity**: Include companies from different sectors (tech, finance, healthcare, industrial, consumer)
2. **Filing agent diversity**: Select filings that visually appear to use different HTML templates
3. **Temporal diversity**: Primarily 2025-2026 filings; optionally include 1-2 older filings (2022-2023) to document pattern evolution if feasible
4. **Structural diversity**: Include filings with and without TOCs, varying nesting depths, different page-break conventions

### Fixture Reference Document

The catalog itself (`html-patterns.md`) should include a table mapping each analyzed filing to:
- Company name and ticker
- CIK and accession number
- Filing date
- Approximate HTML size
- Pattern family classification
- Any notable structural quirks

This table serves as the source-of-truth cross-reference for validation tests.

## 8. Test Execution Plan

### Phase 1: During Cataloging (Manual)
- As each filing is analyzed, manually verify heading detection against the actual HTML
- Document any patterns that don't fit existing categories

### Phase 2: After Catalog Complete (Automated)
- Run catalog validation checks (completeness, diversity, cross-references)
- Run analysis script unit tests (if script was built)
- Run integration tests against fixture files

### Phase 3: Downstream (After Section-Extractor Design)
- Verify section-extractor heuristics reference the catalog
- Confirm heuristic weights align with observed pattern frequencies
- Run section-extractor against catalog fixtures to measure accuracy
