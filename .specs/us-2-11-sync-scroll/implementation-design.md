# US-2.11: Synchronized Scrolling — Implementation Design

## 1. Approach

Synchronized scrolling links the two filing panels so that scrolling in one panel automatically scrolls the other to the corresponding section. The implementation uses **section-based alignment** rather than pixel-proportional scrolling because:

- Filings have different lengths and content volumes per section
- Section IDs already exist in both panels (rendered by `FilingContent` as `<section id={sectionId}>`)
- The existing `useActiveSection` hook already solves "which section is most visible?" via IntersectionObserver
- `handleSectionClick` in `App.tsx:78-85` already demonstrates scrolling both panels to a section via `scrollIntoView`

**Strategy**: A new `useSyncedScroll` hook observes scroll events on both panels. When the user scrolls panel A, the hook detects which section became most visible (reusing the IntersectionObserver pattern from `useActiveSection`), then calls `scrollIntoView` on the matching section in panel B — and vice versa. A boolean flag prevents infinite scroll loops. A toggle in the Header lets the user enable/disable sync.

## 2. Files to Create / Modify

### New: `apps/web/src/hooks/useSyncedScroll.ts`

The core hook. Attaches scroll listeners and IntersectionObservers to both panel refs. Contains all loop-prevention and debouncing logic.

### Modify: `apps/web/src/App.tsx`

- Add `syncEnabled` state (`useState<boolean>(true)` — sync on by default)
- Call `useSyncedScroll(oldPanelRef, newPanelRef, syncEnabled)`
- Pass `syncEnabled` and `onSyncToggle` to `Header`

### Modify: `apps/web/src/components/Header.tsx`

- Add toggle button for sync scrolling
- Accept new props: `syncEnabled: boolean` and `onSyncToggle: () => void`

## 3. Interfaces and Types

### `useSyncedScroll` hook signature

```typescript
/** Settling window for smooth scroll animations (ms). Exported for test use. */
export const SCROLL_SETTLE_MS = 150;

/**
 * Synchronize scroll position between two panels based on section alignment.
 * When enabled, scrolling one panel scrolls the other to the matching section.
 */
export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void;
```

The hook is intentionally void-returning — it's a pure side-effect hook. No state is exposed to consumers because the scroll sync is self-contained.

The `SCROLL_SETTLE_MS` constant is exported so tests can reference it instead of hardcoding `150`. If we later switch to `behavior: 'instant'`, this constant can be reduced to `0` (or removed) in one place.

### Header props changes

```typescript
interface HeaderProps {
  syncEnabled?: boolean;
  onSyncToggle?: () => void;
}

export function Header({ syncEnabled, onSyncToggle }: HeaderProps) { ... }
```

Props are optional so Header remains backwards-compatible and testable in isolation.

### App.tsx additions

```typescript
// New state
const [syncEnabled, setSyncEnabled] = useState(true);

// Wire the hook (after existing ref declarations, App.tsx:73-74)
useSyncedScroll(oldPanelRef, newPanelRef, syncEnabled);

// Toggle callback
const handleSyncToggle = useCallback(() => {
  setSyncEnabled((prev) => !prev);
}, []);
```

## 4. Data Flow

### Scroll event propagation

```
User scrolls Panel A
  → scroll event fires on panelARef.current
  → requestAnimationFrame debounce gates the handler
  → IntersectionObserver reports which section is most visible in Panel A
  → If the active section changed since last sync:
      → Set "programmatic scroll" flag on Panel B
      → Find matching <section id="..."> in Panel B via querySelector
      → Call scrollIntoView({ behavior: 'smooth', block: 'start' }) on it
      → Clear "programmatic scroll" flag after scroll settles
```

### Loop prevention mechanism

The critical challenge is preventing A→B→A→B infinite scroll loops. The design uses a **ref-based source flag**:

```typescript
// Inside useSyncedScroll
const scrollSourceRef = useRef<'none' | 'panelA' | 'panelB'>('none');
const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
```

**How it works:**

1. When Panel A's scroll handler fires and `scrollSourceRef.current` is `'none'` or `'panelA'`:
   - Set `scrollSourceRef.current = 'panelA'`
   - Scroll Panel B to the matching section
   - Start/reset a timeout (150ms) that resets `scrollSourceRef` to `'none'`
2. When Panel B's scroll handler fires and sees `scrollSourceRef.current === 'panelA'`:
   - **Skip** — this scroll was programmatically triggered by syncing from A
3. The 150ms timeout provides a settling window for `scrollIntoView`'s smooth animation to complete

This is simpler and more robust than MutationObserver-based approaches because it uses a single shared ref with no cleanup edge cases.

### Section detection via IntersectionObserver

Each panel gets its own IntersectionObserver (same pattern as `useActiveSection.ts:20-47`):

