# SEC 10-K HTML Heading Pattern Catalog

Cataloged from 15 real 10-K filings downloaded from SEC EDGAR (March 2026).

## Summary of Pattern Families

| Family | Characteristics | Companies | Count |
|--------|----------------|-----------|-------|
| A: Workiva `div>span` (bold) | `<div><span style="font-weight:700">Item N. Title</span></div>` | AAPL, AMZN, BAC, CVX | 4 |
| B: DFIN `p>span` (bold, uppercase) | `<p><span style="font-weight:bold;font-size:12pt">ITEM N. TITLE</span></p>` | MSFT (2023/2024), BRK-B | 3 |
| C: Workiva `div>span` (larger font, no bold signal) | `<div><span style="font-size:12pt;font-weight:400">Item N. Title.</span></div>` | JPM (2023/2024), JNJ, PG | 4 |
| D: Workiva table-based (bold, uppercase) | `<td><span style="font-weight:700">ITEM N.</span></td><td><span>TITLE</span></td>` | WMT, XOM (2024), UNH | 3 |
| E: Legacy `font` tag (pre-iXBRL) | `<p><b><font style="font-size:11pt;text-transform:uppercase">ITEM N. TITLE</font></b></p>` | XOM (2012) | 1 |

**Total distinct families: 5** (4 modern + 1 legacy)

All modern filings (post-2020) use **inline styles only** -- no semantic CSS classes are used for heading identification. Zero filings use semantic `<h1>`-`<h6>` tags for Item headings. This is a critical finding: detection must rely on text content matching + style signals, not semantic HTML.

---

## Pattern Family Details

### Family A: Workiva `div>span` (bold)

**Structure:** `div > span` with `font-weight:700` on the span

**Companies:** AAPL (FY2024), AMZN (FY2024), BAC (FY2024), CVX (FY2024)

**Example HTML (Apple):**
```html
<div style="margin-top:12pt;padding-left:45pt;text-align:justify;text-indent:-45pt">
  <span style="color:#000000;font-family:'Helvetica',sans-serif;font-size:9pt;
               font-weight:700;line-height:120%">Item 1. Business</span>
</div>
```

**Example HTML (Amazon):**
```html
<td colspan="3" style="padding:2px 1pt;text-align:left;vertical-align:top">
  <span style="color:#000000;font-family:'Times New Roman',sans-serif;font-size:10pt;
               font-weight:700;line-height:120%">Item 1B.</span>
</td>
```

**Detection signals:**
- `font-weight:700` on the `<span>` element
- Text matches `/item\s+\d+[a-z]?/i`
- Headings are mixed case (not all-uppercase)
- Font size same as body text (9-10pt)
- iXBRL tags may wrap headings (AMZN notably wraps cybersecurity sections in `<ix:nonNumeric>`)

**Notes:**
- AMZN sometimes places headings inside `<td>` cells within layout tables
- BAC uses deeper nesting: `body > div > div > div > span`
- CVX cross-references "Item 406/407/408 of Regulation S-K" which are false positives (regulation references, not filing section headings)

---

### Family B: DFIN `p>span` (bold, uppercase)

**Structure:** `p > span` with `font-weight:bold` and uppercase text

**Companies:** MSFT (FY2023, FY2024), BRK-B (FY2024)

**Example HTML (Microsoft):**
```html
<p style="font-size:10pt;margin-top:9pt;font-family:Times New Roman;margin-bottom:0;
          text-align:center;" id="item_1_business">
  <span style="color:#000000;white-space:pre-wrap;font-weight:bold;font-size:12pt;
               font-family:Arial;min-width:fit-content;">ITEM 1. BUSINESS</span>
</p>
```

**Example HTML (Berkshire Hathaway):**
```html
<p style="font-size:10pt;margin-top:0;font-family:Times New Roman;margin-bottom:0;
          text-align:justify;" id="item_1a_risk_factors">
  <span style="color:#000000;white-space:pre-wrap;font-weight:bold;font-size:10pt;
               font-family:Times New Roman;font-variant:normal;">Item 1A. Risk Factors</span>
</p>
```

