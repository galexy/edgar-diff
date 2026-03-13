# US-2.5: Paragraph Diff Highlighting — Test Plan

## Overview

US-2.5 injects `<ins>`/`<del>` highlight markup into original filing HTML at `SourceLocation` offsets from `StructuredDiff`. Word-level changes use `WordChange` offsets mapped back to HTML source positions via a DOM-based algorithm. The implementation must handle nested HTML tags gracefully and produce valid, accessible markup.

The test strategy splits into two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — verify DOM structure, semantic markup, offset mapping, and accessibility
2. **Visual validation** (Chrome DevTools MCP) — verify highlight colors, strikethrough rendering, and complex HTML edge cases (see `uat.md`)

### Architecture (aligned with implementation design)

The implementation extends `FilingContent` with optional `sectionDiffs` and `side` props (no new component). The highlight injection pipeline lives in `apps/web/src/lib/highlight-injector.ts` as pure functions that use browser DOM APIs:

- **`buildNormalizedMapping(container)`** — walks a DOM fragment, collects text pieces, simulates parser normalization, builds `charMap[normalizedPos] → (pieceIndex, charOffset)`
- **`injectWordHighlights(paragraphHtml, wordChanges, paragraphText)`** — parses paragraph HTML into DOM, maps WordChange text offsets to DOM text node positions, splits text nodes, wraps in `<ins>`/`<del>`, serializes back
- **`wrapParagraph(paragraphHtml, changeType)`** — wraps entire paragraph HTML in a block-level `<ins>` or `<del>`
- **`applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, side)`** — orchestrates per-paragraph highlight application within a section

These live in the web app (not the diff library) because they depend on browser DOM APIs. They are pure over HTML strings and testable in jsdom.

---

## 1. BDD Acceptance Criteria

### AC-1: Word-level added highlights (green)

```gherkin
Scenario: Added words in a modified paragraph are highlighted green
  Given a FilingContent with sectionDiffs containing a modified paragraph
  And the paragraph has WordChanges of type 'added'
  And side is "new"
  When the filing content is rendered
  Then the added text is wrapped in <ins class="diff-added">
```

### AC-2: Word-level removed highlights (red + strikethrough)

```gherkin
Scenario: Removed words in a modified paragraph are highlighted red with strikethrough
  Given a FilingContent with sectionDiffs containing a modified paragraph
  And the paragraph has WordChanges of type 'removed'
  And side is "old"
  When the filing content is rendered
  Then the removed text is wrapped in <del class="diff-removed">
```

### AC-3: Whole paragraph added (green background + border)

```gherkin
Scenario: An entirely new paragraph is highlighted with green background
  Given a FilingContent with sectionDiffs containing an 'added' paragraph
  And side is "new"
  When the filing content is rendered
  Then the paragraph HTML is wrapped in <ins class="diff-paragraph-added">
```

### AC-4: Whole paragraph removed (red background + border)

```gherkin
Scenario: A removed paragraph is highlighted with red background
  Given a FilingContent with sectionDiffs containing a 'removed' paragraph
  And side is "old"
  When the filing content is rendered
  Then the paragraph HTML is wrapped in <del class="diff-paragraph-removed">
```

### AC-5: Unchanged content renders unmodified

```gherkin
Scenario: Unchanged paragraphs render as original HTML
  Given a FilingContent with sectionDiffs containing 'unchanged' paragraphs
  When the filing content is rendered
  Then no <ins> or <del> elements are injected
```

### AC-6: Nested HTML tag handling (DOM-based splitting)

```gherkin
Scenario: Highlight spanning across HTML tags produces valid markup via DOM splitting
  Given original HTML with inline tags (e.g., "<p>The <b>quick brown</b> fox</p>")
  And a WordChange marking text that spans across tag boundaries
  When injectWordHighlights processes the paragraph
  Then each text node within the range gets its own <ins>/<del> wrapper
  And the output is valid HTML with no broken nesting
```

### AC-7: Multiple word changes in one paragraph

```gherkin
Scenario: Multiple non-contiguous changes in a single paragraph
  Given a paragraph with multiple WordChanges at different offsets
  And side is "old"
  When the filing content is rendered
  Then each change has its own <del> wrapper
  And unchanged text between changes has no wrapper
```

### AC-8: Side-specific WordChange filtering

```gherkin
Scenario: Old panel shows only removed changes, new panel shows only added changes
  Given a modified paragraph with both 'added' and 'removed' WordChanges
  When rendered with side="old"
  Then only <del> elements appear (for type='removed' changes)
  When rendered with side="new"
  Then only <ins> elements appear (for type='added' changes)
```

