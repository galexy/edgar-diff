# US-2.11: Synchronized Scrolling — Implementation Design (v2)

## 1. Approach: Proportional Section-Based Alignment

### Why v1 Failed

The v1 implementation used **section-snapping via `scrollIntoView`**:
- An `IntersectionObserver` detected which section was "most visible" in the source panel
- Called `scrollIntoView({ block: 'start' })` on the matching section in the target panel
- **Result**: Huge jumps. When a section became visible at the bottom of one panel, the other panel snapped that section to the top. The panels showed the same section but at completely different scroll positions within it — never visually aligned.

### v2: Proportional Alignment via `scrollTop` Computation

Instead of snapping to section tops, v2 computes a **proportional position** within the current section and maps it to the corresponding section in the other panel. This keeps content aligned *within* sections, not just at section boundaries.

**Key advantages over v1:**
- **No `IntersectionObserver`** — simpler; binary search over `offsetTop` values replaces observer-based detection
- **No `MutationObserver`** — sections are queried fresh via `querySelectorAll` on each scroll event (cheap — typically 10-30 elements)
- **No settling timeout** — direct `scrollTop` assignment is synchronous, unlike `scrollIntoView` which is async
- **No `lastSyncedSectionRef`** — proportional mapping naturally handles scrolling within the same section (different ratios produce different scroll positions)
- **Proportional** — aligns content *within* sections, not just section tops
- **Handles asymmetric section sizes** — a section that's 3x taller in Panel A than Panel B still maps correctly via the 0→1 ratio

## 2. Algorithm Detail

### Core Pure Functions

These live in `apps/web/src/lib/sync-scroll.ts` — a standalone module with zero React or DOM dependencies (operates on plain numbers). The hook in `apps/web/src/hooks/useSyncedScroll.ts` imports and orchestrates them.

#### `findSectionAtPosition(sections, centerY): SectionRect | null`

Binary search over an array of `{ offsetTop, offsetHeight }` section measurements to find which section contains `centerY`.

```typescript
export interface SectionRect {
  id: string;
  offsetTop: number;
  offsetHeight: number;
}

/**
 * Binary search through section positions to find which section contains
 * the given vertical position. Returns the section, or null if no sections exist.
 *
 * Boundary behavior:
 * - Position before first section → returns first section (preamble area)
 * - Position after last section → returns last section
 * - Position in gap between sections → snaps to nearest
 */
export function findSectionAtPosition(
  sections: SectionRect[],
  centerY: number,
): SectionRect | null {
  if (sections.length === 0) return null;

  // Before first section (preamble area)
  if (centerY < sections[0].offsetTop) {
    return sections[0];
  }

  // After last section
  const last = sections[sections.length - 1];
  if (centerY >= last.offsetTop + last.offsetHeight) {
    return last;
  }

  // Binary search
  let lo = 0;
  let hi = sections.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s = sections[mid];
    if (centerY < s.offsetTop) {
      hi = mid - 1;
    } else if (centerY >= s.offsetTop + s.offsetHeight) {
      lo = mid + 1;
    } else {
      return s;
    }
  }

  // Fallback: gap between sections — snap to nearest
  return sections[lo] ?? sections[hi];
}
```

#### `computeRatio(section, centerY): number`

Position within a section as a 0→1 ratio.

```typescript
/**
 * Compute how far centerY is within the section, as a ratio from 0 (top) to 1 (bottom).
 * Clamps to [0, 1] for positions outside the section bounds.
 */
export function computeRatio(section: SectionRect, centerY: number): number {
  if (section.offsetHeight === 0) return 0;
  const raw = (centerY - section.offsetTop) / section.offsetHeight;
  return Math.max(0, Math.min(1, raw));
}
```

#### `computeTargetScrollTop(matchingSection, ratio, containerHeight): number`

Target `scrollTop` for the other panel.

```typescript
/**
 * Compute the scrollTop value that places the matching section's proportional
 * position at the center of the container viewport.
 * Clamps to 0 minimum; the browser clamps the upper bound on assignment.
 */
export function computeTargetScrollTop(
  matchingSection: SectionRect,
  ratio: number,
  containerHeight: number,
): number {
  const targetCenterY = matchingSection.offsetTop + ratio * matchingSection.offsetHeight;
  return Math.max(0, targetCenterY - containerHeight / 2);
}
```

#### `getSectionRects(container): SectionRect[]`