**Detection signals:**
- `font-weight:bold` on the `<span>` element
- MSFT uses ALL UPPERCASE text; BRK-B uses mixed case
- MSFT uses larger font-size (12pt vs 10pt body) and center alignment
- BRK-B has semantic `id` attributes on `<p>` elements (e.g., `id="item_1a_risk_factors"`)
- Both use `white-space:pre-wrap`

**Notes:**
- MSFT has very high false positive count (155 body matches) due to numerous cross-references to "Item 1", "Item 7" etc. in body text
- BRK-B headings are sometimes split across sibling `<span>` elements
- MSFT headings are split: `<span>ITEM </span><span>1. BUSINESS</span>`
- BRK-B uses `<ix:nonNumeric>` wrapper around some Item sections (Item 1C Cybersecurity)

---

### Family C: Workiva `div>span` (non-bold, larger font or distinct font-family)

**Structure:** `div > span` with `font-weight:400` -- headings distinguished by font-size or font-family only

**Companies:** JPM (FY2023, FY2024), JNJ (FY2024), PG (FY2024)

**Example HTML (JPMorgan Chase FY2024):**
```html
<div style="margin-bottom:6pt">
  <span style="color:#000000;font-family:'Sons',sans-serif;font-size:12pt;
               font-weight:400;line-height:120%">Item 1. Business.</span>
</div>
```

**Example HTML (Johnson & Johnson):**
```html
<div id="i4b4bd2fffa0147e7914e1841a5c21924_19">
  <span style="color:#000000;font-family:'Johnson Display',sans-serif;font-size:18pt;
               font-weight:700;line-height:120%">Item 1. Business</span>
</div>
```

**Example HTML (Procter & Gamble):**
```html
<div style="margin-bottom:3pt;margin-top:3pt;text-align:justify">
  <span style="color:#000000;font-family:'Times New Roman',serif;font-size:10pt;
               font-weight:400;line-height:115%">Item 1B. </span>
  <span style="color:#000000;font-family:'Times New Roman',serif;font-size:10pt;
               font-style:italic;font-weight:400;line-height:115%">Unresolved Staff Comments.</span>
</div>
```

**Detection signals:**
- **JPM:** `font-weight:400` (not bold), larger font-size (12pt vs 10pt body), custom font family ('Sons')
- **JNJ:** `font-weight:700` with very large font-size (18pt), custom font ('Johnson Display') -- actually bold but auto-detected as non-bold due to the heading appearing after the TOC boundary heuristic failed
- **PG:** `font-weight:400`, split across sibling `<span>` elements where the item title is in a separate italic span

**Notes:**
- JPM is the hardest to detect: no bold signal, no uppercase, no larger font -- only distinguishing feature is `font-size:12pt` vs 10pt body text
- PG exhibits split-element headings: "Item 1B. " and "Unresolved Staff Comments." are in separate `<span>` elements
- JNJ uses custom branded fonts ('Johnson Display' for headings, 'Johnson Text' for body)
- JPM changed filing agents between FY2023 (DFIN) and FY2024 (Workiva) but maintained the same heading pattern

---

### Family D: Workiva table-based layout (bold, uppercase)

**Structure:** Item number and title in separate `<td>` cells within a layout table

**Companies:** WMT (FY2024), XOM (FY2024), UNH (FY2024)

**Example HTML (Walmart):**
```html
<table style="border-collapse:collapse;display:inline-table;...">
  <tr>
    <td colspan="3" style="background-color:#ffffff;padding:2px 1pt;text-align:left;vertical-align:top">
      <span style="color:#000000;font-family:'Times New Roman',sans-serif;font-size:10pt;
                   font-weight:700;line-height:100%;text-decoration:underline">ITEM&#160;1.</span>
    </td>
    <td colspan="3" style="background-color:#ffffff;padding:2px 1pt;text-align:left;vertical-align:top">
      <span style="color:#000000;font-family:'Times New Roman',sans-serif;font-size:10pt;
                   font-weight:700;line-height:100%;text-decoration:underline">BUSINESS</span>
    </td>
  </tr>
</table>
```

