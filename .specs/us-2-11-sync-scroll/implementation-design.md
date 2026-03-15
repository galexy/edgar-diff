# US-2.11: Synchronized Scrolling — Implementation Design (v3)

## 1. Approach: Content-Aligned Scroll Sync via Anchor Maps

### Why v1 and v2 Failed

**v1** used section-snapping via `scrollIntoView`: an `IntersectionObserver` detected the most-visible section and called `scrollIntoView({ block: 'start' })` on the matching section in the other panel. Result: huge jumps — panels showed the same section but at completely different scroll positions.

**v2** used proportional section-based alignment: computed a 0→1 ratio within the current section and mapped it to the same ratio in the other panel. Smoother than v1, but **fundamentally wrong**. If a section has 10 paragraphs in the old filing and 20 in the new (due to additions), 50% through the old section maps to paragraph 5, but 50% through the new section maps to paragraph 10 — completely different content. Proportional mapping ignores content correspondence.

### v3: Content-Aligned Mapping via Diff Data

v3 uses **diff data as a correspondence table** between documents. The diff engine already computed which paragraphs and tables correspond between old and new filings. v3 reuses these mappings to build **anchor points** — DOM elements that exist in both panels with known correspondence — and uses binary search + linear interpolation to translate scroll positions.

**Key advantages over v2:**
- **Content-aware**: Aligns actual corresponding content, not proportional positions
- **Uses diff data**: Reuses the correspondence already computed by the diff engine
- **Precise at changes**: Modified paragraphs are anchor points, so content around changes (where users focus) is precisely aligned
- **Graceful degradation**: Falls back to section-level alignment when no block-level anchors exist (sufficient for unchanged sections with identical content)

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ Render Pipeline (one-time per data change)          │
│                                                     │
│  FilingContent → applyHighlightsToSection            │
│       ↓ injects data-block-key="sectionId:pd:N"    │
│  <section> elements with annotated changed blocks   │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│ Scroll Sync (per scroll event, behind rAF)          │
│                                                     │
│  1. measureElements(panel) × 2                      │
│     → queries sections + [data-block-key] elements  │
│     → reads positions via getBoundingClientRect      │
│     → returns Map<key, absoluteY>                   │
│                                                     │
│  2. computeAnchors(oldPositions, newPositions)       │
│     → matches keys across panels                    │
│     → returns sorted Anchor[]                       │
│                                                     │
│  3. translatePosition(anchors, scrollTop, direction) │
│     → binary search for bracketing anchors          │
│     → linear interpolation                          │
│     → returns target scrollTop                      │
│                                                     │
│  4. targetPanel.scrollTop = result                  │
└─────────────────────────────────────────────────────┘
```

## 3. DOM Annotation

### Strategy

Inject `data-block-key` attributes into changed paragraph and table elements during the existing highlight-injection pass in `applyHighlightsToSection`. Only blocks with counterparts in **both** panels are annotated (i.e., `sourceMapping` has both `old` and `new`), since only those can serve as anchor points.

Section boundaries use the existing `<section id="...">` elements — no extra annotation needed.

### Key Format

```
data-block-key="{sectionId}:{blockType}:{diffIndex}"
```

- `blockType`: `pd` for paragraph diff, `td` for table diff
- `diffIndex`: zero-based index within `sectionDiff.paragraphDiffs` or `sectionDiff.tableDiffs`

Examples:
- `data-block-key="item-1a:pd:0"` — first paragraph diff in section "item-1a"
- `data-block-key="item-7:td:2"` — third table diff in section "item-7"

Both panels process the same `sectionDiff.paragraphDiffs` array, so the same key identifies corresponding elements across panels. A modified paragraph produces `data-block-key="item-1a:pd:0"` in **both** the old and new panels.

### Which Blocks Get Annotated

| changeType | Has both old/new sourceMapping? | Annotated? | Rationale |
|---|---|---|---|
| `modified` | Yes | Yes | Both panels have the element → anchor |
| `moved` | Yes | Yes | Both panels have the element → anchor |
| `added` | No (only `new`) | No | Only exists in new panel → no anchor |
| `removed` | No (only `old`) | No | Only exists in old panel → no anchor |

### Injection Function

New function in `highlight-injector.ts`:

```typescript
/**
 * Inject a data-block-key attribute into the first opening HTML tag.
 * Falls back to wrapping in a <span> if no opening tag is found.
 */