```typescript
function createSectionObserver(
  container: HTMLDivElement,
  onActiveSectionChange: (sectionId: string) => void,
): IntersectionObserver {
  const ratioMap = new Map<string, number>();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        ratioMap.set(entry.target.id, entry.intersectionRatio);
      }
      let bestId = '';
      let bestRatio = 0;
      for (const [id, ratio] of ratioMap) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = id;
        }
      }
      if (bestId && bestRatio > 0) {
        onActiveSectionChange(bestId);
      }
    },
    { root: container, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] },
  );

  return observer;
}
```

The callback fires `scrollIntoView` on the matching section in the **other** panel — but only if the source flag permits it.

### Complete hook implementation sketch

```typescript
export function useSyncedScroll(
  panelARef: RefObject<HTMLDivElement | null>,
  panelBRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void {
  const scrollSourceRef = useRef<'none' | 'panelA' | 'panelB'>('none');
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastSyncedSectionRef = useRef<string>('');

  useEffect(() => {
    const panelA = panelARef.current;
    const panelB = panelBRef.current;
    if (!panelA || !panelB || !enabled) return;

    // Track active section per panel via IntersectionObserver
    let activeSectionA = '';
    let activeSectionB = '';

    const observerA = createSectionObserver(panelA, (id) => {
      activeSectionA = id;
    });
    const observerB = createSectionObserver(panelB, (id) => {
      activeSectionB = id;
    });

    // Observe all sections in each panel
    const observeSections = (container: HTMLDivElement, observer: IntersectionObserver) => {
      const sections = container.querySelectorAll<HTMLElement>('section[id]');
      for (const section of sections) {
        observer.observe(section);
      }
    };
    observeSections(panelA, observerA);
    observeSections(panelB, observerB);

    // Scroll handler factory
    const makeScrollHandler = (
      sourcePanel: 'panelA' | 'panelB',
      getActiveSection: () => string,
      targetContainer: HTMLDivElement,
    ) => {
      let rafId = 0;
      return () => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          // Skip if this scroll was triggered by syncing from the other panel
          if (scrollSourceRef.current !== 'none' && scrollSourceRef.current !== sourcePanel) {
            return;
          }

          const activeId = getActiveSection();
          if (!activeId || activeId === lastSyncedSectionRef.current) return;

          const target = targetContainer.querySelector(`#${CSS.escape(activeId)}`);
          if (!target) return; // Section not found in other panel

          scrollSourceRef.current = sourcePanel;
          lastSyncedSectionRef.current = activeId;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });

          // Reset source flag after scroll animation settles
          clearTimeout(scrollTimeoutRef.current);
          scrollTimeoutRef.current = setTimeout(() => {
            scrollSourceRef.current = 'none';
          }, SCROLL_SETTLE_MS);
        });
      };
    };

    const handleScrollA = makeScrollHandler('panelA', () => activeSectionA, panelB);
    const handleScrollB = makeScrollHandler('panelB', () => activeSectionB, panelA);

    panelA.addEventListener('scroll', handleScrollA, { passive: true });
    panelB.addEventListener('scroll', handleScrollB, { passive: true });

    return () => {
      panelA.removeEventListener('scroll', handleScrollA);
      panelB.removeEventListener('scroll', handleScrollB);
      observerA.disconnect();
      observerB.disconnect();
      clearTimeout(scrollTimeoutRef.current);
      scrollSourceRef.current = 'none';
      lastSyncedSectionRef.current = '';
    };
  }, [panelARef, panelBRef, enabled]);
}
```

### MutationObserver for dynamic content

Since sections load asynchronously (diff pipeline states: `fetching` → `parsing` → `diffing` → done), sections may appear after the initial effect runs. A MutationObserver watches for `<section>` elements being added/removed:

```typescript
// Inside the useEffect, after initial observeSections calls:
const mutationObserver = new MutationObserver(() => {
  // Re-observe sections when DOM changes
  observerA.disconnect();
  observerB.disconnect();
  observeSections(panelA, observerA);
  observeSections(panelB, observerB);
});
mutationObserver.observe(panelA, { childList: true, subtree: true });
mutationObserver.observe(panelB, { childList: true, subtree: true });

