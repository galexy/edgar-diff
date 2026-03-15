# US-2.11: Synchronized Scrolling — Implementation Design (v3)

## 1. Approach: Offset-Based Content Lookup

### Why v1 and v2 Failed

**v1** used section-snapping via `scrollIntoView` — huge jumps.

**v2** used proportional section-based ratios — fundamentally wrong when sections have different paragraph counts.

### Why Interpolation-Only Is Wrong

An earlier v3 draft used anchor maps with linear interpolation between anchor points. This treats all content between anchors as a linear gradient — but it's not. Between anchors there are specific paragraphs that are either unchanged (identical in both panels), modified (with known source mappings), or added/removed. Interpolation blurs this structure.

### v3: Offset-Based Direct Lookup

The key insight: **the HTML source offset is the bridge**. Every content block (paragraph, table) in a `StructuredDocument` has a `source: SourceLocation` giving its exact character offset in the filing HTML. The diff engine computes which blocks correspond between old and new filings via `sourceMapping: { old?: SourceLocation, new?: SourceLocation }`.

v3 uses these source offsets as a **coordinate system for content correspondence**:

1. **Annotate every block** in the DOM with its source offset (`data-source-start`)
2. **Build an offset table** from ALL paragraph/table diffs (including unchanged) that maps old source offsets ↔ new source offsets
3. **On scroll**: find the block at the viewport top → read its source offset → look up the corresponding offset in the other document → find the target element → scroll to it

**Direct lookup, not interpolation:**
- **Unchanged content** → same element exists in both panels → direct lookup → exact alignment
- **Modified content** → diff's `sourceMapping` gives exact corresponding block → direct lookup
- **Added/removed content** → no correspondence → interpolate between nearest known blocks (the ONLY case where interpolation is needed)

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ Diff Engine Change (one-time)                       │
│                                                     │
│  diff-engine.ts: include unchanged paragraphs       │
│  and tables in paragraphDiffs / tableDiffs           │
│  → every block has sourceMapping with both sides    │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│ Render Pipeline (per data change)                   │
│                                                     │
│  applyHighlightsToSection: annotate ALL blocks      │
│       ↓ injects data-source-start="<offset>"        │
│  Every paragraph/table in DOM has its source offset │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│ Scroll Sync (per scroll event, behind rAF)          │
│                                                     │
│  1. findBlockAtViewportTop(sourcePanel)              │
│     → walks [data-source-start] elements            │
│     → returns { sourceOffset, pixelOffset }         │
│                                                     │
│  2. lookupCorrespondingOffset(table, offset, dir)   │
│     → binary search in offset table                 │
│     → direct match or interpolation for gaps        │
│     → returns target source offset                  │
│                                                     │
│  3. findBlockBySourceOffset(targetPanel, offset)    │
│     → queries [data-source-start="<offset>"]        │
│     → returns element position                      │
│                                                     │
│  4. targetPanel.scrollTop = targetBlockTop + offset │
└─────────────────────────────────────────────────────┘
```

## 3. Diff Engine Change

### Problem

The diff engine filters out unchanged paragraphs (`diff-engine.ts:62`) and tables (`diff-engine.ts:94`). These are the BEST anchors for scroll sync — they represent content that is identical in both panels with known source offset correspondence.

### Change

Remove the two filters:

```diff
 // diff-engine.ts:62
-const paragraphDiffs = allParagraphDiffs.filter(pd => pd.changeType !== 'unchanged');
+const paragraphDiffs = allParagraphDiffs;

 // diff-engine.ts:94
