# Spike A2: linkedom + String Scanning Source Mapping

**Date:** 2026-03-04
**Approach:** Parse HTML with linkedom, map DOM elements back to original source positions via string scanning with a pre-built tag index.

## Summary

| Metric | Value |
|--------|-------|
| Match rate (Apple 10-K) | 99.97% (14,776 / 14,780) |
| Exact matches | 4,702 (31.8%) |
| Fuzzy matches | 10,074 (68.1%) |
| Failed matches | 4 (0.03%) |
| Parse + map time | ~600ms |
| linkedom parse alone | ~60ms |
| Total elements | 14,780 |
| Sections found | 5/5 (Item 1, 1A, 7, 7A, 8) |

## (a) linkedom HTML Normalization — Impact on String Matching

linkedom normalizes HTML in several ways that break exact string matching:

| Normalization | Example | Impact |
|---------------|---------|--------|
| **Whitespace collapse** | `<div  class="x"  >` → `<div class="x">` | Extra spaces in tag removed |
| **Quote normalization** | `class='test'` → `class="test"` | Single quotes → double quotes |
| **Tag case lowering** | `<DIV>` → `<div>` | Uppercase tags lowered in outerHTML |
| **Self-closing removal** | `<td style="..."/>` → `<td style="..."></td>` | Self-closing converted to open+close |
| **Void element normalization** | `<br/>` → `<br>` | Self-closing syntax stripped |
| **Trailing space in tags** | `<img src="x" >` → `<img src="x">` | Trailing whitespace removed |

**Attribute order is preserved** — this is critical and means attribute-based matching works.
**Entity encoding is preserved** — `&amp;` stays as `&amp;`.

The high normalization rate (68.1% fuzzy) means the **majority of SEC filing elements cannot be matched by exact string comparison**. This is a fundamental limitation of the DOM-then-search approach.

## (b) Deduplication Strategy and Reliability

**Strategy:** Per-signature cursor tracking.

Each unique combination of tag name + attribute values gets its own cursor that advances through the pre-built index of tag positions. When multiple identical elements exist (e.g., `<td style="width:1%"/>` repeated 100x), the cursor advances sequentially so each DOM node maps to the next occurrence in the source.

**Reliability:**
- Works correctly for all 50-duplicate stress tests
- Works correctly for the Apple 10-K (thousands of duplicate `<td>` cells)
- Depends on DOM tree walk order matching source order — this holds for linkedom's depth-first traversal
- **Risk:** If linkedom ever reorders sibling elements, cursors would desync. No evidence of this.

## (c) Cases Where outerHTML Reconstruction Fails

1. **Exotic XBRL axis tags** with dots in names: `us-gaap:revenueremainingperformanceobligationexpectedtimingofsatisfactionstartdateaxis.domain` — 4 elements failed. The tag name contains `.domain` which the regex-based index doesn't handle. Fixable but marginal.

2. **HTML comments** — linkedom does not expose comment nodes in the DOM tree. Comments are invisible to the element walker. This means we cannot map `<!-- ... -->` positions. For SEC filings, this is usually not important.

3. **Fragment parsing** — When HTML lacks `<html><body>` wrapping, linkedom treats the first element as documentElement and may drop siblings. Full documents (like SEC filings) are unaffected.

4. **Text-only nodes** — Only element nodes are mapped. Text between elements is not independently tracked (it's included in parent element's charLength).

## (d) Character vs. Byte Behavior

All offsets are **JavaScript string character offsets** (UTF-16 code units). This means:
- ASCII characters: 1 offset unit = 1 byte
- Accented chars (é, ü): 1 offset unit = 2-3 bytes in UTF-8
- CJK characters: 1 offset unit = 3 bytes in UTF-8
- Emoji (🚀, 🔥): **2 offset units** = 4 bytes in UTF-8 (surrogate pairs)

This matches JavaScript's native `String.prototype.indexOf` behavior. For byte-offset needs (e.g., Range headers, file seeking), a separate char-to-byte mapping would be needed.