**Example HTML (ExxonMobil FY2024):**
```html
<td colspan="3" style="border-bottom:1.5pt solid #0c479d;padding:2px 1pt;
                        text-align:justify;vertical-align:bottom">
  <span style="color:#0c479d;font-family:'Times New Roman',sans-serif;font-size:12pt;
               font-weight:700;line-height:120%">ITEM 1A. RISK FACTORS</span>
</td>
```

**Detection signals:**
- `font-weight:700` on `<span>` inside `<td>`
- ALL UPPERCASE text
- WMT splits "ITEM N." and "TITLE" across separate `<td>` cells
- XOM uses colored text (`#0c479d` blue) and larger font (12pt) with border decoration
- `text-decoration:underline` (WMT)

**Notes:**
- WMT's split-cell pattern is challenging: the extractor must join text from sibling `<td>` elements within the same `<tr>`
- XOM (2024) uses a visually styled table with colored borders, distinct from body tables
- UNH uses hyperlinked references extensively, making many body matches false positives from cross-references like "See Part I, Item 1A"
- WMT has the most TOC entries (66) relative to body headings (5), indicating an extensive multi-page TOC

---

### Family E: Legacy `font` tag (pre-iXBRL)

**Structure:** `p > b > font` with inline style

**Companies:** XOM (FY2012)

**Example HTML:**
```html
<p style="margin-bottom:.0001pt;margin-left:63.35pt;margin-right:0in;margin-top:0in;
          page-break-after:avoid;text-align:justify;text-indent:-63.35pt;">
  <b>
    <font face="Times New Roman,serif" lang="EN-US"
          style="font-size:11.0pt;text-transform:uppercase;">ITEM 1. BUSINESS</font>
  </b>
</p>
```

**Detection signals:**
- `<font>` element with `face` attribute
- Wrapped in `<b>` tag (HTML4-era bold)
- `text-transform:uppercase` in inline style
- `page-break-after:avoid` on containing `<p>`
- Uses `margin-left` + negative `text-indent` for hanging indent (legacy word processor style)
- No iXBRL markup
- `.0001pt` margins (Microsoft Word HTML export signature)

**Notes:**
- This is a pre-iXBRL filing (2013), representing legacy HTML patterns from Microsoft Word → HTML conversion
- The `font face` attribute and `lang` attribute are hallmarks of older filing tools
- 8.7 MB file size despite simpler content -- typical of MS Word HTML bloat
- Unknown filing agent (no identifiable agent signature)

---

## Per-Company Analysis

### Apple (AAPL) -- Workiva -- Family A

| Property | Value |
|----------|-------|
| Filing Agent | Workiva |
| Filing Year | FY2024 |
| File Size | 1.4 MB |
| Pattern Family | A (div>span, bold) |
| Has TOC | Yes |
| Has iXBRL | Yes |
| Heading Tag | `<span>` |
| Bold Signal | `font-weight:700` |
| Text Case | Mixed case |
| Font | Helvetica, 9pt |

**Item 1:** `<div><span style="font-weight:700">Item 1. Business</span></div>`
**Item 1A:** `<div><span style="font-weight:700">Item 1A. Risk Factors</span></div>`

Cleanest pattern. Headings are consistently `div>span` with `font-weight:700`. Body text uses `font-weight:400`. Clear differentiation.

---

### Microsoft (MSFT) -- DFIN -- Family B

| Property | FY2024 | FY2023 |
|----------|--------|--------|
| Filing Agent | DFIN | DFIN |
| File Size | 7.8 MB | 6.5 MB |
| Pattern Family | B | B |
| Has TOC | Yes | Yes |
| Heading Tag | `<span>` in `<p>` | `<span>` in `<p>` |
| Bold Signal | `font-weight:bold` | `font-weight:bold` |
| Text Case | UPPERCASE | UPPERCASE |
| Font | Arial, 12pt | Arial, 12pt |

