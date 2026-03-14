# US-2.7: Section Change Badges — Implementation Design

## Overview

Add change count badges to section nav items and a diff summary bar above the section list. Modified sections display an amber badge with the count of changed paragraphs + tables. Added/removed sections retain their existing colored text badges ("Added"/"Removed"). Unchanged sections show no badge.

## Design Decisions

1. **`changeCount` is required** — `changeCount: number`. All callers must provide it. The test helper `makeSectionNavItem` defaults to `0`, so existing test fixtures continue to work without modification. A value of `0` means no badge is rendered.

2. **Added/Removed sections keep text badges** — For `added`/`removed` changeTypes, the badge shows "Added"/"Removed" (not a numeric count). Rationale: the entire section is new/gone, so counting individual paragraph/table changes within it is misleading. The changeType badge communicates the important information.

3. **Modified sections show numeric count with label** — Badge text is `"{n} changes"` (or `"{n} change"` for singular). The label provides context for accessibility and clarity (bare "5" is ambiguous — 5 what?).

4. **DiffSummary hides zero-count categories** — Zero-count categories are omitted from the summary bar for visual cleanliness. If all counts are zero, the entire summary bar is suppressed (no empty container rendered).

5. **DiffSummary is inline in SectionNav** — Not a separate component file. The summary bar is small, tightly coupled to the nav, and doesn't warrant a separate file. This reduces file count and import complexity.

6. **Badges have `aria-label` attributes** — Each badge includes an `aria-label` for screen reader access (e.g., `"5 changes"`, `"Section added"`, `"Section removed"`).

## Data Flow

```
SectionDiff[] (paragraphDiffs, tableDiffs)
  → App.tsx computes changeCount per section
    → SectionNavItem { id, heading, changeType, changeCount }
      → SectionNav renders badge with count + color

SectionDiff[] (all sections)
  → App.tsx computes DiffSummaryData (aggregate totals)
    → SectionNav renders DiffSummary bar above section list
```

## Files to Modify

### 1. `apps/web/src/components/SectionNav.tsx`

**Changes:**

#### a) Update `SectionNavItem` interface

```typescript
export interface SectionNavItem {
  id: string;
  heading: string;
  changeType: ChangeType;
  /** Number of non-unchanged paragraph + table diffs within this section. */
  changeCount: number;
}
```

#### b) Add `DiffSummaryData` type and `diffSummary` prop

```typescript
export interface DiffSummaryData {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

interface SectionNavProps {
  sections: SectionNavItem[];
  activeSectionId?: string;
  onSectionClick?: (sectionId: string) => void;
  /** Aggregate diff totals displayed above the section list. */
  diffSummary?: DiffSummaryData;
}
```

#### c) Render DiffSummary bar

Add a summary bar between the "Sections" heading and the section list. Render only when `diffSummary` is provided AND at least one count is non-zero (BC-10: suppress entirely when all counts are 0 to avoid an empty container).

```tsx
{diffSummary && (diffSummary.added + diffSummary.removed + diffSummary.modified + diffSummary.unchanged > 0) && (
  <div className="mb-3 flex flex-wrap gap-2 text-xs" role="status" aria-label="Diff summary">
    {diffSummary.modified > 0 && (
      <span className="text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
        {diffSummary.modified} modified
      </span>
    )}
    {diffSummary.added > 0 && (
      <span className="text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
        {diffSummary.added} added
      </span>
    )}
    {diffSummary.removed > 0 && (
      <span className="text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
        {diffSummary.removed} removed
      </span>
    )}
    {diffSummary.unchanged > 0 && (
      <span className="text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
        {diffSummary.unchanged} unchanged
      </span>
    )}
  </div>
)}
```

#### d) Update badge rendering for each section

Replace the current added/removed-only badge rendering with a unified approach:

| changeType | Badge | Color |
|---|---|---|
| `modified` | `{changeCount} changes` | Amber (`text-amber-700 bg-amber-100`) |
| `added` | `Added` | Green (`text-green-700 bg-green-100`) — unchanged from current |
| `removed` | `Removed` | Red (`text-red-700 bg-red-100`) — unchanged from current |
| `unchanged` | No badge | — |
| `reordered` / `moved` | `{changeCount} changes` | Amber (same as modified) |

For `modified`/`reordered`/`moved` sections, only show the badge when `changeCount > 0`.