-tableDiffs = tableDiffs.filter(td => td.changeType !== 'unchanged');
+// tableDiffs unfiltered — unchanged tables retained for scroll sync
```

**Why this is safe for existing consumers:**
- `applyHighlightsToSection` already handles unchanged entries — the `else { continue; }` branch at line 274 skips them
- `countChanges` in `App.tsx` already defensively filters: `paragraphDiffs.filter(p => p.changeType !== 'unchanged')`
- The diff summary (`buildSummary`) counts section-level change types, not paragraph-level — unaffected
- Unchanged `ParagraphDiff` entries have no `wordChanges` (lightweight — just `changeType` + `sourceMapping`)

**Data impact**: For a typical 10-K with ~1000 paragraphs and ~10% changed, this adds ~900 entries with `{ changeType: 'unchanged', sourceMapping: { old: {start, end}, new: {start, end} } }` — approximately 18KB of additional JSON. Negligible.

## 4. DOM Annotation

### Strategy

Annotate **ALL content blocks** (paragraphs and tables) with their source offset via `data-source-start` attributes. This creates a complete mapping from every DOM element back to its position in the filing HTML.

### Attribute

```
data-source-start="<absoluteSourceOffset>"
```

Examples:
- `<p data-source-start="1234">Risk factors include...</p>` — paragraph starting at offset 1234
- `<table data-source-start="5678">...</table>` — table starting at offset 5678

The offset is the **absolute character position** in the filing HTML (same value as `block.source.start` from the `StructuredDocument`).

### Injection Function

New function in `highlight-injector.ts`:

```typescript
/**
 * Inject a data-source-start attribute into the first opening HTML tag.
 * Falls back to wrapping in a <span> if no opening tag is found.
 */
export function injectSourceOffset(blockHtml: string, sourceStart: number): string {
  const trimmed = blockHtml.trimStart();
  if (!trimmed.startsWith('<')) {
    return `<span data-source-start="${sourceStart}">${blockHtml}</span>`;
  }
  const tagEnd = blockHtml.indexOf('>');
  if (tagEnd === -1) return blockHtml;
  // Self-closing tags: insert before />
  if (blockHtml[tagEnd - 1] === '/') {
    let pos = tagEnd - 1;
    while (pos > 0 && blockHtml[pos - 1] === ' ') pos--;
    return blockHtml.slice(0, pos) + ` data-source-start="${sourceStart}" />` + blockHtml.slice(tagEnd + 1);
  }
  return blockHtml.slice(0, tagEnd) + ` data-source-start="${sourceStart}"` + blockHtml.slice(tagEnd);
}
```

### Integration with `applyHighlightsToSection`

Now that `paragraphDiffs` includes ALL paragraphs (unchanged + changed), the existing loop iterates every block. For each paragraph:

1. Apply highlights (if changed) — existing logic, unchanged blocks hit `continue`
2. Inject `data-source-start` — **always**, regardless of change type

**Modified logic** (pseudocode for the paragraph loop):

```typescript
for (const pd of sectionDiff.paragraphDiffs) {
  const sourceLoc = pd.sourceMapping[side];
  if (!sourceLoc) continue; // block doesn't exist on this side (added/removed)

  const relStart = sourceLoc.start - sectionOffset;
  const relEnd = sourceLoc.end - sectionOffset;
  if (relStart < 0 || relEnd > sectionHtml.length || relStart >= relEnd) continue;

  const paragraphHtml = sectionHtml.slice(relStart, relEnd);
  let replacedHtml: string | undefined;

  // Existing highlight logic (unchanged — only fires for changed blocks)
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

  // NEW: Always inject source offset annotation
  replacedHtml = injectSourceOffset(replacedHtml ?? paragraphHtml, sourceLoc.start);

  replacements.push({ relStart, relEnd, html: replacedHtml });
}
```

The same pattern applies to the table diff loop.

## 5. Offset Correspondence Table

### Data Types

In `apps/web/src/lib/sync-scroll.ts`:

```typescript
/** A source offset correspondence between old and new documents. */
export interface OffsetEntry {
  oldStart: number;
  newStart: number;
}

export type SyncDirection = 'oldToNew' | 'newToOld';
```

### `buildOffsetTable(sectionDiffs): OffsetEntry[]`

Pure function — extracts all paragraph and table source mappings from the diff data, returns entries sorted by `oldStart`.

```typescript
import type { SectionDiff } from '@edgar-diff/lib';

/**
 * Build a sorted offset correspondence table from diff data.
 * Each entry maps a source offset in the old document to the
 * corresponding offset in the new document.
 *
 * Includes ALL blocks: unchanged (direct correspondence),
 * modified/moved (sourceMapping), added/removed (single-sided, excluded).
 */
