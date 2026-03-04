# Prototype B: TF-IDF Content Similarity + Myers Paragraph Diff

## Summary

This spike validates an alternative diff approach using:
1. **TF-IDF cosine similarity** on section content for section alignment
2. **Myers diff** (via `diff` npm package) for paragraph-level differencing
3. **Patience diff** as a comparison algorithm

## Section Alignment Accuracy

### Apple FY2023 → FY2024
- **22/22** sections correctly extracted and matched
- Both heading-only and TF-IDF hybrid achieve **100% accuracy**
- Heading-only achieves perfect 1.000 similarity (headings are identical between years)
- TF-IDF content similarity ranges from 0.231 (Item 1C - Cybersecurity, new content added) to 1.000 (Item 1B, Item 9)

### Microsoft FY2023 → FY2024
- **21 old sections, 22 new sections** (Item 1C added in FY2024)
- **21/21** matching sections correctly aligned
- Item 1C correctly identified as a newly added section
- Both heading-only and TF-IDF hybrid achieve **100% accuracy**

### Key Finding: Heading-Only vs TF-IDF Hybrid

For standard 10-K filings with consistent Item numbering, **heading-only matching is sufficient and preferred**:
- Heading-only: 0.2–0.4ms per pair
- TF-IDF hybrid: 12–23ms per pair (~50× slower)
- Both achieve identical accuracy on these filings

**TF-IDF adds value when:**
- Sections are renamed between filings (e.g., "Description of Business" → "Business Overview")
- Section numbering changes (uncommon in 10-K but possible in other filing types)
- Filing format varies significantly between companies

**Recommendation:** Use heading matching as primary, fall back to TF-IDF for unmatched sections.

## Optimal Weight and Threshold Settings

### Weight Experiments (heading weight / content weight)

| Weights | Apple Matches | MSFT Matches | Notes |
|---------|--------------|--------------|-------|
| 0.0/1.0 | 21 | 21 | Content-only misses 1 Apple section |
| 0.2/0.8 | 22 | 21 | All matched |
| 0.4/0.6 | 22 | 21 | Default — all matched |
| 0.5/0.5 | 22 | 21 | All matched |
| 0.6/0.4 | 22 | 21 | All matched |
| 0.8/0.2 | 22 | 21 | All matched |
| 1.0/0.0 | 22 | 21 | Heading-only — all matched |

**Optimal settings:**
- `headingWeight: 0.4, contentWeight: 0.6` is a safe default
- Any weight with heading ≥ 0.2 achieves full accuracy on these filings
- Pure content-only (0.0/1.0) misses 1 section for Apple (Item 1C had very different content between years)
- **Threshold: 0.3** works well — all correct matches have similarity > 0.5

## Paragraph Diff Quality

### Myers vs Patience Comparison

For most sections, Myers and Patience produce **identical results**. Differences appear in large sections:

| Section | Myers (add/rm/mod) | Patience (add/rm/mod) |
|---------|--------------------|-----------------------|
| Apple Item 15 (Exhibits) | +26 -16 ~33 | +28 -18 ~32 |
| MSFT Item 1 (Business) | +108 -189 ~50 | +105 -186 ~59 |
| MSFT Item 8 (Financials) | +875 -833 ~447 | +1165 -1123 ~239 |

**Key observations:**
- **Myers** tends to produce more modifications (adjacent remove+add merged into modify) and fewer raw adds/removes
- **Patience** produces more raw adds/removes but fewer modifications — it anchors on unique lines, so it's better at preserving context
- For Item 8 (financial statements with many similar rows), Myers produces significantly more modifications (~447 vs ~239), suggesting it does better at recognizing line-level edits in tabular data
- **Recommendation: Myers is preferred** — it produces more meaningful "modified" paragraphs with word-level diffs, which is more useful for understanding what actually changed

### Change Rates by Section Type

**Low change sections** (<30%): Item 1B (Unresolved Staff Comments), Item 4 (Mine Safety), Item 9 (Changes/Disagreements), Item 7A (Quantitative Disclosures)
- These are boilerplate/reference sections that change minimally