### AC-9: Backward compatibility

```gherkin
Scenario: FilingContent without sectionDiffs renders identically to before
  Given a FilingContent with document but no sectionDiffs prop
  When the filing content is rendered
  Then no <ins> or <del> elements appear
  And the output is identical to US-2.3 behavior
```

### AC-10: Moved paragraphs

```gherkin
Scenario: Moved paragraphs with word changes show word-level highlights
  Given a 'moved' paragraph with wordChanges
  When the filing content is rendered
  Then word-level highlights are applied (same as modified)

Scenario: Moved paragraphs without word changes render as unchanged
  Given a 'moved' paragraph without wordChanges
  When the filing content is rendered
  Then no highlights are applied
```

---

## 2. Unit Tests — `highlight-injector.ts`

File: `apps/web/src/lib/highlight-injector.test.ts`

### 2.1 `injectWordHighlights` — basic cases

| ID | Test | Rationale |
|----|------|-----------|
| IW-U1 | Wraps a removed word in `<del class="diff-removed">` | Happy path — single removal |
| IW-U2 | Wraps an added word in `<ins class="diff-added">` | Happy path — single addition |
| IW-U3 | Preserves surrounding HTML unchanged (no wrapper on non-changed text) | Precision — only changed text highlighted |
| IW-U4 | Returns original HTML when wordChanges array is empty | No-op boundary |

### 2.2 `injectWordHighlights` — multiple changes

| ID | Test | Rationale |
|----|------|-----------|
| IW-U5 | Multiple non-contiguous changes produce separate `<del>`/`<ins>` elements | Multiple changes in one paragraph |
| IW-U6 | Adjacent changes (no gap) produce separate wrappers | Boundary — no unchanged text between changes |

### 2.3 `injectWordHighlights` — nested HTML tags (DOM-based)

| ID | Test | Rationale |
|----|------|-----------|
| IW-U7 | Change spanning `<b>...</b>` boundary produces multiple `<del>` elements (split at tag boundary) | Core DOM-splitting behavior (AC-6) |
| IW-U8 | Change entirely within a nested tag produces single `<del>` inside that tag | No unnecessary splitting |
| IW-U9 | Deeply nested tags (`span > b > i`) — change spanning across `<i>` boundary | Multi-level nesting |
| IW-U10 | All original tags preserved in output after highlight injection | Non-destructive injection |

### 2.4 `injectWordHighlights` — HTML entities

| ID | Test | Rationale |
|----|------|-----------|
| IW-U11 | `&amp;` entity (1 char in text, decoded by DOM parser) — highlight wraps correctly | Entity handling |
| IW-U12 | `&lt;`/`&gt;` entities — highlight on entity character works | Entity edge case |
| IW-U13 | `&#160;` (NBSP) normalized to space by parser — offsets still align | NBSP normalization |

### 2.5 `injectWordHighlights` — `<br>` handling

| ID | Test | Rationale |
|----|------|-----------|
| IW-U14 | Change spanning across `<br>` — text wraps correctly, `<br>` preserved in output | `<br>` maps to space in normalized text |

### 2.6 `injectWordHighlights` — normalization sanity

| ID | Test | Rationale |
|----|------|-----------|
| IW-U15 | NBSP (`\u00a0`) in HTML is normalized to space — word change at correct offset | Parser normalization fidelity |
| IW-U16 | Multiple consecutive spaces collapsed to one — offset mapping accounts for collapse | Whitespace normalization |
| IW-U17 | Leading/trailing whitespace trimmed — offsets relative to trimmed text | Trim normalization |
| IW-U18 | Normalized text mismatch with paragraphText — returns original HTML as safety fallback | Data corruption resilience |

### 2.7 `wrapParagraph`

| ID | Test | Rationale |
|----|------|-----------|
| WP-U1 | Wraps HTML in `<ins class="diff-paragraph-added">` for added | Whole-paragraph addition |
| WP-U2 | Wraps HTML in `<del class="diff-paragraph-removed">` for removed | Whole-paragraph removal |
| WP-U3 | Wraps empty paragraph HTML without error | Empty paragraph boundary |

### 2.8 `applyHighlightsToSection`