export function buildOffsetTable(sectionDiffs: SectionDiff[]): OffsetEntry[] {
  const entries: OffsetEntry[] = [];

  function collectEntries(sections: SectionDiff[]): void {
    for (const sd of sections) {
      // Section boundaries as entries
      if (sd.sourceMapping.old && sd.sourceMapping.new) {
        entries.push({
          oldStart: sd.sourceMapping.old.start,
          newStart: sd.sourceMapping.new.start,
        });
      }

      // Paragraph mappings
      for (const pd of sd.paragraphDiffs) {
        if (pd.sourceMapping.old && pd.sourceMapping.new) {
          entries.push({
            oldStart: pd.sourceMapping.old.start,
            newStart: pd.sourceMapping.new.start,
          });
        }
      }

      // Table mappings
      for (const td of sd.tableDiffs) {
        if (td.sourceMapping.old && td.sourceMapping.new) {
          entries.push({
            oldStart: td.sourceMapping.old.start,
            newStart: td.sourceMapping.new.start,
          });
        }
      }

      // Recurse into subsections
      if (sd.subsectionDiffs.length > 0) {
        collectEntries(sd.subsectionDiffs);
      }
    }
  }

  collectEntries(sectionDiffs);
  entries.sort((a, b) => a.oldStart - b.oldStart);
  return entries;
}
```

### Typical Entry Counts

| Source | Count | Notes |
|---|---|---|
| Section boundaries | ~15-25 | One per matched section |
| Unchanged paragraphs | ~500-900 | Every unchanged paragraph (bulk of content) |
| Modified/moved paragraphs | ~30-100 | Changed paragraphs with both-side mappings |
| Tables | ~20-50 | All tables with both-side mappings |
| **Total** | **~565-1075** | Dense coverage — most content has direct mapping |

## 6. Scroll Translation

### `findBlockAtViewportTop(panel): { sourceStart, pixelOffset } | null`

Finds the annotated block element at or just above the viewport top.

```typescript
/**
 * Find the block element whose top edge is at or just above the
 * panel's current viewport top. Returns the element's source offset
 * and the pixel distance from the element's top to the viewport top
 * (for sub-block alignment).
 */
export function findBlockAtViewportTop(
  panel: HTMLDivElement,
): { sourceStart: number; pixelOffset: number } | null {
  const elements = panel.querySelectorAll<HTMLElement>('[data-source-start]');
  if (elements.length === 0) return null;

  const panelRect = panel.getBoundingClientRect();
  const viewportTop = panel.scrollTop;

  let bestElement: HTMLElement | null = null;
  let bestAbsTop = -Infinity;

  for (const el of elements) {
    const absTop = el.getBoundingClientRect().top - panelRect.top + panel.scrollTop;
    if (absTop <= viewportTop && absTop > bestAbsTop) {
      bestAbsTop = absTop;
      bestElement = el;
    }
  }

  if (!bestElement) {
    // All elements below viewport top — use the first element
    const first = elements[0];
    const absTop = first.getBoundingClientRect().top - panelRect.top + panel.scrollTop;
    return {
      sourceStart: parseInt(first.dataset.sourceStart!, 10),
      pixelOffset: viewportTop - absTop,
    };
  }

  return {
    sourceStart: parseInt(bestElement.dataset.sourceStart!, 10),
    pixelOffset: viewportTop - bestAbsTop,
  };
}
```

### `lookupCorrespondingOffset(table, sourceOffset, direction): number`

Pure function — binary search for the corresponding source offset.

```typescript
/**
 * Look up a source offset in the correspondence table and return
 * the corresponding offset in the other document.
 *
 * Lookup behavior:
 * - Exact match → returns corresponding offset directly
 * - Between entries → linear interpolation (only for gaps in added/removed content)
 * - Before first entry → offset translation from first
 * - After last entry → offset translation from last
 */
