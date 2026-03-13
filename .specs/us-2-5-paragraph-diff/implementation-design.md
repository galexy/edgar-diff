# US-2.5: Paragraph Diff Highlighting — Implementation Design

## Approach

Extend `FilingContent` with optional diff data to inject `<ins>`/`<del>` highlight markup into the original filing HTML before rendering via `dangerouslySetInnerHTML`. The highlight injection pipeline has two layers:

1. **Section-level processing** — For each section HTML slice, look up the corresponding `SectionDiff` by ID, then process each paragraph within that section.
2. **Paragraph-level processing** — For each paragraph, either wrap the whole thing (`added`/`removed`) or inject word-level highlights (`modified`/`moved`) using a DOM-based text-to-HTML offset mapping algorithm.

**Key design decisions:**

1. **Extend `FilingContent` instead of a new component** — Adding optional `sectionDiffs` and `side` props to `FilingContent` keeps section-slicing logic in one place and is backward-compatible (no diff data = renders as before). The test plan's `HighlightedFilingContent` scenarios map directly to `FilingContent` with these props.

2. **DOM-based highlight injection** — WordChange offsets are into normalized paragraph text, but we inject into raw HTML. Using `DOMParser`/`template.innerHTML` to parse paragraph HTML into a DOM tree, then wrapping text node ranges in `<ins>`/`<del>` elements, naturally handles nested HTML tags without producing invalid markup. String-based splicing would break HTML nesting when a highlight spans across tag boundaries (e.g., `<b>quick</b> brown` → naive splice produces `<b><del>quick</b> brown</del>` which is invalid).

3. **Pure-function core in `apps/web/src/lib/`** — The offset mapping and markup injection functions use browser DOM APIs (`template.innerHTML`, `TreeWalker`, `splitText()`). Since these require a DOM environment, they live in the web app (not the diff library) as rendering concerns. They're pure functions over HTML strings — easy to test in jsdom.

4. **Panel-specific rendering** — Each panel shows highlights relevant to its side:
   - Filing A (`side='old'`): `removed` whole-paragraphs (red), `removed` word changes (red+strikethrough)
   - Filing B (`side='new'`): `added` whole-paragraphs (green), `added` word changes (green)
   - Modified/moved paragraphs show only the word changes matching the panel's side

5. **Semantic HTML for accessibility** — `<ins>` for additions, `<del>` for removals. Both have built-in browser styling (underline / strikethrough) providing non-color-based differentiation per WCAG guidelines.

## Component Hierarchy

```
App
├── Header
├── SearchBar
└── <main>
    ├── SectionNav
    ├── FilingPanel (label="Filing A", document={oldDoc}, sectionDiffs={...}, side="old")
    │   └── FilingContent (document={oldDoc}, sectionDiffs={...}, side="old")
    │       ├── <section id="preamble">       ← no highlights (not in sectionDiffs)
    │       ├── <section id="item-1">         ← HTML with <del> highlights injected
    │       └── ...
    ├── Divider
    └── FilingPanel (label="Filing B", document={newDoc}, sectionDiffs={...}, side="new")
        └── FilingContent (document={newDoc}, sectionDiffs={...}, side="new")
            ├── <section id="preamble">
            ├── <section id="item-1">         ← HTML with <ins> highlights injected
            └── ...
```

## Files to Create

### `apps/web/src/lib/highlight-injector.ts`

Core pure functions for the highlight injection pipeline.