| ID | Test | Rationale |
|----|------|-----------|
| AS-U1 | Added paragraph on new side gets `<ins class="diff-paragraph-added">` wrapping | Section-level orchestration |
| AS-U2 | Unchanged paragraphs pass through unmodified | No false positives |
| AS-U3 | Multiple paragraphs in section processed correctly (reverse offset order) | Multi-paragraph section |
| AS-U4 | `sectionOffset > 0` — absolute SourceLocation offsets converted to relative correctly | Non-zero section start |
| AS-U5 | WordChanges filtered by side: old shows only `removed`, new shows only `added` | Side-specific filtering (AC-8) |

---

## 3. Integration Tests — `FilingContent` with Highlights

File: `apps/web/src/components/FilingContent.test.tsx` (extends existing test file)

### 3.1 Backward compatibility

| ID | Test | Rationale |
|----|------|-----------|
| FC-I1 | `FilingContent` without `sectionDiffs` renders identically to US-2.3 (no highlights) | Backward compat (AC-9) |
| FC-I2 | Existing section slicing still works when `sectionDiffs` is undefined | No regression |

### 3.2 Whole-paragraph changes

| ID | Test | Rationale |
|----|------|-----------|
| FC-I3 | Added paragraph renders `<ins class="diff-paragraph-added">` with correct text content | Whole-paragraph add (AC-3) |
| FC-I4 | Removed paragraph renders `<del class="diff-paragraph-removed">` with correct text content | Whole-paragraph remove (AC-4) |
| FC-I5 | Unchanged paragraph has no `<ins>` or `<del>` elements | Unchanged passthrough (AC-5) |

### 3.3 Word-level changes

| ID | Test | Rationale |
|----|------|-----------|
| FC-I6 | Modified paragraph: only changed word wrapped in `<del>`, rest unwrapped | Word-level precision (AC-2) |
| FC-I7 | Word change spanning HTML tag boundary: multiple `<del>` elements, original tags preserved | Cross-tag DOM splitting (AC-6) |

### 3.4 Side filtering

| ID | Test | Rationale |
|----|------|-----------|
| FC-I8 | `side="old"` shows `<del>` for removed paragraphs, no `<ins>` | Old-side filtering |
| FC-I9 | `side="new"` shows `<ins>` for added paragraphs, no `<del>` | New-side filtering |
| FC-I10 | Added paragraph ignored on old side (no source location for old) | Side-specific sourceMapping |

### 3.5 Moved and reordered paragraphs

| ID | Test | Rationale |
|----|------|-----------|
| FC-I11 | Moved paragraph with wordChanges renders word-level highlights | Moved + modified (AC-10) |
| FC-I12 | Moved paragraph without wordChanges renders as unchanged (no highlights) | Moved without edit (AC-10) |
| FC-I13 | Reordered paragraph renders as unchanged (no highlights) | Reordered deferred to future story |

---

## 4. Boundary Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| BC-1 | Empty paragraph (`<p></p>`, 0-length text content) | Does not crash |
| BC-2 | Modified paragraph with empty wordChanges array `[]` | No word-level highlights injected; content still renders |
| BC-3 | Single-character word change (start=2, end=3) | Single character wrapped in `<del>`/`<ins>` |
| BC-4 | Change at very start of paragraph text (offset 0) | First word correctly wrapped |
| BC-5 | Change at very end of paragraph text (end = text.length) | Last word correctly wrapped |
| BC-6 | HTML entities in changed text (`&amp;`, `&lt;`) | Does not crash; entity text included in highlight |
| BC-7 | Deeply nested tags (`div > p > span > b > text`) with whole-paragraph removal | `<del>` present in output |
| BC-8 | Paragraph with only whitespace (`<p>   </p>`) | Does not crash |
| BC-9 | Section with 50+ paragraphs (all unchanged) | Does not crash; renders all paragraphs |

---

## 5. Error Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| EC-1 | WordChange end beyond paragraph text length (offset 999 on 5-char text) | Does not crash; clamped to valid range |
| EC-2 | SourceMapping start > HTML length (offset 9999) | Does not crash; paragraph skipped |
| EC-3 | Modified paragraph with `undefined` wordChanges | Does not crash; falls back to whole-paragraph neutral style |
| EC-4 | Inverted wordChange range (start > end) | Does not crash; change skipped after clamping |
| EC-5 | SectionDiff ID does not match any document section | Section renders unmodified (no highlights) |
| EC-6 | Empty sectionDiffs array | No highlights applied; content renders normally |
| EC-7 | Negative wordChange offsets (start = -5) | Does not crash; clamped to 0 |
| EC-8 | Paragraph sourceLocation outside section range | Does not crash; paragraph diff skipped |
| EC-9 | Style block mid-section shifts paragraph offsets after `stripStyleBlocks` | Does not crash; content still renders (highlight may misalign but no error) |