export function injectBlockKey(blockHtml: string, key: string): string {
  const trimmed = blockHtml.trimStart();
  if (!trimmed.startsWith('<')) {
    // Raw text without a wrapping element — add a span wrapper
    return `<span data-block-key="${key}">${blockHtml}</span>`;
  }
  const tagEnd = blockHtml.indexOf('>');
  if (tagEnd === -1) return blockHtml;
  // Self-closing tags: insert before />. Strip trailing whitespace before /
  // to avoid double spaces (e.g., "<br />" → "<br data-block-key="..." />").
  if (blockHtml[tagEnd - 1] === '/') {
    let pos = tagEnd - 1;
    while (pos > 0 && blockHtml[pos - 1] === ' ') pos--;
    return blockHtml.slice(0, pos) + ` data-block-key="${key}" />` + blockHtml.slice(tagEnd + 1);
  }
  return blockHtml.slice(0, tagEnd) + ` data-block-key="${key}"` + blockHtml.slice(tagEnd);
}
```

### Integration with `applyHighlightsToSection`

The existing paragraph processing loop (lines 240–280 of `highlight-injector.ts`) has three branches:
1. `added` and `side === 'new'` → wraps in `<ins>`
2. `removed` and `side === 'old'` → wraps in `<del>`
3. `modified` or `moved` → injects word-level highlights (but skips if `filteredChanges.length === 0`)

For scroll sync annotation, we need to handle a fourth case: **blocks with both-side source mappings that don't produce highlights on the current side**. For example, a `modified` paragraph with no word changes on the `old` side currently hits `continue` at line 266. But we still need its `data-block-key` for the anchor map.

**Modified logic** (pseudocode for the paragraph loop):

```typescript
for (let pdIdx = 0; pdIdx < sectionDiff.paragraphDiffs.length; pdIdx++) {
  const pd = sectionDiff.paragraphDiffs[pdIdx];
  const hasBothSides = pd.sourceMapping.old != null && pd.sourceMapping.new != null;
  const sourceLoc = pd.sourceMapping[side];
  if (!sourceLoc) continue;

  const relStart = sourceLoc.start - sectionOffset;
  const relEnd = sourceLoc.end - sectionOffset;
  if (relStart < 0 || relEnd > sectionHtml.length || relStart >= relEnd) continue;

  const paragraphHtml = sectionHtml.slice(relStart, relEnd);
  let replacedHtml: string | undefined;

  // Existing highlight logic (unchanged)
  if (pd.changeType === 'added' && side === 'new') {
    replacedHtml = wrapParagraph(paragraphHtml, 'added');
  } else if (pd.changeType === 'removed' && side === 'old') {
    replacedHtml = wrapParagraph(paragraphHtml, 'removed');
  } else if (pd.changeType === 'modified' || pd.changeType === 'moved') {
    const filteredChanges = (pd.wordChanges ?? []).filter((wc) =>
      side === 'old' ? wc.type === 'removed' : wc.type === 'added',
    );
    if (filteredChanges.length > 0) {
      const paraKey = `${sourceLoc.start}:${sourceLoc.end}`;
      const paragraph = paragraphIndex.get(paraKey);
      if (paragraph) {
        replacedHtml = injectWordHighlights(paragraphHtml, filteredChanges, paragraph.text);
      }
    }
  }

  // NEW: Inject sync annotation for blocks with both-side mappings
  if (hasBothSides) {
    const blockKey = `${sectionDiff.id}:pd:${pdIdx}`;
    replacedHtml = injectBlockKey(replacedHtml ?? paragraphHtml, blockKey);
  }

  // Push replacement if anything changed
  if (replacedHtml) {
    replacements.push({ relStart, relEnd, html: replacedHtml });
  }
}
```

The same pattern applies to the table diff loop — inject `data-block-key` on table elements with both-side source mappings.

**Note**: `applyHighlightsToSection` needs to receive the `sectionDiff.id` to construct the block key. Currently it receives `sectionDiff` directly, so `sectionDiff.id` is available. However, the function signature should be extended to accept `sectionId`:

```typescript
export function applyHighlightsToSection(
  sectionHtml: string,
  sectionOffset: number,
  sectionDiff: SectionDiff,
  paragraphIndex: Map<string, Paragraph>,
  side: Side,
  tableIndex?: Map<string, Table>,
): string;
```

No signature change needed — `sectionDiff.id` is already accessible from the existing `sectionDiff` parameter.

## 4. Anchor Map Construction

### Data Types

In `apps/web/src/lib/sync-scroll.ts`:

```typescript
/** A corresponding position pair between old and new panels. */
export interface Anchor {
  oldY: number;  // absolute Y in old panel's scrollable content
  newY: number;  // absolute Y in new panel's scrollable content
}