```typescript
import type { WordChange, ParagraphDiff, SectionDiff } from '@edgar-diff/lib';
import type { SourceLocation, Paragraph, FilingSection } from '@edgar-diff/lib';

type Side = 'old' | 'new';

/**
 * A normalized-text character mapped back to its DOM origin.
 * Used to convert WordChange text offsets into DOM text node positions.
 */
interface CharMapping {
  /** Index into the collected textPieces array */
  pieceIndex: number;
  /** Character offset within that text piece's content */
  charOffset: number;
}

/**
 * A piece of text extracted from the DOM during the walk.
 * Either a Text node's content or a synthetic space from a <br> element.
 */
interface TextPiece {
  type: 'text' | 'br';
  node: Node;
  content: string;
}

// ─── Normalized-Text-to-DOM Mapping ─────────────────────────────

/**
 * Build a mapping from normalized-text positions to DOM text node positions.
 *
 * Walks the DOM tree of a parsed paragraph, collecting text pieces (text nodes
 * and <br>-produced spaces). Then simulates the same normalization the parser
 * applies (NBSP → space, whitespace collapse, trim) while tracking which
 * normalized character maps to which (textPiece, charOffset) in the DOM.
 *
 * @param container - A DocumentFragment from parsing the paragraph HTML
 * @returns normalizedText, the char-to-DOM mapping, and the text pieces array
 */
function buildNormalizedMapping(container: DocumentFragment): {
  normalizedText: string;
  charMap: CharMapping[];
  pieces: TextPiece[];
} { /* ... */ }

// ─── Word-Level Highlight Injection ──────────────────────────────

/**
 * Inject <ins>/<del> highlights into a paragraph's HTML at WordChange offsets.
 *
 * @param paragraphHtml - Raw HTML string of the paragraph
 * @param wordChanges - Word-level changes relevant to this side (filtered)
 * @param paragraphText - The normalized paragraph text (Paragraph.text)
 * @returns Modified HTML string with <ins>/<del> elements injected
 */
export function injectWordHighlights(
  paragraphHtml: string,
  wordChanges: WordChange[],
  paragraphText: string,
): string { /* ... */ }

// ─── Whole-Paragraph Highlight Wrapping ──────────────────────────

/**
 * Wrap an entire paragraph's HTML in a block-level <ins> or <del>.
 *
 * @param paragraphHtml - Raw HTML of the paragraph
 * @param changeType - 'added' or 'removed'
 * @returns Wrapped HTML string
 */
export function wrapParagraph(
  paragraphHtml: string,
  changeType: 'added' | 'removed',
): string { /* ... */ }

// ─── Section-Level Highlight Application ─────────────────────────

/**
 * Apply all paragraph diff highlights to a section's HTML slice.
 *
 * For each ParagraphDiff in the SectionDiff:
 * - Locates the paragraph within the section HTML using SourceLocation offsets
 * - Applies whole-paragraph wrapping or word-level injection based on changeType
 * - Processes replacements in reverse offset order to preserve positions
 *
 * @param sectionHtml - The raw HTML slice for this section
 * @param sectionOffset - section.source.start (for converting absolute → relative offsets)
 * @param sectionDiff - The SectionDiff for this section
 * @param paragraphIndex - Pre-built map from "start:end" → Paragraph (for text lookup)
 * @param side - Which filing this panel represents
 * @returns Modified section HTML with highlights injected
 */
export function applyHighlightsToSection(
  sectionHtml: string,
  sectionOffset: number,
  sectionDiff: SectionDiff,
  paragraphIndex: Map<string, Paragraph>,
  side: Side,
): string { /* ... */ }
```

### `apps/web/src/lib/highlight-injector.test.ts`

Unit tests for the pure functions. Covers:
- Offset mapping with plain text, HTML tags, entities, `<br>`, nested tags
- Word-level injection with single/multiple/cross-tag-boundary changes
- Whole-paragraph wrapping
- Section-level application with multiple paragraphs
- Edge cases: empty paragraphs, whitespace-only, out-of-range offsets

### `apps/web/src/components/highlight.css`

CSS styles for diff highlights. Imported by `FilingContent.tsx`.

```css
/* ─── Word-level highlights ─────────────────────────── */

.filing-section ins.diff-added {
  background-color: #dcfce7; /* green-100 */
  text-decoration: underline;
  text-decoration-color: #16a34a; /* green-600 */
  text-underline-offset: 2px;
}

.filing-section del.diff-removed {
  background-color: #fee2e2; /* red-100 */
  text-decoration: line-through;
  text-decoration-color: #dc2626; /* red-600 */
}

/* ─── Whole-paragraph highlights ────────────────────── */

.filing-section ins.diff-paragraph-added {
  display: block;
  background-color: #f0fdf4; /* green-50 */
  border-left: 3px solid #16a34a; /* green-600 */
  padding-left: 4px;
  text-decoration: none; /* override <ins> default underline */
}

.filing-section del.diff-paragraph-removed {
  display: block;
  background-color: #fef2f2; /* red-50 */
  border-left: 3px solid #dc2626; /* red-600 */
  text-decoration: none; /* override <del> default strikethrough at block level */
}
```