```tsx
{/* Added section — whole section is new */}
{section.changeType === 'added' && (
  <span
    className="inline-block mt-0.5 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded"
    aria-label="Section added"
  >
    Added
  </span>
)}

{/* Removed section — whole section is gone */}
{section.changeType === 'removed' && (
  <span
    className="inline-block mt-0.5 text-xs text-red-700 bg-red-100 px-1.5 py-0.5 rounded"
    aria-label="Section removed"
  >
    Removed
  </span>
)}

{/* Modified/reordered/moved — show change count when > 0 */}
{['modified', 'reordered', 'moved'].includes(section.changeType) && section.changeCount > 0 && (
  <span
    className="inline-block mt-0.5 text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
    aria-label={`${section.changeCount} ${section.changeCount === 1 ? 'change' : 'changes'}`}
  >
    {section.changeCount} {section.changeCount === 1 ? 'change' : 'changes'}
  </span>
)}
```

### 2. `apps/web/src/App.tsx`

**Changes:**

#### a) Compute `changeCount` per section

Add a helper function to count non-unchanged diffs within a section:

```typescript
function countChanges(section: SectionDiff): number {
  const paragraphChanges = section.paragraphDiffs.filter(
    (p) => p.changeType !== 'unchanged',
  ).length;
  const tableChanges = section.tableDiffs.filter(
    (t) => t.changeType !== 'unchanged',
  ).length;
  return paragraphChanges + tableChanges;
}
```

Export `countChanges` for unit testing. Update the sections mapping:

```typescript
const sections = useMemo(
  () =>
    sampleDiffs.map((sd) => ({
      id: sd.id,
      heading: sd.heading,
      changeType: sd.changeType,
      changeCount: countChanges(sd),
    })),
  [sampleDiffs],
);
```

Note: For `added`/`removed` sections, `changeCount` is still computed but the SectionNav component ignores it (shows text badge instead).

#### b) Compute `diffSummary` from section-level changeTypes

```typescript
const diffSummary = useMemo(() => {
  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const sd of sampleDiffs) {
    if (sd.changeType === 'added') summary.added++;
    else if (sd.changeType === 'removed') summary.removed++;
    else if (sd.changeType === 'modified' || sd.changeType === 'reordered' || sd.changeType === 'moved')
      summary.modified++;
    else summary.unchanged++;
  }
  return summary;
}, [sampleDiffs]);
```

Pass to SectionNav:

```tsx
<SectionNav
  sections={sections}
  activeSectionId={activeSectionId}
  onSectionClick={handleSectionClick}
  diffSummary={diffSummary}
/>
```

### 3. `apps/web/src/components/SectionNav.test.tsx` (Coder-owned, TDD)

**Test ownership:** The coder writes all unit tests below during TDD. Integration tests and UAT are owned by the tester — see [test-plan.md](./test-plan.md) for those.

#### a) Update fixture helpers

Update `makeSectionNavItem` to accept `changeCount` with default `0`:

```typescript
function makeSectionNavItem(
  id: string,
  heading: string,
  changeType: ChangeType = 'modified',
  changeCount: number = 0,
): SectionNavItem {
  return { id, heading, changeType, changeCount };
}
```

Existing fixtures (`standardSections`, `mixedChangeTypes`) continue to work unchanged since `changeCount` defaults to `0`.

#### b) Change count badges (section 2.6)

| Test ID | Description |
|---|---|
| SN-U24 | Modified section with changeCount=5 renders amber badge with "5 changes" |
| SN-U25 | Modified section with changeCount=1 renders "1 change" (singular) |
| SN-U26 | Modified section with changeCount=0 renders no badge |
| SN-U27 | Unchanged section renders no badge regardless of changeCount |
| SN-U28 | Added section renders "Added" text badge (ignores changeCount) |
| SN-U29 | Removed section renders "Removed" text badge (ignores changeCount) |
| SN-U30 | Amber badge has correct styling classes (`text-amber-700 bg-amber-100`) |

#### c) Badge colors and changeTypes (section 2.7)

| Test ID | Description |
|---|---|
| SN-U31 | Reordered section with changeCount > 0 renders amber badge |
| SN-U32 | Moved section with changeCount > 0 renders amber badge |
| SN-U33 | Badge is rendered inside the section button element |
| SN-U34 | Each section renders its own badge with its own count independently |