export type SyncDirection = 'oldToNew' | 'newToOld';
```

### `measureElements(panel): Map<string, number>`

Reads element positions from a single panel. Returns a map from key → absolute Y position within the scrollable content.

```typescript
/**
 * Query all section elements and data-block-key annotated elements in a panel,
 * returning their absolute Y positions within the scrollable content.
 *
 * Keys use a prefix to distinguish sections from blocks:
 * - Sections: "section:{id}" (e.g., "section:item-1a")
 * - Blocks: the raw data-block-key value (e.g., "item-1a:pd:0")
 */
export function measureElements(panel: HTMLDivElement): Map<string, number> {
  const positions = new Map<string, number>();
  const panelRect = panel.getBoundingClientRect();
  const scrollTop = panel.scrollTop;

  // Section elements (by ID)
  for (const el of panel.querySelectorAll<HTMLElement>('section[id]')) {
    const y = el.getBoundingClientRect().top - panelRect.top + scrollTop;
    positions.set(`section:${el.id}`, y);
  }

  // Annotated block elements (by data-block-key)
  for (const el of panel.querySelectorAll<HTMLElement>('[data-block-key]')) {
    const key = el.dataset.blockKey!;
    const y = el.getBoundingClientRect().top - panelRect.top + scrollTop;
    positions.set(key, y);
  }

  return positions;
}
```

### `computeAnchors(oldPositions, newPositions): Anchor[]`

Pure function — matches keys across panels, returns sorted anchor array.

```typescript
/**
 * Build anchor points by matching keys that exist in both panels.
 * Returns anchors sorted by oldY for efficient binary search.
 */
export function computeAnchors(
  oldPositions: Map<string, number>,
  newPositions: Map<string, number>,
): Anchor[] {
  const anchors: Anchor[] = [];
  for (const [key, oldY] of oldPositions) {
    const newY = newPositions.get(key);
    if (newY !== undefined) {
      anchors.push({ oldY, newY });
    }
  }
  anchors.sort((a, b) => a.oldY - b.oldY);
  return anchors;
}
```

### `buildAnchorMap(oldPanel, newPanel): Anchor[]`

Convenience function combining measurement and pairing.

```typescript
/**
 * Build a complete anchor map from two panel DOM elements.
 * Measures positions and pairs corresponding elements.
 */