**Item 1:** `<p id="item_1_business"><span style="font-weight:bold;font-size:12pt">ITEM 1. BUSINESS</span></p>`

Cross-year pattern is **stable**. Same structure FY2023 and FY2024. Notable: semantic `id` attributes on `<p>` elements (e.g., `id="item_1_business"`). Very high false positive rate (155-168 body matches) from cross-references.

**Split headings observed:** `<span>ITEM </span><span>1. BUSINESS</span>`

---

### Amazon (AMZN) -- Workiva -- Family A

| Property | Value |
|----------|-------|
| Filing Agent | Workiva |
| File Size | 1.8 MB |
| Pattern Family | A (variant: some headings in table cells) |
| Has TOC | Yes |
| Has iXBRL | Yes |
| Heading Tag | `<span>` (in `<div>` or `<td>`) |
| Bold Signal | `font-weight:700` |
| Text Case | Mixed case |

**Item 1B:** Inside `<td>` element (table-based layout for this heading)
**Item 1C:** Inside `<td>` element

Amazon uses Family A style but places some headings inside layout tables (`<td>` cells), making it a hybrid between Family A and Family D.

---

### JPMorgan Chase (JPM) -- DFIN/Workiva -- Family C

| Property | FY2024 | FY2023 |
|----------|--------|--------|
| Filing Agent | Workiva | DFIN |
| File Size | 12.3 MB | 12.6 MB |
| Pattern Family | C | C |
| Bold Signal | None (font-weight:400) | None (font-weight:400) |
| Font Size | 12pt (vs 10pt body) | 12pt (vs 10pt body) |
| Font Family | 'Sons' | 'Amplitude' |

**Item 1:** `<div><span style="font-size:12pt;font-weight:400">Item 1. Business.</span></div>`

Hardest pattern to detect. No bold, no uppercase, no special elements. Only distinguishing feature is slightly larger font-size (12pt vs 10pt). Changed agents between years but maintained pattern. Very few body headings detected (4-5) -- most matches are in cross-references, not section headings.

---

### Johnson & Johnson (JNJ) -- Workiva -- Family C

| Property | Value |
|----------|-------|
| Filing Agent | Workiva |
| File Size | 3.5 MB |
| Heading Tag | `<span>` in `<div>` |
| Bold Signal | `font-weight:700` |
| Font | 'Johnson Display', 18pt |
| Text Case | Mixed case |

**Item 1:** `<span style="font-family:'Johnson Display';font-size:18pt;font-weight:700">Item 1. Business</span>`

Uses branded custom font ('Johnson Display') and large font-size (18pt) for headings vs 'Johnson Text' 9pt for body. Actually has bold signal despite initial analysis grouping.

---

### ExxonMobil (XOM) -- Workiva/Unknown -- Family D (2024) / E (2012)

| Property | FY2024 | FY2012 |
|----------|--------|--------|
| Filing Agent | Workiva | Unknown |
| File Size | 5.7 MB | 8.7 MB |
| Pattern Family | D (table-based) | E (legacy font tag) |
| Bold Signal | `font-weight:700` | `<b>` tag |
| iXBRL | Yes | No |

Cross-era comparison shows dramatic pattern evolution from legacy `<font>` tags to modern inline-styled `<span>` elements in tables.

---

### Berkshire Hathaway (BRK-B) -- DFIN -- Family B

| Property | Value |
|----------|-------|
| Filing Agent | DFIN |
| File Size | 10.2 MB |
| Heading Tag | `<span>` in `<p>` |
| Bold Signal | `font-weight:bold` |
| Text Case | Mixed case |
| Has semantic IDs | Yes (`id="item_1a_risk_factors"`) |

Split headings observed. Uses semantic `id` attributes on `<p>` elements. Some headings wrapped in `<ix:nonNumeric>`.

---

### Walmart (WMT) -- Workiva -- Family D

| Property | Value |
|----------|-------|
| Filing Agent | Workiva |
| File Size | 2.2 MB |
| Heading Tag | `<span>` in `<td>` |
| Bold Signal | `font-weight:700` |
| Text Case | UPPERCASE |
| Text Decoration | Underline |