**Rationale:**
- Scoped under `.filing-section` so highlights only apply within filing content (not the app shell).
- `display: block` on paragraph-level wrappers maintains block layout.
- `text-decoration: none` on paragraph-level wrappers prevents the entire block from being underlined/struck-through — only the text content carries the semantic styling.
- Word-level `<ins>` has green background + underline; word-level `<del>` has red background + strikethrough. Both provide non-color differentiation (underline vs. strikethrough) for accessibility.
- Colors use Tailwind's green-100/red-100 palette for background and green-600/red-600 for text decoration — sufficient contrast against white/light text backgrounds.

### `apps/web/src/fixtures/sample-diff.ts` (optional — may defer to US-2.6)

A hardcoded `StructuredDiff` fixture with pre-built paragraph diffs that match the existing `sampleDocument`. This enables visual validation of the highlight rendering before live diff data is wired up.

## Files to Modify

### `apps/web/src/components/FilingContent.tsx`

Add optional `sectionDiffs` and `side` props. When provided, apply highlights to section HTML slices before rendering.

```tsx
import type { StructuredDocument, SectionDiff, Paragraph } from '@edgar-diff/lib';
import { applyHighlightsToSection } from '../lib/highlight-injector';
import './filing-content.css';
import './highlight.css';

type Side = 'old' | 'new';

interface FilingContentProps {
  document: StructuredDocument;
  sectionDiffs?: SectionDiff[];  // NEW
  side?: Side;                    // NEW — required when sectionDiffs provided
}

/** Build a lookup map from "start:end" → Paragraph for O(1) text retrieval. */
function buildParagraphIndex(document: StructuredDocument): Map<string, Paragraph> {
  const index = new Map<string, Paragraph>();
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.type === 'paragraph') {
        index.set(`${block.source.start}:${block.source.end}`, block);
      }
    }
  }
  return index;
}

function sliceSections(
  document: StructuredDocument,
  sectionDiffs?: SectionDiff[],
  side?: Side,
): HtmlSection[] {
  const { filing, sections } = document;
  const html = filing.html ?? '';
  const result: HtmlSection[] = [];

  // Build diff lookup and paragraph index if diffs provided
  const diffMap = new Map(sectionDiffs?.map(sd => [sd.id, sd]) ?? []);
  const paragraphIndex = sectionDiffs ? buildParagraphIndex(document) : undefined;

  // Preamble (unchanged — no paragraph diffs apply to preamble)
  if (sections.length > 0 && sections[0].source.start > 0) {
    result.push({
      id: 'preamble',
      html: stripStyleBlocks(html.slice(0, sections[0].source.start)),
    });
  }

  for (const section of sections) {
    let sectionHtml = stripStyleBlocks(html.slice(section.source.start, section.source.end));

    // Apply highlights if diff data available for this section
    const sectionDiff = diffMap.get(section.id);
    if (sectionDiff && paragraphIndex && side) {
      sectionHtml = applyHighlightsToSection(
        sectionHtml,
        section.source.start,
        sectionDiff,
        paragraphIndex,
        side,
      );
    }

    result.push({ id: section.id, html: sectionHtml });
  }

  if (sections.length === 0 && html.length > 0) {
    result.push({ id: 'content', html: stripStyleBlocks(html) });
  }

  return result;
}
```

**Rationale:**
- Backward-compatible: without `sectionDiffs`, rendering is identical to US-2.3.
- The `buildParagraphIndex()` call is memoization-eligible if performance becomes a concern (React.useMemo). For now, it runs on each render — paragraphs are typically <100 per section, so the O(n) cost is negligible.
- Each section's HTML passes through `applyHighlightsToSection()` before `dangerouslySetInnerHTML`, keeping the rendering approach consistent with US-2.3.

### `apps/web/src/components/FilingPanel.tsx`

Add optional `sectionDiffs` and `side` props, pass through to `FilingContent`.

```tsx
interface FilingPanelProps {
  label: string;
  document?: StructuredDocument;
  sectionDiffs?: SectionDiff[];  // NEW
  side?: 'old' | 'new';          // NEW
}

export function FilingPanel({ label, document, sectionDiffs, side }: FilingPanelProps) {
  // ...existing render...
  {document ? (
    <FilingContent document={document} sectionDiffs={sectionDiffs} side={side} />
  ) : (
    <p>...</p>
  )}
}
```

### `apps/web/src/App.tsx`

Wire up diff data. For this story, either:
- Import a hardcoded `sampleDiff` fixture alongside the existing `sampleDocument`
- Or defer to US-2.6+ when live diff computation is integrated