export function buildAnchorMap(
  oldPanel: HTMLDivElement,
  newPanel: HTMLDivElement,
): Anchor[] {
  return computeAnchors(
    measureElements(oldPanel),
    measureElements(newPanel),
  );
}
```

### Typical Anchor Counts

| Source | Count | Notes |
|---|---|---|
| Matched section boundaries | ~15-25 | One per section present in both filings |
| Modified/moved paragraphs | ~30-100 | Changed paragraphs with both-side mappings |
| Modified tables | ~5-20 | Changed tables with both-side mappings |
| **Total** | **~50-145** | Sufficient for smooth interpolation |

## 5. Scroll Translation

### `translatePosition(anchors, sourceY, direction): number`

Pure function — binary search for bracketing anchors, then linear interpolation.

```typescript
/**
 * Translate a scroll position from one panel to the other using the anchor map.
 *
 * Uses binary search to find the two anchors bracketing the source position,
 * then linearly interpolates the target position between them.
 *
 * Edge behavior:
 * - No anchors → returns sourceY unchanged (passthrough)
 * - Before first anchor → offset translation from first anchor
 * - After last anchor → offset translation from last anchor
 * - Between anchors → linear interpolation
 */
export function translatePosition(
  anchors: Anchor[],
  sourceY: number,
  direction: SyncDirection,
): number {
  if (anchors.length === 0) return sourceY;

  // For newToOld direction, we need anchors sorted by newY
  const sorted = direction === 'oldToNew'
    ? anchors
    : [...anchors].sort((a, b) => a.newY - b.newY);

  const srcKey = direction === 'oldToNew' ? 'oldY' : 'newY';
  const tgtKey = direction === 'oldToNew' ? 'newY' : 'oldY';

  // Single anchor — offset translation
  if (sorted.length === 1) {
    return sourceY - sorted[0][srcKey] + sorted[0][tgtKey];
  }

  // Before first anchor — offset from first
  if (sourceY <= sorted[0][srcKey]) {
    return sourceY - sorted[0][srcKey] + sorted[0][tgtKey];
  }

  // After last anchor — offset from last
  const last = sorted[sorted.length - 1];
  if (sourceY >= last[srcKey]) {
    return sourceY - last[srcKey] + last[tgtKey];
  }

  // Binary search for bracketing anchors
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid][srcKey] <= sourceY) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Linear interpolation between sorted[lo] and sorted[hi]
  const a = sorted[lo];
  const b = sorted[hi];
  const srcSpan = b[srcKey] - a[srcKey];
  // Defensive guard: the binary search invariant (a[srcKey] <= sourceY < b[srcKey])
  // guarantees srcSpan > 0, but we guard against it for safety.
  if (srcSpan === 0) return a[tgtKey];
  const t = (sourceY - a[srcKey]) / srcSpan;
  return a[tgtKey] + t * (b[tgtKey] - a[tgtKey]);
}
```

### Scroll Sync Flow

```
User scrolls Panel A (old panel)
  → scroll event fires
  → check isProgrammaticScroll ref → if true, clear flag and return (loop prevention)
  → cancelAnimationFrame(rafId)
  → requestAnimationFrame:
      → anchors = buildAnchorMap(oldPanel, newPanel)
      → targetScrollTop = translatePosition(anchors, oldPanel.scrollTop, 'oldToNew')
      → set isProgrammaticScroll = true
      → newPanel.scrollTop = targetScrollTop
```

## 6. Hook Signature

```typescript
/**
 * Synchronize scroll position between two panels using content-aligned
 * anchor mapping. When enabled, scrolling one panel translates the position
 * using diff-annotated DOM elements to find corresponding content in the
 * other panel.
 */
export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void;
```

Same signature as v1/v2 — no API changes for consumers. Panel A is the old panel, Panel B is the new panel.

### Implementation Sketch

```typescript
import { useEffect, useRef, type RefObject } from 'react';
import { buildAnchorMap, translatePosition, type SyncDirection } from '../lib/sync-scroll';