Most challenging split pattern: "ITEM 1." and "BUSINESS" in separate `<td>` cells. Uses `&#160;` (non-breaking space) between "ITEM" and number. Extensive TOC (66 entries vs 5 body headings).

---

### Procter & Gamble (PG) -- Workiva -- Family C

| Property | Value |
|----------|-------|
| Filing Agent | Workiva |
| File Size | 2.4 MB |
| Bold Signal | None (font-weight:400) |
| Text Case | Mixed case |
| Split headings | Yes (item number + italic title) |

Split-element pattern: `<span>Item 1B. </span><span style="font-style:italic">Unresolved Staff Comments.</span>`

---

### Bank of America (BAC) -- Workiva -- Family A

| Property | Value |
|----------|-------|
| Filing Agent | Workiva |
| File Size | 12.3 MB |
| Heading Tag | `<span>` in deeply nested `<div>` |
| Nesting | `body > div > div > div > span` |
| Bold Signal | `font-weight:700` (some headings) |
| Font | 'Franklin Gothic Book', 9pt |

Many matches are cross-references in body text, not section headings.

---

### UnitedHealth Group (UNH) -- Workiva -- Family D

| Property | Value |
|----------|-------|
| Filing Agent | Workiva |
| File Size | 2.7 MB |
| Heading Tag | `<span>` in `<div>` |
| Bold Signal | `font-weight:700` |
| Text Case | UPPERCASE |
| Many hyperlinked cross-refs | Yes |

High false positive rate from hyperlinked cross-references ("See Part I, Item 1A...").

---

### Chevron (CVX) -- Workiva -- Family A

| Property | Value |
|----------|-------|
| Filing Agent | Workiva |
| File Size | 5.7 MB |
| Heading Tag | `<span>` in `<div>` |
| Bold Signal | `font-weight:700` |
| Text Case | Mixed case |

False positives from "Item 406/407/408 of Regulation S-K" references (regulation items, not filing sections).

---

## Detection Heuristic Recommendations

### Signal Priority (ranked)

1. **Text content match** (required): `/item\s+\d+[a-z]?\b[\.\s]/i` -- must match to be considered
2. **Bold signal** (strong): `font-weight:bold`, `font-weight:700`, `font-weight:800`, `font-weight:900`, or ancestor `<b>`/`<strong>` tag
3. **Font-size differential** (strong): heading font-size > body font-size (catches Family C where JPM uses 12pt vs 10pt)
4. **Uppercase text** (moderate): all-caps text or `text-transform:uppercase`
5. **Semantic ID** (strong, rare): `id` attribute matching item pattern (e.g., `id="item_1_business"`)
6. **Position** (moderate): later occurrence = more likely to be the real heading (not TOC)
7. **Font-family change** (weak): different font-family from body text (JNJ 'Johnson Display', JPM 'Sons')

### Scoring Rubric Proposal

```
base_score = 0   (text matches item regex)
+ 3  if font-weight >= 700 or bold
+ 2  if font-size > body_font_size
+ 2  if text is all uppercase
+ 3  if element has semantic id matching item
+ 1  if text-align:center
+ 1  if text-decoration:underline
- 5  if inside <a> tag (likely cross-reference)
- 3  if text contains "see " or "refer to " (cross-reference)
- 2  if inside TOC region (first 20% of document by offset)
```

### TOC Deduplication Strategy

1. **Duplicate detection**: If an item appears multiple times, the **last** occurrence is the real heading
2. **Anchor detection**: If the match is inside `<a href="#...">`, it is a TOC link
3. **Offset heuristic**: Matches in the first 15-25% of the document (by byte offset) are likely TOC
4. **Page-break markers**: `page-break-before/after` or `<hr>` near a heading suggests body content (not TOC)

### Split-Element Handling

Split headings are common (observed in BRK-B, MSFT, PG, WMT, XOM-2024, UNH):