// In cleanup:
mutationObserver.disconnect();
```

## 5. Dependencies

Only React built-ins — no external libraries needed:

- `useEffect` — lifecycle for listeners and observers
- `useRef` — mutable flags for loop prevention and timeout handles
- `useCallback` — for toggle handler in App.tsx
- `useState` — for `syncEnabled` in App.tsx
- `RefObject` — type import for panel refs

Browser APIs used:
- `IntersectionObserver` (already used in `useActiveSection`)
- `MutationObserver` (for dynamic section loading)
- `requestAnimationFrame` (debouncing)
- `scrollIntoView` (already used in `App.tsx:83`)
- `CSS.escape` (already used in `App.tsx:82`)

## 6. Edge Cases

### Filings with different section counts

When a section exists in Panel A but not in Panel B (e.g., a section was added or removed), the `querySelector(`#${CSS.escape(activeId)}`)` call returns `null`. The handler simply returns without scrolling — Panel B stays at its current position. This is the correct UX: if there's no corresponding section, don't jump to an arbitrary location.

### Very small sections

Small sections may never reach a high intersection ratio if they're between two large sections. The observer thresholds `[0, 0.1, 0.25, 0.5, 0.75, 1.0]` handle this — even a 10% visibility will register. The "best ratio" algorithm picks whichever section is most visible, even if only partially.

### Very large sections

Large sections (taller than viewport) will have low intersection ratios since only a portion is visible. The same "best ratio" algorithm handles this correctly — a large section at 25% visible still beats a zero-visible neighbor.

### Rapid scrolling

`requestAnimationFrame` naturally debounces scroll events to ~16ms per frame. Combined with `lastSyncedSectionRef` deduplication (only scroll when the active section *changes*), rapid scrolling through the same section won't trigger redundant `scrollIntoView` calls. When scrolling quickly through multiple sections, each new section detection triggers a smooth scroll in the other panel — the browser's native smooth scroll behavior handles interrupting prior animations.

### Sections loading asynchronously

The diff pipeline goes through `fetching` → `parsing` → `diffing` → `done`. During these states, `FilingPanel` shows loading spinners instead of `FilingContent` (see `FilingPanel.tsx:49-59`). The panel ref's scrollable div contains the spinner, not section elements, so:

- IntersectionObservers find no `section[id]` elements → no sync triggers
- Once content loads, the MutationObserver detects new `<section>` elements and re-registers them with the IntersectionObservers

### Both panels empty (no filings selected)

When no filings are selected, `FilingPanel` renders placeholder text (`FilingPanel.tsx:63-65`). No `section[id]` elements exist, so observers have nothing to observe. The hook is effectively inert. When the user later selects filings and content appears, the MutationObserver picks up the new sections.

### Toggle during active scroll

If the user disables sync while a smooth scroll animation is in progress, the `useEffect` cleanup runs immediately (because `enabled` changed). This disconnects listeners and observers, but the browser's in-progress `scrollIntoView` animation continues to completion. This is acceptable — the animation was already initiated and will finish naturally. No further sync events will fire because the scroll listener has been removed.

### Same section active in both panels

The `lastSyncedSectionRef` prevents redundant `scrollIntoView` calls when both panels are already showing the same section. This is the common state after a manual section click (which already scrolls both panels via `handleSectionClick`).

## 7. Open Questions

### Toggle placement: Header vs SectionNav

**Recommendation: Header** (`Header.tsx`)

Rationale:
- The Header currently has empty space to the right of "Edgar-Differ" (`Header.tsx:3`)
- SectionNav is already dense with diff summary badges and the section list
- Sync scroll is a global app behavior, not section-specific — Header is semantically correct
- The toggle is always visible regardless of scroll position in SectionNav

Implementation: A simple button with a link/unlink icon and sr-only label.

```tsx
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
          <span aria-hidden="true">{syncEnabled ? '\u{1F517}' : '\u{26D3}'}</span>
          <span>Sync Scroll</span>
        </button>
      )}
    </header>
  );
}
```

> **Note**: The emoji icons above (link/broken chain) are placeholders for design review. An SVG icon (e.g., Heroicons `link`/`link-slash`) would be more polished. The implementation phase should decide.

### Smooth vs instant scrolling

**Recommendation: `behavior: 'smooth'`**

Rationale:
- Smooth scrolling provides visual feedback that panels are linked
- Existing `handleSectionClick` already uses `smooth` (`App.tsx:83`), so it's consistent
- The 150ms settling timeout in loop prevention is calibrated for smooth scroll

Alternative consideration: `behavior: 'instant'` would eliminate the settling timeout entirely and make the loop-prevention flag unnecessary (since the scroll completes synchronously). However, the abrupt jump is jarring UX. If performance testing shows smooth scroll causes issues, `instant` is a viable fallback.

### Performance considerations

- Each panel has its own IntersectionObserver — two observers total. This is lightweight since they share the same threshold config and section sets are small (10-30 sections typical for SEC filings).
- Scroll events fire at 60fps but are gated by `requestAnimationFrame` (one handler execution per frame).
- `scrollIntoView` is browser-native and GPU-accelerated.
- The MutationObserver fires only on structural DOM changes (section elements added/removed), not on every attribute change.

No performance issues are expected for typical filing sizes. If profiling reveals issues, the first optimization would be to increase the settling timeout to reduce `scrollIntoView` call frequency.