---

## 6. Accessibility Tests

| ID | Test | Rationale |
|----|------|-----------|
| A11Y-1 | Added content uses semantic `<ins>` element (not just a styled `<span>`) | Screen readers announce insertions |
| A11Y-2 | Removed content uses semantic `<del>` element (not just a styled `<span>`) | Screen readers announce deletions |
| A11Y-3 | Word-level `<ins>` has `diff-added` class (enables underline via CSS — non-color differentiation) | WCAG: not color-only |
| A11Y-4 | Word-level `<del>` has `diff-removed` class (enables strikethrough via CSS — non-color differentiation) | WCAG: not color-only |
| A11Y-5 | Paragraph-level `<ins>` has `diff-paragraph-added` class (block-level styling distinct from word-level) | Visual distinction between word and paragraph highlights |
| A11Y-6 | Highlight elements do not break heading hierarchy (section headings still queryable) | Structural integrity |
| A11Y-7 | Screen readers can distinguish additions from removals via `<ins>`/`<del>` semantics | Semantic differentiation |

---

## 7. Test Data Strategy

### Fixture helpers needed

| Helper | Purpose |
|--------|---------|
| `makeDoc(html, sections)` | Reuse from existing `FilingContent.test.tsx` — creates `StructuredDocument` |
| `makeSection(id, heading, start, end, blocks?)` | Extended to optionally include `Paragraph` blocks for word-level tests |
| `makeParagraph(text, start, end)` | New — creates `Paragraph` with valid source mapping |
| `makeParagraphDiff(changeType, old?, new?, wordChanges?)` | New — creates `ParagraphDiff` |
| `makeSectionDiff(id, heading, paragraphDiffs, changeType?)` | New — creates `SectionDiff` wrapping paragraph diffs |

### Sample HTML snippets for testing

| Name | HTML | Use case |
|------|------|----------|
| Plain text | `Hello world` | No-tag baseline |
| Simple paragraph | `<p>The quick brown fox jumps over the lazy dog</p>` | Basic paragraph |
| Bold paragraph | `<p>The <b>quick brown</b> fox</p>` | Cross-tag boundary |
| Nested tags | `<p>A <span><b>bold <i>italic</i></b></span> end</p>` | Deep nesting |
| Entities | `<p>Revenue &amp; growth &gt; 10%</p>` | Entity handling |
| Line breaks | `<p>Line one<br/>Line two</p>` | `<br>` as space in normalized text |
| Multi-paragraph | `<p>First.</p><p>Second.</p><p>Third.</p>` | Section with multiple paragraphs |
| Empty paragraph | `<p></p>` | Empty content boundary |

---

## 8. Test File Organization

```
apps/web/src/
  lib/
    highlight-injector.ts          # Pure functions: buildNormalizedMapping, injectWordHighlights,
                                   #   wrapParagraph, applyHighlightsToSection
    highlight-injector.test.ts     # Unit tests (IW-*, WP-*, AS-*)
  components/
    FilingContent.tsx              # Extended with sectionDiffs + side props
    FilingContent.test.tsx         # Integration tests (FC-I*) + existing US-2.3 tests
    highlight.css                  # Highlight CSS styles

.specs/us-2-5-paragraph-diff/
  test-plan.md                    # This file
  uat.md                          # Visual validation scenarios
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 9. Testing Limitations (jsdom)

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No CSS computed styles | Cannot verify green/red background colors | Verify CSS class presence; UAT for visual check |
| No text-decoration rendering | Cannot verify strikethrough/underline is visible | Verify CSS class; `<del>`/`<ins>` have browser defaults |
| No color contrast checking | Cannot verify WCAG AA compliance | UAT visual check + manual contrast ratio |
| No scroll behavior | Cannot verify highlights work with scrolled content | UAT scroll testing |

### What jsdom CAN verify (and we test thoroughly)

- `<ins>`/`<del>` elements exist in the DOM
- Correct CSS classes applied (`diff-added`, `diff-removed`, `diff-paragraph-added`, `diff-paragraph-removed`)
- Correct text content within highlight elements
- DOM-based splitting produces valid HTML (multiple wrappers at tag boundaries)
- Normalization mapping correctness (via `injectWordHighlights` output)
- Error resilience (bad offsets, missing data, mismatched text)
- Backward compatibility (no sectionDiffs = no highlights)
- Accessibility semantics (`<ins>` and `<del>` are meaningful to screen readers)
