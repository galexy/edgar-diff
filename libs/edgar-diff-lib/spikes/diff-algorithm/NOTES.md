# Spike B / Prototype A: Jaro-Winkler + Patience Diff

## Summary

This prototype validates **section alignment via Jaro-Winkler similarity** and **paragraph-level patience diff** for comparing consecutive 10-K filings.

## Section Alignment Accuracy

### Apple (FY2023 → FY2024)
- **22/22 sections** extracted from both filings
- **100% alignment accuracy** — all 21 standard 10-K items correctly matched
- All similarities = 1.000 (identical headings between consecutive filings)
- All thresholds (0.6–0.9) produce identical results

### Microsoft (FY2023 → FY2024)
- **21 sections old, 22 sections new** — Item 1C (Cybersecurity) added in FY2024
- **100% alignment accuracy** — all 20 common items correctly matched
- Item 1C correctly identified as "added" (not present in FY2023)
- All similarities = 1.000 for matched sections

### Threshold Analysis

| Threshold | Apple Matched | MSFT Matched | Notes |
|-----------|---------------|--------------|-------|
| 0.60 | 22 | 21 | All match at every threshold |
| 0.70 | 22 | 21 | Same |
| 0.75 | 22 | 21 | Same |
| 0.80 | 22 | 21 | Same |
| 0.85 | 22 | 21 | Same |
| 0.90 | 22 | 21 | Same |

**Observation**: For consecutive filings from the same company, section headings are essentially identical. Jaro-Winkler doesn't differentiate between thresholds here. The algorithm would show more value when comparing across companies or when headings are reformatted.

**Recommendation**: Use **threshold 0.75** as default — it provides tolerance for minor heading variations while avoiding false positives. For cross-company comparison or historical filings with renamed sections, lower thresholds (0.6–0.7) may be needed.

## Paragraph Diff Quality

### Apple FY2023 → FY2024
- **911 total paragraphs** compared across 22 sections
- 438 unchanged (48.1%), 296 modified (32.5%), 94 added (10.3%), 83 removed (9.1%)
- High change rate in Risk Factors (40.9%) and MD&A (78.4%) — expected for annual updates
- Low change rate in boilerplate sections (Unresolved Staff Comments: 0%, Mine Safety: 33.3%)

### Microsoft FY2023 → FY2024
- **1,665 total paragraphs** compared across 21 sections
- 1,150 unchanged (69.1%), 284 modified (17.1%), 148 added (8.9%), 83 removed (5.0%)
- Microsoft filings are significantly larger (6.7–9.7 MB vs Apple's 1.5 MB)
- Item 7A (Quantitative Disclosures) has 917–962 paragraphs — mostly financial tables

### Word-Level Diff Quality
- Modified paragraphs correctly identify word-level changes (e.g., "iPhone 15" → "iPhone 16")
- Semantic changes are clearly visible (e.g., "cash flows" → "liquidity")
- Some noise from formatting changes (whitespace, special characters)

## Patience vs Myers Comparison

**Key finding**: For paragraph-level diffing of 10-K filings, patience and Myers algorithms produce **identical results** in all test cases.

| Metric | Apple (P) | Apple (M) | MSFT (P) | MSFT (M) |
|--------|-----------|-----------|----------|----------|
| Unchanged | 438 | 438 | 1,150 | 1,150 |
| Modified | 296 | 296 | 284 | 284 |
| Added | 94 | 94 | 148 | 148 |
| Removed | 83 | 83 | 83 | 83 |

**Why identical?** The `diff` npm package's `diffArrays` function uses the same algorithm for both modes. The patience algorithm variant (which anchors on unique lines) doesn't diverge from Myers when comparing paragraph-level text blocks, since paragraphs are generally unique within a section.

**Recommendation**: Use the default `diffArrays` (Myers). Patience diff adds no value at the paragraph granularity level. Patience may be more useful at the line level within paragraphs, but for section-to-section comparison, standard diff is sufficient.

## Performance Measurements

| Operation | Apple | Microsoft |
|-----------|-------|-----------|
| Section extraction | 75 ms | 255 ms |
| Section alignment | 1.9 ms | 0.7 ms |
| Paragraph diff (patience) | 60 ms | 99 ms |
| Paragraph diff (Myers) | 55 ms | 98 ms |
| **Total pipeline** | **191 ms** | **452 ms** |

All well under the **2,000 ms** target. Microsoft is slower due to larger file size (6.7–9.7 MB).

## Edge Cases and Failure Modes

### Discovered
1. **SEC URL format varies by filing agent** — filings filed through different agents (e.g., EDGAR Online vs direct) have different URL structures. Microsoft's filings are under accession `000095017024087843` not the CIK-based path.
2. **Heading format inconsistency** — Apple uses `Item 1.    Business` (with periods and spaces) while Microsoft uses both `Item 1` (short) and `ITEM 1B. UNRESOLVED STAFF COMMENTS` (uppercase full). The extractor handles both.
3. **Table of contents duplication** — Filings list all items in a TOC and again as actual headings. Strategy: take the last occurrence of each item number (works for both Apple and Microsoft).
4. **Item 1C is new** — Added in recent years for cybersecurity disclosure. Not present in older filings — correctly detected as "added" section.
5. **Large sections with tables** — Microsoft's Item 7A has 900+ paragraphs, mostly table cells extracted as separate paragraphs. A production implementation should handle table content differently.
6. **jaro-winkler library** returns 0 for empty string comparisons (not 1 as mathematically defined). Not a practical issue since headings are never empty.

### Not Tested
- Filings with significantly different structures (e.g., 10-K/A amendments)
- Very old filings with different HTML formatting
- Cross-company comparison (different section structures)
- Filings in XBRL inline format

## Production Recommendations

1. **Section alignment**: Jaro-Winkler with threshold 0.75 works perfectly for consecutive same-company filings. For broader use cases, consider also matching on item number extracted from headings as a primary key, with Jaro-Winkler as fallback for renamed/restructured sections.

2. **Paragraph diffing**: Standard Myers diff (`diffArrays`) is sufficient. No benefit from patience at paragraph granularity.

3. **Word-level diff**: `diffWords` from the `diff` package produces good results for showing inline changes within modified paragraphs.

4. **Table handling**: Need special treatment for sections dominated by financial tables. Current approach extracts table cells as individual paragraphs, creating noise.

5. **Normalization**: More aggressive paragraph normalization (stripping HTML entities, normalizing Unicode, removing page headers/footers) would reduce false "modified" detections.

6. **Performance**: Current approach is fast (<500ms per pair). No optimization needed for the diff algorithm itself. Main bottleneck would be filing download and parsing of very large filings.