```tsx
import { sampleDocument } from './fixtures/sample-filing';
import { sampleDiff } from './fixtures/sample-diff';  // NEW (if fixture approach)

<FilingPanel label="Filing A" document={sampleDocument} sectionDiffs={sampleDiff.sectionDiffs} side="old" />
<FilingPanel label="Filing B" document={sampleNewDocument} sectionDiffs={sampleDiff.sectionDiffs} side="new" />
```

### `apps/web/src/components/FilingContent.test.tsx`

Add test cases for highlight rendering. Add tests verifying:
- `<ins>` elements appear for added paragraphs when `side="new"`
- `<del>` elements appear for removed paragraphs when `side="old"`
- Word-level `<ins>`/`<del>` for modified paragraphs
- No `<ins>`/`<del>` for unchanged paragraphs
- Backward compatibility: no `sectionDiffs` = no highlights

## Interfaces and Types

### New type exports needed

No changes to the diff library types. All new types are internal to the web app.

### Props contracts

| Component | Props | Notes |
|-----------|-------|-------|
| `FilingPanel` | `{ label, document?, sectionDiffs?, side? }` | `sectionDiffs` + `side` optional |
| `FilingContent` | `{ document, sectionDiffs?, side? }` | When `sectionDiffs` provided, `side` required |

### Internal types (in `highlight-injector.ts`)

```typescript
type Side = 'old' | 'new';

/** A piece of text collected from the DOM walk. */
interface TextPiece {
  type: 'text' | 'br';
  node: Node;         // The DOM Text node, or <br> Element
  content: string;    // Text node data, or ' ' for <br>
}

/** Maps a normalized-text position to a DOM text piece location. */
interface CharMapping {
  pieceIndex: number;  // Index into TextPiece[]
  charOffset: number;  // Character offset within that piece
}
```

### Key library types consumed

| Type | From | Usage |
|------|------|-------|
| `SectionDiff` | `@edgar-diff/lib` | Per-section diff with `paragraphDiffs[]` |
| `ParagraphDiff` | `@edgar-diff/lib` | Per-paragraph changeType + wordChanges + sourceMapping |
| `WordChange` | `@edgar-diff/lib` | `{ type, start, end }` — offsets into normalized text |
| `SourceLocation` | `@edgar-diff/lib` | `{ start, end }` — offsets into filing HTML |
| `Paragraph` | `@edgar-diff/lib` | `{ text, source }` — normalized text + HTML location |

## Data Flow

```
StructuredDiff.sectionDiffs
        │
        ▼
  App.tsx passes sectionDiffs + side to each FilingPanel
        │
        ▼
  FilingPanel passes through to FilingContent
        │
        ▼
  FilingContent.sliceSections()
  ├── Builds diffMap: sectionId → SectionDiff
  ├── Builds paragraphIndex: "start:end" → Paragraph
  ├── For each section:
  │   ├── Slices section HTML (existing logic)
  │   ├── Looks up SectionDiff by section.id
  │   └── Calls applyHighlightsToSection()
  │       │
  │       ▼
  │   applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, side)
  │   ├── For each ParagraphDiff:
  │   │   ├── Get sourceLocation = sourceMapping[side]  (skip if null)
  │   │   ├── Compute relative offset within section slice
  │   │   ├── Extract paragraph HTML from section slice
  │   │   ├── Based on changeType:
  │   │   │   ├── 'added' (new side) → wrapParagraph(html, 'added')
  │   │   │   ├── 'removed' (old side) → wrapParagraph(html, 'removed')
  │   │   │   ├── 'modified'/'moved' → injectWordHighlights(html, filteredChanges, paraText)
  │   │   │   └── 'unchanged' → skip (no modification)
  │   │   └── Record replacement { start, end, html }
  │   └── Apply replacements in reverse offset order → modified section HTML
  │
  └── Renders each section via dangerouslySetInnerHTML={{ __html: modifiedHtml }}
```

### WordChange filtering per side

For `modified`/`moved` paragraphs, `wordChanges` contains both `added` and `removed` entries:

| Side | Filter | Tag | Meaning |
|------|--------|-----|---------|
| `old` | `wc.type === 'removed'` | `<del>` | Text present in old, absent in new |
| `new` | `wc.type === 'added'` | `<ins>` | Text present in new, absent in old |