#### d) Badge interaction with existing features (section 2.8)

| Test ID | Description |
|---|---|
| SN-U35 | Active section with a badge still shows active styling (bg-blue-100) |
| SN-U36 | Section with badge still triggers onSectionClick with correct id |
| SN-U37 | Long heading with badge: heading text still has truncate class |

#### e) Badge accessibility (section 2.9)

| Test ID | Description |
|---|---|
| SN-U38 | Modified badge has aria-label "5 changes" |
| SN-U39 | Added badge has aria-label "Section added" |
| SN-U40 | Removed badge has aria-label "Section removed" |

#### f) Backward compatibility (section 2.10)

| Test ID | Description |
|---|---|
| SN-U41 | Section with changeCount=0 (default) renders no badge |
| SN-U42 | Existing test fixtures with default changeCount=0 continue to pass |

#### g) Diff summary bar (section 2.11)

| Test ID | Description |
|---|---|
| SN-U43 | DiffSummary bar renders when `diffSummary` prop is provided |
| SN-U44 | DiffSummary bar is NOT rendered when `diffSummary` prop is omitted |
| SN-U45 | DiffSummary bar omits zero-count categories |
| SN-U46 | DiffSummary bar shows correct counts with labels |
| SN-U47 | DiffSummary bar has `role="status"` and `aria-label="Diff summary"` |
| SN-U48 | DiffSummary bar renders between heading and section list in DOM order |
| SN-U49 | Modified count in summary bar has amber styling |
| SN-U50 | Added count in summary bar has green styling |
| SN-U51 | Removed count in summary bar has red styling |
| SN-U52 | Unchanged count in summary bar has gray styling |

### 4. `apps/web/src/fixtures/sample-diff.ts`

**No changes required.** The existing `buildSampleDiffs` already produces sections with mixed `paragraphDiffs` and `tableDiffs` that have various `changeType` values, which will produce non-zero `changeCount` values when computed by `App.tsx`.

## Edge Cases

| Scenario | Behavior |
|---|---|
| Section with 0 paragraph/table changes | No badge shown (changeCount === 0 suppresses the badge) |
| changeCount is negative (defensive) | Treated as 0 — no badge rendered |
| All sections unchanged | No badges on any section; diffSummary shows only "N unchanged" |
| Very large change count (100+) | Display raw number; no truncation needed — the badge text is short |
| Section with only table changes | changeCount reflects table diff count; badge still shown |
| Section with only paragraph changes | changeCount reflects paragraph diff count; badge still shown |
| Added/removed sections | Show "Added"/"Removed" text; changeCount is ignored |
| Mixed changeTypes in diffSummary | All non-zero categories displayed in summary bar |
| All diffSummary counts are 0 | Summary bar not rendered (all categories hidden) |
| Single section in list | Badge renders correctly |
| Many sections (20+) | Badges render correctly; nav scrolls as before |
| Subsections | Subsection diffs are NOT counted — changeCount only covers direct children (`paragraphDiffs` + `tableDiffs`). Subsection handling is deferred to a future story. |

## Open Questions

1. **Subsection counting** — Should `changeCount` recurse into `subsectionDiffs`? The current design only counts direct `paragraphDiffs` and `tableDiffs`. Recursive counting would give a fuller picture but may be confusing for deeply nested sections. **Recommendation:** Keep flat for now; revisit when subsection rendering is implemented.

2. **DiffSummary scope** — The summary currently counts section-level `changeType` values (e.g., "5 modified sections"). An alternative is to show paragraph/table-level totals across all sections (e.g., "23 paragraphs changed, 4 tables changed"). **Recommendation:** Section-level counts are more useful at the navigation level; paragraph/table-level detail belongs in the filing panel.

3. **Badge for reordered/moved** — These changeTypes exist in the type system but aren't produced by `buildSampleDiffs` yet. The design treats them identically to `modified` (amber badge with count). **Recommendation:** Acceptable; adjust if distinct styling is needed later.

## Implementation Order

1. Update `SectionNavItem` interface and `SectionNav` component (badges + summary bar)
2. Update `App.tsx` (compute `changeCount` + `diffSummary`)
3. Update tests (`SectionNav.test.tsx`)
4. Manual UAT verification via Chrome DevTools MCP