export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void {
  const isProgrammaticScrollRef = useRef(false);

  useEffect(() => {
    const panelA = panelARef.current;
    const panelB = panelBRef.current;
    if (!panelA || !panelB || !enabled) return;

    const makeSyncHandler = (
      source: HTMLDivElement,
      target: HTMLDivElement,
      direction: SyncDirection,
    ) => {
      let rafId = 0;
      return () => {
        // Check loop guard BEFORE rAF to avoid queuing unnecessary frames
        if (isProgrammaticScrollRef.current) {
          isProgrammaticScrollRef.current = false;
          return;
        }

        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const anchors = buildAnchorMap(
            direction === 'oldToNew' ? source : target,
            direction === 'oldToNew' ? target : source,
          );

          const targetScrollTop = translatePosition(
            anchors,
            source.scrollTop,
            direction,
          );

          isProgrammaticScrollRef.current = true;
          target.scrollTop = targetScrollTop;
        });
      };
    };

    const handleScrollA = makeSyncHandler(panelA, panelB, 'oldToNew');
    const handleScrollB = makeSyncHandler(panelB, panelA, 'newToOld');

    panelA.addEventListener('scroll', handleScrollA, { passive: true });
    panelB.addEventListener('scroll', handleScrollB, { passive: true });

    return () => {
      panelA.removeEventListener('scroll', handleScrollA);
      panelB.removeEventListener('scroll', handleScrollB);
      isProgrammaticScrollRef.current = false;
    };
  }, [panelARef, panelBRef, enabled]);
}
```

## 7. Loop Prevention

Same as v2: single boolean ref `isProgrammaticScrollRef`.

```typescript
const isProgrammaticScrollRef = useRef(false);
```

**How it works:**
1. User scrolls Panel A → handler fires, `isProgrammaticScrollRef` is `false` → proceed
2. Handler computes target position, sets `isProgrammaticScrollRef = true`, assigns `panelB.scrollTop`
3. Panel B's scroll event fires → handler checks `isProgrammaticScrollRef` → it's `true` → clear it, return immediately
4. No further scroll events propagate → loop broken

**Why no timeout is needed:**
- `scrollTop` assignment is synchronous — Panel B's scroll event fires synchronously (or on the next microtask) after assignment
- Unlike `scrollIntoView({ behavior: 'smooth' })` which produces a stream of scroll events over ~300ms, direct `scrollTop` assignment produces exactly one scroll event
- The boolean is checked and cleared atomically in the handler

**Edge case — rapid user scrolling:**
If the user scrolls Panel A very rapidly (multiple frames), each scroll event:
1. Cancels the previous `rAF` callback (via `cancelAnimationFrame`)
2. Queues a new one
3. Only the last frame actually executes and sets `scrollTop` on Panel B

This means Panel B receives at most one programmatic scroll per user scroll frame — the boolean ref handles this correctly.

## 8. Edge Cases

### Section exists in one panel but not the other (added/removed sections)

Added/removed sections have no matching `<section id>` in the other panel. No anchor is created. When the user scrolls through an added section in one panel, the scroll position falls between surrounding anchors and is interpolated. The other panel stays at a reasonable position near the boundary.

### No anchors at all

`translatePosition` returns `sourceY` unchanged (passthrough). This handles the case where both panels have completely different content (no matching sections). The panels scroll independently.

### Reordered sections

Anchors are sorted by source-panel position. If section order differs between panels, the anchor map produces non-monotonic target positions — e.g., scrolling down in Panel A might cause Panel B to jump backwards. This is correct behavior: the content at that position in Panel A corresponds to earlier content in Panel B.

### No sections loaded yet (pipeline states)

During `fetching`/`parsing`/`diffing`, `FilingPanel` renders spinners. No `<section>` elements exist → `measureElements` returns empty map → `computeAnchors` returns `[]` → `translatePosition` returns passthrough → no-op. Sync starts automatically once content renders.

### One panel shorter than the other

Before-first and after-last anchor cases use offset translation (not interpolation). If Panel A is much longer, scrolling past the last anchor produces reasonable target positions that follow the offset pattern established by the last anchor.

### Scroll position in preamble area (before first section)

The preamble section (`id="preamble"`) is rendered in `FilingContent` but is not part of the diff's `sectionDiffs`. If both panels have a preamble section (typical — boilerplate headers), `measureElements` picks it up by its `id`. If only one panel has it, the first matched section serves as the anchor boundary.

### Zero-height sections

If a section has zero height, its anchor coincides with the next section's anchor. `translatePosition` handles this via the `srcSpan === 0` guard, returning the target position of the first anchor.

### Toggle during scroll

When the user disables sync, the `useEffect` cleanup runs immediately, removing listeners. Any in-flight `rAF` callback from a removed listener is harmless — if it fires, it sets `scrollTop` once (no crash, just one extra frame).

### `getBoundingClientRect` during scroll

`getBoundingClientRect` returns viewport-relative positions that change during scroll. The formula `el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop` compensates by adding back the scroll offset, giving stable content-absolute positions regardless of current scroll position.

## 9. Files to Create / Modify

### New: `apps/web/src/lib/sync-scroll.ts`

Pure functions with zero React dependencies:
- `Anchor` interface
- `SyncDirection` type
- `measureElements()` — reads element positions from a panel (only function touching the DOM)
- `computeAnchors()` — matches keys across panels, returns sorted anchors (pure)
- `buildAnchorMap()` — convenience combining measure + compute
- `translatePosition()` — binary search + interpolation (pure)

### New: `apps/web/src/hooks/useSyncedScroll.ts`

React hook orchestrating the sync:
- `useSyncedScroll()` — attaches scroll listeners, builds anchor maps, translates positions
- Imports functions from `../lib/sync-scroll`

### Modify: `apps/web/src/lib/highlight-injector.ts`

- **Add** `injectBlockKey()` — injects `data-block-key` attribute into an HTML opening tag
- **Extend** `applyHighlightsToSection()` paragraph loop — inject `data-block-key` on changed blocks with both-side source mappings (modified/moved paragraphs)
- **Extend** `applyHighlightsToSection()` table diff loop — inject `data-block-key` on changed tables with both-side source mappings

### Modify: `apps/web/src/App.tsx`

```typescript
// New imports
import { useSyncedScroll } from './hooks/useSyncedScroll';