**Verified:** Tests confirm multi-byte characters (emoji, CJK, accented) produce correct character offsets.

## (e) Parse Time Measurements

| Phase | Time |
|-------|------|
| linkedom `parseHTML()` | 60ms |
| Tag index build (regex scan of 1.5MB) | 1.3ms |
| `querySelectorAll('*')` | 4.4ms |
| outerHTML generation (14,780 elements) | 77ms |
| Full pipeline (parse + index + walk + match) | **~600ms** |

The bottleneck is **attribute signature building and comparison** during the walk phase (~450ms). The tag index eliminates the need for expensive `indexOf` on the full HTML string (which takes 1.3s naively).

**Warm run performance** (after JIT): ~580ms. Cold: ~610ms. Relatively stable.

This is above the ideal 500ms target but reasonable for a 1.5MB, 14,780-element document.

## (f) API Complexity Comparison vs. htmlparser2

| Aspect | linkedom + string scan | htmlparser2 (SAX) |
|--------|----------------------|-------------------|
| **Source positions** | Requires manual reconstruction | Built-in `startIndex`/`endIndex` |
| **DOM access** | Full W3C DOM API (querySelector, etc.) | Must build DOM manually or use domhandler |
| **Normalization risk** | High (68% fuzzy rate) | None — SAX events reflect original source |
| **Performance** | ~600ms (parse + scan) | Expected ~200ms (single pass) |
| **Code complexity** | ~250 LOC (index builder + walker + fuzzy) | ~100 LOC (SAX handler + offset recording) |
| **Correctness guarantee** | 99.97% | 100% (positions are inherent) |
| **Comment handling** | Cannot map comments | Full access to comments |

htmlparser2's SAX approach is fundamentally simpler for source mapping because **positions are a byproduct of parsing, not a reconstruction effort**.

## (g) Limitations and Risks

### Critical Limitations

1. **Normalization is pervasive** — 68% of elements in a real SEC filing require fuzzy matching. This fuzzy matching is correct but adds complexity and fragility.

2. **Performance ceiling** — 600ms for a single filing is workable but doesn't leave headroom. A filing 2-3x larger could exceed 1.5s. The tag index helps but the fundamental cost is outerHTML generation + attribute comparison for each element.

3. **Closing tag search is naive** — For fuzzy-matched elements, finding the closing tag uses simple `indexOf` which can be fooled by nested same-name tags (though the depth-tracking approach handles common cases).

### Moderate Risks

4. **linkedom version sensitivity** — Normalization behavior could change between versions, silently breaking fuzzy matching patterns.

5. **XBRL coverage** — 4 elements with exotic tag names failed. More unusual XBRL schemas could increase this.

6. **No streaming support** — Must load entire HTML into memory twice (original string + DOM).

### Minor Issues

7. **No character-to-byte offset conversion** built in.
8. **HTML comments are invisible** to the mapper.

## (h) Conclusion: Viability for Production

### Verdict: **Viable but suboptimal**

The linkedom + string scanning approach **works** — 99.97% match rate on a real Apple 10-K filing with all 5 section boundaries correctly identified. The tag index optimization brings performance to an acceptable ~600ms.

However, this approach is **fundamentally a workaround**. We're parsing HTML into a DOM, then reverse-engineering the original source positions from the normalized DOM output. This creates:

- **Inherent complexity** from the fuzzy matching layer
- **Fragility** from depending on linkedom's specific normalization behavior
- **A correctness gap** that can never reach 100% (some elements will always be ambiguous)
- **Higher performance cost** than approaches that capture positions during parsing

**Recommendation:** If htmlparser2 (Spike A1) provides built-in source positions, it should be preferred. This linkedom approach is a **viable fallback** if:
- Full W3C DOM API is needed for section detection logic
- htmlparser2's source position handling proves unreliable
- A hybrid approach (htmlparser2 for positions, linkedom for DOM queries) is too complex

The code is production-quality enough to ship if needed, but the 68% fuzzy match rate is a maintainability concern for long-term reliability.