- **Sibling `<span>` splits**: `<span>Item </span><span>1A.</span> <span>Risk Factors</span>` -- handle by joining text of all children within the block parent
- **Sibling `<td>` splits** (WMT): `<td>ITEM 1.</td><td>BUSINESS</td>` -- handle by joining text of all `<td>` cells within the same `<tr>`
- **Item number + italic title** (PG): `<span>Item 1B. </span><span style="font-style:italic">Title</span>` -- handle same as sibling span splits

The section-extractor's text accumulation within a block parent should handle most split patterns. The `<td>` split requires special handling at the `<tr>` level.

### False Positive Mitigation

Major sources of false positives:

1. **Cross-references**: "See Item 1A, Risk Factors" in body text -- filter by checking for "see", "refer to", "described in" prefix
2. **Regulation references**: "Item 406 of Regulation S-K" -- filter by checking for "Regulation S-" suffix
3. **TOC entries**: Multiple TOC pages with hyperlinked items -- filter by anchor tag detection and position heuristic
4. **Footnotes/exhibits**: References in exhibits section -- filter by position (late in document)

---

## Risk Assessment

### Pattern Family Count: 5

Five distinct families were identified (4 modern + 1 legacy). This **exceeds the 3-family threshold** mentioned in the architecture doc for escalating the parser to its own epic.

However, the families share common traits that a single heuristic can handle:
- All use `<span>` as the heading text element (except legacy Family E using `<font>`)
- All headings match the `/item\s+\d+[a-z]?/i` text regex
- 12 of 15 filings have a bold signal (`font-weight:700` or `bold`)
- 8 of 15 use uppercase text

A scoring-based approach (text match + style signals) should cover all families without family-specific code paths.

### Estimated Detection Accuracy

| Family | Companies | Expected Accuracy | Risk |
|--------|-----------|-------------------|------|
| A: Workiva div>span (bold) | AAPL, AMZN, BAC, CVX | 95%+ | Low -- clear bold signal |
| B: DFIN p>span (bold, uppercase) | MSFT, BRK-B | 90%+ | Medium -- split headings, many false positives |
| C: Non-bold headings | JPM, JNJ, PG | 70-85% | High -- no bold signal, font-size only differentiator |
| D: Table-based | WMT, XOM-2024, UNH | 80-90% | Medium -- td-split headings need special handling |
| E: Legacy font tag | XOM-2012 | 85%+ | Low -- clear <font>/<b> signal |

### Overall Coverage Assessment

- **12/15 filings** (80%) should achieve >85% accuracy with text regex + bold scoring
- **3/15 filings** (JPM, JNJ, PG) require font-size differential detection for reliable heading identification
- **Aggregate estimate**: ~85% accuracy with current approach, potentially 90%+ with font-size scoring and split-element handling
- **Meets 80% threshold** specified in the PRD, but margin is thin

### Key Risks

1. **Family C (non-bold headings)** is the biggest risk. JPM headings have no visual differentiation except font-size. A font-size comparison between heading candidates and surrounding body text would significantly improve detection.

2. **Split-cell headings** (WMT) require `<tr>`-level text joining, which is not currently implemented in the section-extractor.

3. **False positive volume**: MSFT has 155+ body matches for the item regex. Without good scoring/filtering, precision will be low even if recall is high.

4. **TOC deduplication**: WMT has 66 TOC matches vs 5 body headings. The "take last occurrence" heuristic should work but needs validation.

### Recommendation

The current text-regex approach is viable as the **primary detection mechanism** across all families. Recommended enhancements to meet 80%+ accuracy consistently:

1. Add **bold signal scoring** (+3 for font-weight >= 700)
2. Add **font-size differential scoring** (+2 for larger than surrounding text) -- critical for Family C
3. Add **cross-reference filtering** (-5 for text inside `<a>` or preceded by "see/refer")
4. Add **`<tr>`-level text joining** for table-based headings (Family D)
5. Keep "last occurrence wins" for TOC deduplication

These are incremental improvements to the existing extractor, not a separate parser epic.