// New state (after line 76)
const [syncEnabled, setSyncEnabled] = useState(true);

// Wire the hook (after ref declarations, lines 73-74)
useSyncedScroll(oldPanelRef, newPanelRef, syncEnabled);

// Toggle callback
const handleSyncToggle = useCallback(() => {
  setSyncEnabled((prev) => !prev);
}, []);

// Pass to Header (line 89)
<Header syncEnabled={syncEnabled} onSyncToggle={handleSyncToggle} />
```

### Modify: `apps/web/src/components/Header.tsx`

Add toggle button with `aria-pressed` for accessibility:

```typescript
interface HeaderProps {
  syncEnabled?: boolean;
  onSyncToggle?: () => void;
}

export function Header({ syncEnabled, onSyncToggle }: HeaderProps) {
  return (
    <header className="flex items-center h-14 px-6 bg-white border-b border-gray-200 shrink-0">
      <h1 className="text-xl font-bold text-gray-900">Edgar-Differ</h1>
      {onSyncToggle && (
        <button
          type="button"
          onClick={onSyncToggle}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
            syncEnabled
              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
          aria-pressed={syncEnabled}
          title={syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling'}
        >
          <span>Sync Scroll</span>
        </button>
      )}
    </header>
  );
}
```

Props are optional so Header remains backwards-compatible and testable in isolation.

## 10. What's Removed from v2

| v2 Concept | Why Removed |
|---|---|
| `SectionRect` interface | Replaced by `Anchor` — content-level, not section-level |
| `findSectionAtPosition()` (binary search over sections) | Replaced by `translatePosition()` binary search over anchors |
| `computeRatio()` (position-to-ratio) | No ratio concept — direct position mapping via anchors |
| `computeTargetScrollTop()` (ratio-to-scrollTop) | Replaced by interpolation in `translatePosition()` |
| `getSectionRects()` (section layout reads) | Replaced by `measureElements()` (reads sections + annotated blocks) |
| Section ID matching in scroll handler | Replaced by key matching in `computeAnchors()` |

**Retained from v2:** Loop prevention (boolean ref), rAF debouncing, hook signature, Header toggle, App.tsx wiring.

## 11. Dependencies

Only React built-ins — no external libraries:

- `useEffect` — lifecycle for listeners
- `useRef` — mutable boolean for loop prevention
- `useCallback` — toggle handler in App.tsx
- `useState` — `syncEnabled` in App.tsx
- `RefObject` — type import for panel refs

Browser APIs used:
- `getBoundingClientRect()` — element positioning
- `querySelectorAll()` — element discovery (already used throughout the app)
- `requestAnimationFrame` / `cancelAnimationFrame` — debouncing
- `scrollTop` / `clientHeight` — scroll position
- `dataset` — reading `data-block-key` attribute values

## 12. Performance Considerations

- **Anchor map build per frame**: `querySelectorAll` for ~40 sections + ~200 blocks across 2 panels, `getBoundingClientRect` on ~120 matched elements. Browser batches rect reads if no reflow occurred. Expected cost: ~0.3–0.5ms. Well within the 16ms rAF budget.
- **Binary search**: O(log n) for ~120 anchors = ~7 comparisons. Negligible.
- **rAF debouncing**: At most one handler execution per frame. Rapid scrolling cancels prior rAF callbacks.
- **No forced reflows**: All reads (`getBoundingClientRect`, `scrollTop`) happen before the single write (`target.scrollTop`). No read-write-read interleaving.
- **No smooth scrolling overhead**: Direct `scrollTop` assignment is synchronous.
- **`newToOld` re-sort**: `translatePosition` creates a copy sorted by `newY` for the reverse direction. With ~120 elements, this is ~0.01ms. If perf-sensitive, pre-sort both directions in `buildAnchorMap`.

## 13. Testability

The architecture separates pure functions from DOM interaction:

| Function | Pure? | Testable with |
|---|---|---|
| `computeAnchors()` | Yes | Plain unit tests with mock maps |
| `translatePosition()` | Yes | Plain unit tests with mock anchors |
| `injectBlockKey()` | Yes | String-based unit tests |
| `measureElements()` | No (DOM reads) | jsdom / happy-dom with mock elements |
| `buildAnchorMap()` | No (DOM reads) | jsdom / happy-dom |
| `useSyncedScroll()` | No (React + DOM) | React Testing Library |

`computeAnchors` and `translatePosition` are the core algorithms and have the highest test coverage value.

## 14. Future Enhancement: Unchanged Block Anchors

The current design uses **section boundaries + changed blocks** as anchors. For sections with sparse changes (e.g., 50 paragraphs with only 2 modified), the interpolation between anchor points covers large content stretches.

For even smoother alignment, unchanged paragraphs can be added as anchors:

1. **Diff engine change**: Remove the filter at `diff-engine.ts:62` or add a separate `blockMappings: DiffRange[]` field to `SectionDiff` with the source mappings of ALL paragraphs (including unchanged)
2. **Annotation**: Inject `data-block-key` on all blocks, not just changed ones
3. **Impact**: Anchor count increases from ~100 to ~500-1000 (every paragraph becomes an anchor)

This is deferred because:
- The current anchor coverage is sufficient for a good user experience — unchanged sections have identical content (proportional is fine), and changed sections have anchors precisely at the changes (where users focus)
- Adding unchanged anchors increases the `querySelectorAll`/`getBoundingClientRect` cost proportionally
- It requires either a diff engine API change or a separate data path