This ensures Filing A shows what was deleted and Filing B shows what was inserted.

## Text-to-HTML Offset Mapping Algorithm

This is the hardest part of the implementation. WordChange offsets are into the **normalized** paragraph text (whitespace-collapsed, NBSP-replaced, trimmed), but we need to inject markup into the **raw HTML**. The mapping must account for HTML tags, entities, `<br>` elements, and whitespace normalization.

### Why DOM-based (not string-based)

A string-based approach (tracking an HTML cursor while walking text) can compute position mappings but fails at the **injection** step when a highlight spans across tag boundaries:

```html
Input:  <p>The <b>quick</b> brown fox</p>
Text:   "The quick brown fox"
Change: remove "quick brown" (text offsets 4–15)

String splice would produce INVALID HTML:
  <p>The <b><del>quick</b> brown</del> fox</p>
                        ↑ <del> crosses </b> boundary

DOM-based produces VALID HTML:
  <p>The <b><del>quick</del></b><del> brown</del> fox</p>
```

The DOM approach wraps text node ranges directly, so `<ins>`/`<del>` elements naturally nest within the existing DOM structure.

### Algorithm: `injectWordHighlights(paragraphHtml, wordChanges, paragraphText)`

```
Step 1: Parse paragraph HTML into DOM
────────────────────────────────────
  const template = document.createElement('template');
  template.innerHTML = paragraphHtml;
  const fragment = template.content;

Step 2: Walk DOM tree, collect text pieces
──────────────────────────────────────────
  Recursively walk fragment:
  - Text nodes → push { type: 'text', node, content: node.textContent }
  - <br> elements → push { type: 'br', node, content: ' ' }
  - Other elements → recurse into children
  Result: pieces[] — ordered list of text-contributing DOM nodes

Step 3: Simulate parser's text normalization, build position mapping
───────────────────────────────────────────────────────────────────
  Concatenate pieces into rawText.
  Walk rawText character-by-character, applying normalization:
    a. Replace U+00A0 (NBSP) with space
    b. Collapse consecutive whitespace to single space
    c. Trim leading/trailing whitespace

  For each character that survives normalization, record:
    charMap[normalizedPos] = { pieceIndex, charOffset }

  This gives us: normalizedText + charMap[]

  Verify: normalizedText === paragraphText (sanity check)

Step 4: For each WordChange, map text offsets to DOM positions
─────────────────────────────────────────────────────────────
  Sort wordChanges by start offset, process in REVERSE order
  (to preserve DOM positions when splitting text nodes).

  For each WordChange { type, start, end }:
    startMapping = charMap[start]    → (pieceIndex, charOffset)
    endMapping   = charMap[end]      → (pieceIndex, charOffset)
    // end uses charMap[end] as exclusive boundary; handle end-of-text sentinel

    If startMapping and endMapping are in the SAME text node:
      → Split text node twice: before start, after end
      → Wrap the middle text node in <ins>/<del>

    If they span MULTIPLE text nodes:
      → Split start text node at startOffset, wrap second half
      → For each complete text node in between, wrap entirely
      → Split end text node at endOffset, wrap first half

Step 5: Serialize modified DOM back to HTML
───────────────────────────────────────────
  const div = document.createElement('div');
  div.appendChild(fragment);
  return div.innerHTML;
```

### Text node wrapping helper

```typescript
function wrapRange(
  pieces: TextPiece[],
  charMap: CharMapping[],
  start: number,       // normalized text start (inclusive)
  end: number,         // normalized text end (exclusive)
  wrapperTag: 'ins' | 'del',
  className: string,
): void {
  const startMap = charMap[start];
  const endMap = charMap[Math.min(end, charMap.length - 1)];

  // Collect all text pieces between startMap.pieceIndex and endMap.pieceIndex
  for (let pi = startMap.pieceIndex; pi <= endMap.pieceIndex; pi++) {
    const piece = pieces[pi];
    if (piece.type !== 'text') continue; // skip <br> pieces

    const textNode = piece.node as Text;
    const sliceStart = (pi === startMap.pieceIndex) ? startMap.charOffset : 0;
    const sliceEnd = (pi === endMap.pieceIndex) ? endMap.charOffset : textNode.length;

    if (sliceStart >= sliceEnd) continue;

    // Split text node at boundaries
    let targetNode = textNode;
    if (sliceStart > 0) {
      targetNode = textNode.splitText(sliceStart);
    }
    if (sliceEnd < textNode.length) {
      targetNode.splitText(sliceEnd - sliceStart);
    }

    // Wrap in <ins>/<del>
    const wrapper = document.createElement(wrapperTag);
    wrapper.className = className;
    targetNode.parentNode!.insertBefore(wrapper, targetNode);
    wrapper.appendChild(targetNode);
  }
}
```