export function lookupCorrespondingOffset(
  table: OffsetEntry[],
  sourceOffset: number,
  direction: SyncDirection,
): number {
  if (table.length === 0) return sourceOffset; // passthrough

  // For newToOld: sort by newStart
  const sorted = direction === 'oldToNew'
    ? table
    : [...table].sort((a, b) => a.newStart - b.newStart);

  const srcKey = direction === 'oldToNew' ? 'oldStart' : 'newStart';
  const tgtKey = direction === 'oldToNew' ? 'newStart' : 'oldStart';

  // Single entry — offset translation
  if (sorted.length === 1) {
    return sourceOffset - sorted[0][srcKey] + sorted[0][tgtKey];
  }

  // Before first entry
  if (sourceOffset <= sorted[0][srcKey]) {
    return sourceOffset - sorted[0][srcKey] + sorted[0][tgtKey];
  }

  // After last entry
  const last = sorted[sorted.length - 1];
  if (sourceOffset >= last[srcKey]) {
    return sourceOffset - last[srcKey] + last[tgtKey];
  }

  // Binary search for exact match or bracketing entries
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid][srcKey] <= sourceOffset) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Exact match on lo bracket — direct lookup
  if (sorted[lo][srcKey] === sourceOffset) {
    return sorted[lo][tgtKey];
  }

  // Between entries — linear interpolation (gap: added/removed content)
  const a = sorted[lo];
  const b = sorted[hi];
  const srcSpan = b[srcKey] - a[srcKey];
  // Defensive guard: binary search invariant guarantees srcSpan > 0
  if (srcSpan === 0) return a[tgtKey];
  const t = (sourceOffset - a[srcKey]) / srcSpan;
  return a[tgtKey] + t * (b[tgtKey] - a[tgtKey]);
}
```

### `findBlockBySourceOffset(panel, targetOffset): number | null`

Finds the element closest to the target source offset and returns its pixel position.

```typescript
/**
 * Find the annotated element in a panel whose source offset is closest
 * to the target offset. Returns its absolute Y position in the scrollable content.
 */
export function findBlockBySourceOffset(
  panel: HTMLDivElement,
  targetOffset: number,
): number | null {
  const elements = panel.querySelectorAll<HTMLElement>('[data-source-start]');
  if (elements.length === 0) return null;

  const panelRect = panel.getBoundingClientRect();
  let bestElement: HTMLElement | null = null;
  let bestDistance = Infinity;

  for (const el of elements) {
    const elOffset = parseInt(el.dataset.sourceStart!, 10);
    const distance = Math.abs(elOffset - targetOffset);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestElement = el;
    }
  }

  if (!bestElement) return null;

  return bestElement.getBoundingClientRect().top - panelRect.top + panel.scrollTop;
}
```

### Scroll Sync Flow

```
User scrolls Panel A (old panel)
  → scroll event fires
  → check isProgrammaticScroll ref → if true, clear and return
  → cancelAnimationFrame(rafId)
  → requestAnimationFrame:
      → block = findBlockAtViewportTop(oldPanel)
      → if (!block) return
      → targetOffset = lookupCorrespondingOffset(offsetTable, block.sourceStart, 'oldToNew')
      → targetY = findBlockBySourceOffset(newPanel, targetOffset)
      → if (targetY == null) return
      → set isProgrammaticScroll = true
      → newPanel.scrollTop = targetY + block.pixelOffset
```

**The `pixelOffset` carry-over**: When the viewport top is partway through a block, `findBlockAtViewportTop` records the pixel distance from the block's top edge to the viewport top. This is added to the target block's position so that the same relative position within the block is aligned. For unchanged blocks (identical content), this gives exact sub-block alignment.

## 7. Hook Signature

```typescript
/**
 * Synchronize scroll position between two panels using offset-based
 * content lookup. When enabled, scrolling one panel identifies the
 * content at the viewport top via source offsets, looks up the
 * corresponding content in the other document via diff data,
 * and scrolls to align it.
 */
export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  sectionDiffs?: SectionDiff[],
): void;
```

**Change from previous drafts**: The hook now receives `sectionDiffs` to build the offset table. The offset table is rebuilt when `sectionDiffs` changes (via `useMemo`).

### Implementation Sketch

```typescript
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { SectionDiff } from '@edgar-diff/lib';
import {
  buildOffsetTable,
  findBlockAtViewportTop,
  lookupCorrespondingOffset,
  findBlockBySourceOffset,
  type SyncDirection,
} from '../lib/sync-scroll';