Reads section layout from the DOM. Called on each scroll event (not cached, since layout can change).

```typescript
/**
 * Query all <section id="..."> elements in the container and return their
 * layout measurements. Results are naturally sorted by document order
 * (which matches visual top-to-bottom order).
 */
export function getSectionRects(container: HTMLDivElement): SectionRect[] {
  const elements = container.querySelectorAll<HTMLElement>('section[id]');
  const rects: SectionRect[] = [];
  for (const el of elements) {
    rects.push({
      id: el.id,
      offsetTop: el.offsetTop,
      offsetHeight: el.offsetHeight,
    });
  }
  return rects;
}
```

### Scroll Sync Flow

```
User scrolls Panel A
  → scroll event fires
  → check isProgrammaticScroll ref → if true, clear flag and return (loop prevention)
  → requestAnimationFrame gates the handler (debounce)
  → centerY = container.scrollTop + container.clientHeight / 2
  → sections = getSectionRects(panelA)
  → section = findSectionAtPosition(sections, centerY)
  → ratio = computeRatio(section, centerY)
  → targetSections = getSectionRects(panelB)
  → find matching section in targetSections by ID
  → if found:
      → targetScrollTop = computeTargetScrollTop(matchingSection, ratio, panelB.clientHeight)
      → set isProgrammaticScroll = true
      → panelB.scrollTop = targetScrollTop
  → if NOT found (section missing in Panel B):
      → no-op (skip sync — avoids scrolling to a potentially wrong position)
```

## 3. Hook Signature

```typescript
/**
 * Synchronize scroll position between two panels using proportional
 * section-based alignment. When enabled, scrolling one panel computes
 * the viewport center's position within the current section and maps
 * it to the corresponding section in the other panel.
 */
export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void;
```

Same signature as v1 — no API changes for consumers.

### Implementation Sketch

```typescript
import { useEffect, useRef, type RefObject } from 'react';
import {
  findSectionAtPosition,
  computeRatio,
  computeTargetScrollTop,
  getSectionRects,
} from '../lib/sync-scroll';

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
          const centerY = source.scrollTop + source.clientHeight / 2;
          const sourceSections = getSectionRects(source);
          const result = findSectionAtPosition(sourceSections, centerY);

          if (!result) return; // No sections loaded yet

          const ratio = computeRatio(result, centerY);
          const targetSections = getSectionRects(target);

          // Find matching section by ID
          const matchingSection = targetSections.find(
            (s) => s.id === result.id,
          );

          if (!matchingSection) return; // Section not in target — no-op

          const targetScrollTop = computeTargetScrollTop(
            matchingSection,
            ratio,
            target.clientHeight,
          );

          isProgrammaticScrollRef.current = true;
          target.scrollTop = targetScrollTop;
        });
      };
    };

    const handleScrollA = makeSyncHandler(panelA, panelB);
    const handleScrollB = makeSyncHandler(panelB, panelA);

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

## 4. Loop Prevention

v2 uses a **single boolean ref** — dramatically simpler than v1's 3-state `scrollSourceRef` + settling timeout.

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

## 5. Edge Cases

### Section exists in A but not B (added/removed sections)

When `findSectionAtPosition` returns a section whose ID has no match in the target panel, the handler returns early (no-op). This avoids scrolling to a potentially wrong position — a global ratio could land in a completely unrelated section. The target panel stays at its current position until the user scrolls to a section that exists in both panels.

### No sections loaded yet

`getSectionRects` returns an empty array → `findSectionAtPosition` returns `null` → handler returns early. No sync attempted.

### One panel shorter than the other

The proportional mapping handles this naturally. If Panel A's "Item 7" is 2000px tall and Panel B's is 500px, a ratio of 0.5 in Panel A maps to the midpoint of Panel B's "Item 7" — which is exactly the right behavior. The panels show corresponding content, not matching pixel offsets.

### Scroll position in preamble area (before first section)

`findSectionAtPosition` handles this: if `centerY < sections[0].offsetTop`, it returns the first section with the position clamped. `computeRatio` clamps to 0, so the target panel scrolls to the top of its first section. This is correct — the preamble (boilerplate headers, TOC) is typically identical between filings.

### Scroll position after last section

Similarly handled: `findSectionAtPosition` returns the last section, `computeRatio` clamps to 1, target panel scrolls to the bottom of its last section.

### Section has zero height

`computeRatio` returns 0 when `offsetHeight === 0`, preventing division by zero. The target panel scrolls to the top of the matching section.

### Sections loading asynchronously (pipeline states)

During `fetching`/`parsing`/`diffing`, `FilingPanel` renders spinners instead of `FilingContent` (see `FilingPanel.tsx:49-59`). No `<section>` elements exist in the DOM, so `getSectionRects` returns `[]` and the handler no-ops. Once content loads, sections appear and the next scroll event picks them up automatically — no MutationObserver needed because sections are queried fresh on every scroll.

### Toggle during scroll

When the user disables sync, the `useEffect` cleanup runs immediately, removing listeners. Any in-flight `rAF` callback will be a no-op if the listener is removed before it fires. If it fires after cleanup, it harmlessly sets `scrollTop` on the target (no crash, just one extra frame of sync — acceptable).

## 6. Files to Create / Modify

### New: `apps/web/src/lib/sync-scroll.ts`

Pure functions with zero React dependencies (operate on plain numbers):
- `SectionRect` interface
- `findSectionAtPosition()` — binary search, returns `SectionRect | null`
- `computeRatio()` — position-to-ratio mapping, clamped to [0, 1]
- `computeTargetScrollTop()` — ratio-to-scrollTop mapping, clamps to >= 0 (browser clamps upper bound)
- `getSectionRects()` — reads section layout from a container element (the only function touching the DOM)

### New: `apps/web/src/hooks/useSyncedScroll.ts`

React hook orchestrating the pure functions with DOM interaction:
- `useSyncedScroll()` — attaches scroll listeners, computes proportional positions, sets `scrollTop`
- Imports pure functions from `../lib/sync-scroll`

### Modify: `apps/web/src/App.tsx`

```typescript
// New import
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