### Normalization matching

The mapping must exactly reproduce the parser's normalization:

| Parser step | Mapping equivalent |
|-------------|-------------------|
| `getTextContent(node)` — walks text nodes, `<br>` → space | DOM walk collecting text pieces |
| `.replace(/\u00a0/g, ' ')` | Replace NBSP with space during walk |
| `.replace(/\s+/g, ' ')` | Collapse consecutive whitespace |
| `.trim()` | Skip leading whitespace, remove trailing space |

The mapping reconstructs the same normalized text and verifies it matches `paragraphText`. If they don't match (data corruption), the function returns the original HTML unchanged as a safety fallback.

## Edge Cases

### 1. Highlight spanning nested tags

```html
Input:  <p>A <span class="x"><b>bold <i>italic</i></b></span> end</p>
Text:   "A bold italic end"
Change: remove "bold italic" (offsets 2–14)

DOM walk finds text nodes: ["A ", "bold ", "italic", " end"]
Pieces: [("A ", span 0), ("bold ", span 1), ("italic", span 2), (" end", span 3)]

Wrap pieces 1, 2:
  <b><del>bold </del><i><del>italic</del></i></b>
```

Each text node is wrapped independently within its parent — valid HTML guaranteed.

### 2. HTML entities

```html
Input:  <p>Revenue &amp; growth exceeded 10%</p>
Text:   "Revenue & growth exceeded 10%"
```

The DOM parser decodes `&amp;` into `&` in the text node. The text piece content will be `"Revenue & growth exceeded 10%"` — matching the normalized text. When serialized back to HTML, the browser re-encodes entities as needed.

### 3. `<br>` elements

```html
Input:  <p>Line one<br/>Line two</p>
Text:   "Line one Line two"  (parser maps <br> to space, then normalizes)
```

The DOM walk produces: `[("Line one", text), (" ", br), ("Line two", text)]`. The `<br>` piece maps to a single space in the normalized text. If a word change spans across a `<br>`, the `<br>` element itself is left in place — only the surrounding text nodes are wrapped.

### 4. Empty paragraphs

A paragraph with `text: ""` (empty after normalization) will have no word changes. `injectWordHighlights` returns the original HTML unchanged. For whole-paragraph wrapping, `wrapParagraph` still wraps it in `<ins>`/`<del>` (the element will be empty but present in the DOM).

### 5. Out-of-range offsets

If `WordChange.end > paragraphText.length` or `start < 0`, clamp to valid range `[0, paragraphText.length]`. If `start >= end` after clamping, skip the change. Log a warning in development.

### 6. Section with no matching SectionDiff

When `sectionDiff` is not found for a section ID, the section HTML passes through unmodified — identical to the no-diff rendering path.

### 7. Paragraph SourceLocation not found in section

If `paragraphDiff.sourceMapping[side]` falls outside the section's source range, skip that paragraph diff. This handles edge cases where diff data and document data are slightly misaligned.

### 8. Modified paragraph with missing `wordChanges`

If `changeType === 'modified'` but `wordChanges` is `undefined` or empty, fall back to whole-paragraph highlighting with a neutral "modified" style (light yellow background).

### 9. Style block stripping interaction

`stripStyleBlocks()` runs before highlight injection. This means the HTML offsets from `SourceLocation` may not align with the stripped HTML if style blocks appear within sections. However, the parser's `SourceLocation` offsets are computed from the original HTML, and style blocks in SEC filings appear in `<head>` (before any section), not within paragraph content. If a style block does appear mid-section, the offset adjustment would be the length of the stripped content — a concern to monitor but unlikely in practice.

**Mitigation:** Apply `stripStyleBlocks()` and adjust paragraph offsets by tracking cumulative removed length. If we encounter this in real filings, add offset adjustment logic. For now, rely on the invariant that style blocks precede section content.

### 10. Very large sections (1MB+)