export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  sectionDiffs?: SectionDiff[],
): void {
  const isProgrammaticScrollRef = useRef(false);

  // Build offset table once when diff data changes
  const offsetTable = useMemo(
    () => (sectionDiffs ? buildOffsetTable(sectionDiffs) : []),
    [sectionDiffs],
  );

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
        if (isProgrammaticScrollRef.current) {
          isProgrammaticScrollRef.current = false;
          return;
        }

        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const block = findBlockAtViewportTop(source);
          if (!block) return;

          const targetOffset = lookupCorrespondingOffset(
            offsetTable,
            block.sourceStart,
            direction,
          );

          const targetY = findBlockBySourceOffset(target, targetOffset);
          if (targetY == null) return;

          isProgrammaticScrollRef.current = true;
          target.scrollTop = targetY + block.pixelOffset;
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
  }, [panelARef, panelBRef, enabled, offsetTable]);
}
```

## 8. Loop Prevention

Same as v2: single boolean ref `isProgrammaticScrollRef`.

**How it works:**
1. User scrolls Panel A → handler fires, `isProgrammaticScrollRef` is `false` → proceed
2. Handler computes target position, sets `isProgrammaticScrollRef = true`, assigns `panelB.scrollTop`
3. Panel B's scroll event fires → handler checks `isProgrammaticScrollRef` → it's `true` → clear it, return immediately
4. No further scroll events propagate → loop broken

**Why no timeout is needed:**
- `scrollTop` assignment is synchronous — one scroll event per assignment
- The boolean is checked and cleared atomically in the handler

**Edge case — rapid user scrolling:**
`cancelAnimationFrame` discards stale rAF callbacks. At most one handler executes per frame. Panel B receives at most one programmatic scroll per frame.

## 9. Edge Cases

### Unchanged content → exact alignment

For unchanged paragraphs, `lookupCorrespondingOffset` finds an exact match in the offset table → `findBlockBySourceOffset` finds the identical element in the other panel → `pixelOffset` carry-over provides sub-block precision. Result: pixel-perfect alignment for unchanged content.

### Modified content → direct mapping

Modified paragraphs have `sourceMapping` with both old and new offsets. The offset table has an entry for the modification → direct lookup. The `pixelOffset` carry-over may be approximate (modified blocks can have different heights), but the correct block is always targeted.

### Added content (only in new panel)

Added paragraphs have only `sourceMapping.new` (no `old`). The source offset on the new side has no entry in the offset table. `lookupCorrespondingOffset` interpolates between the surrounding entries — the offset falls in a "gap" between the block before and after the addition. The old panel scrolls to the estimated position near the insertion point.

### Removed content (only in old panel)

Same pattern: removed paragraphs have only `sourceMapping.old`. The source offset on the old side has no entry mapping to the new side. Interpolation between surrounding entries provides reasonable alignment.

### No sections loaded yet (pipeline states)

No `[data-source-start]` elements → `findBlockAtViewportTop` returns `null` → handler returns early. Sync starts automatically once content renders.

### Section exists in one panel but not the other

Section boundary entries only exist for matched sections. Added/removed sections have no entries in the offset table. Content within them falls into interpolation gaps.

### Reordered sections

Entries are sorted by source offset, which reflects document order. Reordered sections produce entries where `oldStart` order differs from `newStart` order. The lookup correctly maps to the moved position.

### Toggle during scroll

`useEffect` cleanup removes listeners. In-flight rAF fires harmlessly.

### Scroll past last annotated block

`lookupCorrespondingOffset` handles the "after last" case with offset translation from the last entry.

## 10. Files to Create / Modify

### New: `apps/web/src/lib/sync-scroll.ts`

Pure functions:
- `OffsetEntry` interface
- `SyncDirection` type
- `buildOffsetTable()` — extracts offset correspondences from diff data (pure)
- `lookupCorrespondingOffset()` — binary search + direct match or interpolation (pure)
- `findBlockAtViewportTop()` — finds block at viewport top (DOM reads)
- `findBlockBySourceOffset()` — finds element by source offset (DOM reads)

### New: `apps/web/src/hooks/useSyncedScroll.ts`

React hook:
- `useSyncedScroll()` — orchestrates offset-based sync with `useMemo` for offset table

### Modify: `libs/edgar-diff-lib/src/diff/diff-engine.ts`

- **Remove** unchanged paragraph filter at line 62
- **Remove** unchanged table filter at line 94

### Modify: `apps/web/src/lib/highlight-injector.ts`

- **Add** `injectSourceOffset()` — injects `data-source-start` attribute into an HTML opening tag
- **Extend** `applyHighlightsToSection()` — inject `data-source-start` on ALL blocks (unchanged, modified, moved, added, removed)

### Modify: `apps/web/src/App.tsx`

```typescript
// New imports
import { useSyncedScroll } from './hooks/useSyncedScroll';