## 7. What's Removed from v1

| v1 Concept | Why Removed |
|---|---|
| `IntersectionObserver` (2 instances) | Replaced by binary search over `offsetTop` — simpler, no async callbacks |
| `MutationObserver` | Sections queried fresh on each scroll via `querySelectorAll` — no need to watch for DOM changes |
| `SCROLL_SETTLE_MS` (150ms timeout) | `scrollTop` assignment is synchronous — no settling window needed |
| `lastSyncedSectionRef` | Proportional mapping naturally handles same-section scrolling (different ratios = different positions) |
| `scrollSourceRef` (3-state: 'none' / 'panelA' / 'panelB') | Replaced by single boolean `isProgrammaticScrollRef` |
| `scrollIntoView()` | Replaced by direct `scrollTop` assignment — no animation, no async behavior |
| `createSectionObserver()` factory | Not needed without IntersectionObserver |
| `observeSections()` helper | Not needed without IntersectionObserver |

## 8. Dependencies

Only React built-ins — no external libraries:

- `useEffect` — lifecycle for listeners
- `useRef` — mutable boolean for loop prevention
- `useCallback` — toggle handler in App.tsx
- `useState` — `syncEnabled` in App.tsx
- `RefObject` — type import for panel refs

Browser APIs used:
- `requestAnimationFrame` / `cancelAnimationFrame` — debouncing
- `querySelectorAll` — section discovery in `getSectionRects()` (already used throughout the app)
- `offsetTop` / `offsetHeight` / `scrollTop` / `clientHeight` / `scrollHeight` — layout measurements
- `CSS.escape` is **not needed** in v2 — sections are matched by ID via JS array `find()`, not `querySelector`

## 9. Performance Considerations

- **Scroll handler cost**: `getSectionRects` calls `querySelectorAll('section[id]')` and reads `offsetTop`/`offsetHeight` for ~10-30 elements. This is fast — layout values are cached by the browser until the next reflow, and `querySelectorAll` on a small set is O(n) with n < 50.
- **Binary search**: O(log n) for section lookup. With 30 sections, that's ~5 comparisons. Negligible.
- **rAF debouncing**: Ensures at most one handler execution per frame (16ms budget). The handler itself is sub-millisecond (DOM reads + arithmetic).
- **No forced reflows**: Reading `offsetTop`/`offsetHeight` can trigger reflow if the DOM was recently modified. In practice, scroll events don't modify the DOM, so these reads hit the browser's cached layout. The only write is `target.scrollTop`, which happens after all reads — no read-write-read interleaving.
- **No smooth scrolling overhead**: Direct `scrollTop` assignment is synchronous and doesn't trigger the browser's smooth scroll animation engine.