The DOM parse + serialize cycle for each paragraph is lightweight (paragraph HTML is typically <1KB). The section-level string splicing processes paragraphs in reverse order with simple `slice()` operations. No performance concern expected for typical SEC filings (<5MB total, <50 paragraphs per section).

## CSS/Styling Approach

### Design tokens (mapped from Tailwind palette)

| Element | Background | Text decoration | Border |
|---------|-----------|-----------------|--------|
| Word added (`<ins>`) | green-100 `#dcfce7` | underline, green-600 `#16a34a` | — |
| Word removed (`<del>`) | red-100 `#fee2e2` | line-through, red-600 `#dc2626` | — |
| Paragraph added (`<ins>`) | green-50 `#f0fdf4` | none (block-level) | left 3px green-600 |
| Paragraph removed (`<del>`) | red-50 `#fef2f2` | none (block-level) | left 3px red-600 |

### Style isolation

All highlight styles are scoped under `.filing-section` to prevent interference with app chrome. The `all: initial` reset on `.filing-section` won't affect `<ins>`/`<del>` classes because they're defined after the reset in specificity order.

### Accessibility

- **Non-color differentiation:** `<ins>` renders with underline, `<del>` with strikethrough — distinguishable without color vision.
- **Semantic HTML:** Screen readers announce `<ins>` as "insertion" and `<del>` as "deletion" — no additional ARIA attributes needed.
- **Color contrast:** Green-100 background with dark text, red-100 background with dark text — both exceed WCAG AA 4.5:1 ratio for normal text.

## Open Questions

1. **Fixture strategy for visual testing** — Should we create a second `sampleDocument` (modified AAPL filing) and run the actual differ to produce `sampleDiff`? Or use a handcrafted `sampleDiff` fixture with synthetic changes? The former validates the full pipeline; the latter is simpler and decoupled from the diff engine. **Recommendation:** Handcrafted fixture for this story; full pipeline integration in US-2.6+.

2. **`moved` paragraph visualization** — The acceptance criteria don't explicitly specify how `moved` paragraphs should look. Options: (a) treat like `modified` (word-level highlights if text changed), (b) add a distinct "moved" indicator (e.g., arrow icon, blue border). **Recommendation:** (a) for this story — `moved` with `wordChanges` renders word-level highlights; `moved` without `wordChanges` renders unchanged. Defer distinct moved styling to a future story.

3. **`reordered` paragraph visualization** — `reordered` change type exists in the diff types but isn't addressed in the acceptance criteria. **Recommendation:** Render as unchanged for now; add reorder indicators in a future story.

4. **`stripStyleBlocks` offset alignment** — If a `<style>` block appears mid-section (unlikely in real filings), the paragraph offsets in the stripped HTML won't match `SourceLocation` from the original HTML. **Recommendation:** Monitor during UAT with real filings. If it occurs, add offset adjustment in `applyHighlightsToSection`.

5. **Performance with large diffs** — For sections with 50+ modified paragraphs, the DOM parse+serialize cycle runs per paragraph. Should we batch multiple paragraphs into a single DOM operation? **Recommendation:** Measure first. Likely not needed for SEC filing sizes.

## Implementation Checklist

1. Create `apps/web/src/lib/highlight-injector.ts` — pure functions: `buildNormalizedMapping`, `injectWordHighlights`, `wrapParagraph`, `applyHighlightsToSection`
2. Create `apps/web/src/lib/highlight-injector.test.ts` — unit tests for all pure functions
3. Create `apps/web/src/components/highlight.css` — diff highlight styles
4. Modify `apps/web/src/components/FilingContent.tsx` — add `sectionDiffs` + `side` props, call `applyHighlightsToSection` in `sliceSections`
5. Modify `apps/web/src/components/FilingPanel.tsx` — pass through `sectionDiffs` + `side` props
6. Add integration tests in `FilingContent.test.tsx` — component-level highlight rendering
7. Create `apps/web/src/fixtures/sample-diff.ts` — hardcoded diff fixture for visual validation
8. Modify `apps/web/src/App.tsx` — wire up diff fixture to both panels
9. Verify: `NX_OUTPUT_STYLE=stream pnpm nx run web:typecheck`
10. Verify: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`
11. Verify: `NX_OUTPUT_STYLE=stream pnpm nx run web:lint`
12. Verify: `NX_OUTPUT_STYLE=stream pnpm nx run web:build`
13. Visual verification via UAT with Chrome DevTools MCP