// New state (after line 76)
const [syncEnabled, setSyncEnabled] = useState(true);

// Wire the hook — now receives sectionDiffs for offset table
useSyncedScroll(oldPanelRef, newPanelRef, syncEnabled, diff?.sectionDiffs);

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

## 11. What Changed from Anchor Map Draft

| Anchor Map Draft | Offset-Based Design | Why |
|---|---|---|
| `data-block-key` (diff index) | `data-source-start` (source offset) | Source offsets are the natural coordinate system; enable direct lookup |
| Only changed blocks annotated | ALL blocks annotated | Unchanged blocks are the best anchors |
| `computeAnchors()` matches by key | `buildOffsetTable()` from diff data | Offset table is built once, not per-scroll |
| `measureElements()` per scroll | `findBlockAtViewportTop()` per scroll | Only measures one element, not all |
| `translatePosition()` always interpolates | `lookupCorrespondingOffset()` direct match first | Interpolation only for gaps (added/removed) |
| Pixel-space anchor map | Source-offset correspondence table | Source offsets are stable, don't depend on layout |
| No diff engine changes | Remove unchanged filters | Complete coverage requires ALL block mappings |
| Hook takes 3 args | Hook takes 4 args (+ sectionDiffs) | Offset table built from diff data, cached via useMemo |

**Retained:** Loop prevention (boolean ref), rAF debouncing, Header toggle, App.tsx wiring (extended).

## 12. Dependencies

React built-ins:
- `useEffect`, `useRef`, `useMemo`, `useCallback`, `useState`, `RefObject`

Browser APIs:
- `getBoundingClientRect()` — element positioning
- `querySelectorAll()` — element discovery
- `requestAnimationFrame` / `cancelAnimationFrame` — debouncing
- `scrollTop` — scroll position
- `dataset` — reading `data-source-start` attribute values

## 13. Performance Considerations

- **Offset table build**: `useMemo` — computed once when `sectionDiffs` changes. Iterates all diffs, builds and sorts ~500-1000 entries. ~0.1ms.
- **findBlockAtViewportTop**: Iterates all `[data-source-start]` elements (~500-1000). For each, reads `getBoundingClientRect` (batched by browser). ~0.5ms. Could optimize with binary search if elements are sorted in DOM order (they are — `querySelectorAll` returns document order).
- **lookupCorrespondingOffset**: Binary search O(log n) on ~500-1000 entries. ~10 comparisons. Negligible.
- **findBlockBySourceOffset**: Iterates elements, compares offsets. ~0.3ms. Could optimize with a pre-built Map<sourceStart, element> if needed.
- **Total per scroll frame**: ~1ms. Well within 16ms rAF budget.
- **No forced reflows**: All reads before single write (`target.scrollTop`).
- **Optimization opportunity**: Cache a sorted array of `{ sourceStart, absY }` per panel, rebuild on resize/data change instead of per-scroll.

## 14. Testability

| Function | Pure? | Testable with |
|---|---|---|
| `buildOffsetTable()` | Yes | Unit tests with mock SectionDiff[] |
| `lookupCorrespondingOffset()` | Yes | Unit tests with mock OffsetEntry[] |
| `injectSourceOffset()` | Yes | String-based unit tests |
| `findBlockAtViewportTop()` | No (DOM) | jsdom with mock elements |
| `findBlockBySourceOffset()` | No (DOM) | jsdom with mock elements |
| `useSyncedScroll()` | No (React + DOM) | React Testing Library |

`buildOffsetTable` and `lookupCorrespondingOffset` are the core algorithms and have the highest test coverage value.