**High change sections** (>70%): Item 1C (Cybersecurity — new requirement), Item 7 (MD&A), Item 8 (Financial Statements)
- These contain substantive year-over-year changes

**Noise sources:**
- Table data extracted as paragraphs creates many small changes (number updates)
- Financial statements (Item 8) have >70% change rate mostly from numerical updates
- Cross-reference text ("See Item X") changes frequently

## Performance Measurements

### Apple FY2023 → FY2024 (1.4–1.5 MB files)
| Stage | Time |
|-------|------|
| File load | 3ms |
| Section extraction | 90ms |
| Heading-only alignment | 0.4ms |
| TF-IDF hybrid alignment | 12ms |
| Myers diff (22 sections) | 61ms |
| Patience diff (22 sections) | 33ms |
| **Total pipeline** | **166ms** ✓ |

### Microsoft FY2023 → FY2024 (6.5–9.5 MB files)
| Stage | Time |
|-------|------|
| File load | 7ms |
| Section extraction | 269ms |
| Heading-only alignment | 0.2ms |
| TF-IDF hybrid alignment | 23ms |
| Myers diff (21 sections) | 328ms |
| Patience diff (21 sections) | 62ms |
| **Total pipeline** | **627ms** ✓ |

### TF-IDF Overhead
- TF-IDF alignment adds ~12-23ms vs ~0.2-0.4ms for heading-only
- This is 30-60× slower but still trivial (<25ms)
- The overhead scales with number of sections × average section length
- For the Microsoft filing (larger sections), TF-IDF takes ~23ms

### Scaling
- Microsoft's filing is ~6× larger than Apple's
- Pipeline scales roughly linearly: 627ms / 166ms ≈ 3.8× (sub-linear due to fixed overhead)
- Both are well within the <2000ms target

## Edge Cases and Failure Modes

### Discovered
1. **New sections** (Item 1C Cybersecurity): Correctly detected as "added" — TF-IDF shows low content similarity (0.231) with nearest match
2. **TOC vs content headings**: Parser finds headings in both TOC and body; deduplication picks the one with longer heading text (content section, not TOC link)
3. **Styled headings**: Apple uses `<span style="font-weight:bold">` instead of semantic h-tags — handled via style regex matching
4. **Table-heavy sections**: Item 8 produces many paragraph changes that are mostly number updates — may want semantic filtering in production
5. **Short boilerplate sections**: Item 6 "[Reserved]" has very little content, causing lower content similarity (0.729) but still matched correctly

### Potential Issues
1. **Non-standard filing formats**: Some filers may not use "Item X" headings consistently
2. **Inline tables**: Table rows extracted as separate paragraphs create noise
3. **Very large sections**: Item 8 (financial statements) can have 3000+ paragraphs — Myers diff handles this in ~300ms which is acceptable
4. **Identical paragraphs**: Financial boilerplate appears in multiple sections — could confuse patience diff's unique-line anchoring

## Recommendation for Production

### Architecture
1. **Two-phase alignment**:
   - Phase 1: Heading-only matching (fast, handles 95%+ of cases)
   - Phase 2: TF-IDF fallback for unmatched sections (handles renames, format changes)

2. **Myers diff as default**: Produces better modification detection with word-level diffs
   - Consider patience as an option for very large sections where unique-line anchoring helps

3. **Section extraction improvements needed**:
   - Better TOC filtering (structural analysis, not just text length)
   - Table-aware paragraph splitting (don't treat each row as a separate paragraph)
   - Sub-section detection (headings within sections)

### Dependencies
- `htmlparser2`: Already in use, fast (29-270ms for parse)
- `diff` package: Lightweight (28KB), well-maintained, provides both Myers and word-level diff
- TF-IDF: Implemented from scratch (~200 LOC), no external deps

### Performance Budget
- Target: <2s per filing pair
- Achieved: 166ms (Apple) / 627ms (Microsoft)
- **3-12× headroom** — sufficient for additional processing like table-aware diffing
