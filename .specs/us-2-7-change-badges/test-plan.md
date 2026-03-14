# US-2.7: Section Change Badges — Test Plan

## Overview

See [implementation-design.md](./implementation-design.md) for full architecture, types, and data flow.

This test plan covers two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — DOM structure, badge content, accessibility, data flow
2. **Visual validation** (Chrome DevTools MCP) — badge colors, positioning, summary layout (see `uat.md`)

### Test Ownership

| Owner | Tests | Scope |
|-------|-------|-------|
| **Coder** (TDD) | SN-U24–U52 | SectionNav unit tests: badges, summary bar, accessibility, backward compat |
| **Coder** (TDD) | CC-U1–U9 | `countChanges()` helper unit tests |
| **Tester** | DS-I1–I2, E2E-I1–I2 | Integration tests: summary computation, App.tsx data flow |
| **Tester** | UAT (`uat.md`) | Visual validation via Chrome DevTools MCP |

### Test-Relevant Design Decisions

- `changeCount: number` is **required** on `SectionNavItem`; test helper defaults to `0`
- Badge guard: `changeCount > 0` (no null check needed)
- Added/Removed sections keep text badges; only modified/reordered/moved show numeric count
- Diff summary bar omits zero-count categories; fully suppressed when all counts are 0
- `countChanges()` is exported from App.tsx for direct unit testing
- Subsection diffs are NOT recursively counted

---

## 1. BDD Acceptance Criteria

### AC-1: Modified section shows change count badge

```gherkin
Scenario: A modified section with changes shows an amber badge with count
  Given a SectionNav with a section that has changeType='modified' and changeCount=5
  When the section navigation is rendered
  Then the section button displays an amber badge with text "5 changes"
```

### AC-2: Zero-change modified section shows no badge

```gherkin
Scenario: A modified section with no changes shows no badge
  Given a SectionNav with a section that has changeType='modified' and changeCount=0
  When the section navigation is rendered
  Then no badge is displayed for that section
```

### AC-3: Added section shows "Added" text badge

```gherkin
Scenario: An added section shows "Added" text badge (unchanged from current behavior)
  Given a section with changeType='added'
  When the section navigation is rendered
  Then the badge shows "Added" with green styling
  And the changeCount value is ignored for badge display
```

### AC-4: Removed section shows "Removed" text badge

```gherkin
Scenario: A removed section shows "Removed" text badge (unchanged from current behavior)
  Given a section with changeType='removed'
  When the section navigation is rendered
  Then the badge shows "Removed" with red styling
  And the changeCount value is ignored for badge display
```

### AC-5: Unchanged section shows no badge

```gherkin
Scenario: An unchanged section does not display a badge
  Given a section with changeType='unchanged'
  When the section navigation is rendered
  Then no badge is displayed for that section
```

### AC-6: Diff summary bar shows aggregate totals

```gherkin
Scenario: Diff summary shows aggregate section-level counts above section list
  Given a SectionNav with diffSummary prop { added: 2, removed: 1, modified: 3, unchanged: 4 }
  When the section navigation is rendered
  Then a summary bar with role="status" appears above the section list
  And it displays "3 modified", "2 added", "1 removed", "4 unchanged"
```

### AC-7: Diff summary omits zero-count categories

```gherkin
Scenario: Diff summary hides categories with zero count
  Given a SectionNav with diffSummary { added: 0, removed: 0, modified: 3, unchanged: 2 }
  When the section navigation is rendered
  Then the summary bar shows "3 modified" and "2 unchanged"
  And "added" and "removed" labels are not displayed
```

### AC-8: Badge reflects combined paragraph and table changes

```gherkin
Scenario: Badge count includes both paragraph and table changes
  Given a SectionDiff with 3 modified paragraphDiffs and 2 modified tableDiffs
  When countChanges() computes the change count
  Then the result is 5
```

### AC-9: Singular change count

```gherkin
Scenario: A section with exactly 1 change shows singular text
  Given a section with changeType='modified' and changeCount=1
  When the section navigation is rendered
  Then the badge shows "1 change" (not "1 changes")
```

---

## 2. Unit Tests — `SectionNav` Component

**Owner: Coder** (written during TDD implementation)

File: `apps/web/src/components/SectionNav.test.tsx` (extends existing test file)

Continue SN-U numbering from SN-U24.

### 2.1 Badge rendering

| ID | Test | Rationale |
|----|------|-----------|
| SN-U24 | Modified section with `changeCount=5` renders amber badge with text "5 changes" | Badge displays count with label (AC-1) |
| SN-U25 | Modified section with `changeCount=1` renders badge with "1 change" (singular) | Singular/plural (AC-9) |
| SN-U26 | Modified section with `changeCount=0` renders no badge | Zero-change = no badge (AC-2) |
| SN-U27 | Unchanged section renders no badge regardless of changeCount | Unchanged = no badge (AC-5) |
| SN-U28 | Added section renders "Added" text badge (ignores changeCount) | Added keeps text badge (AC-3) |
| SN-U29 | Removed section renders "Removed" text badge (ignores changeCount) | Removed keeps text badge (AC-4) |
| SN-U30 | Amber badge has correct styling classes (`text-amber-700 bg-amber-100`) | Color verification |

### 2.2 Badge colors / changeTypes

| ID | Test | Rationale |
|----|------|-----------|
| SN-U31 | Reordered section with `changeCount > 0` renders amber badge (same as modified) | Reordered treated as modified |
| SN-U32 | Moved section with `changeCount > 0` renders amber badge (same as modified) | Moved treated as modified |
| SN-U33 | Badge is rendered inside the section button element | Badge visually associated with section |
| SN-U34 | Each section renders its own badge with its own count independently | Per-section independent rendering |

### 2.3 Badge interaction with existing features

| ID | Test | Rationale |
|----|------|-----------|
| SN-U35 | Active section with a badge still shows active styling (bg-blue-100) on the button | Badge doesn't break active state |
| SN-U36 | Section with badge still triggers `onSectionClick` with correct id when clicked | Badge doesn't interfere with click handling |
| SN-U37 | Section heading text is still truncated when long, even with badge present | Truncation still works with badge |

### 2.4 Badge accessibility

| ID | Test | Rationale |
|----|------|-----------|
| SN-U38 | Modified badge has `aria-label` with count (e.g., "5 changes") | Screen reader announces count |
| SN-U39 | Added badge has `aria-label="Section added"` | Screen reader announces addition |
| SN-U40 | Removed badge has `aria-label="Section removed"` | Screen reader announces removal |

### 2.5 Backward compatibility

| ID | Test | Rationale |
|----|------|-----------|
| SN-U41 | Section with `changeCount=0` (default) renders no badge | Backward compat — existing fixtures default to 0 |
| SN-U42 | Existing tests still pass with updated `SectionNavItem` interface (`makeSectionNavItem` defaults changeCount to 0) | No regressions |

### 2.6 Diff summary bar

| ID | Test | Rationale |
|----|------|-----------|
| SN-U43 | DiffSummary bar renders when `diffSummary` prop is provided | Conditional rendering |
| SN-U44 | DiffSummary bar is NOT rendered when `diffSummary` prop is omitted | Backward compatibility |
| SN-U45 | DiffSummary bar omits zero-count categories | Zero-hiding behavior (AC-7) |
| SN-U46 | DiffSummary bar shows correct counts with labels (e.g., "3 modified", "2 added") | Content accuracy (AC-6) |
| SN-U47 | DiffSummary bar has `role="status"` and `aria-label="Diff summary"` | Accessibility |
| SN-U48 | DiffSummary bar renders between "Sections" heading and section list in DOM order | Correct positioning |
| SN-U49 | Modified count in summary bar has amber styling (`text-amber-700 bg-amber-100`) | Color coding |
| SN-U50 | Added count in summary bar has green styling (`text-green-700 bg-green-100`) | Color coding |
| SN-U51 | Removed count in summary bar has red styling (`text-red-700 bg-red-100`) | Color coding |
| SN-U52 | Unchanged count in summary bar has gray styling (`text-gray-500 bg-gray-100`) | Color coding |

---

## 3. Unit Tests — `countChanges` Helper

**Owner: Coder** (written during TDD implementation)

File: co-located with `countChanges` (likely `apps/web/src/App.test.tsx` or extracted utility test file)

| ID | Test | Rationale |
|----|------|-----------|
| CC-U1 | `countChanges(sectionDiff)` returns count of non-unchanged paragraphDiffs + non-unchanged tableDiffs | Core computation (AC-8) |
| CC-U2 | SectionDiff with 3 modified paragraphs and empty `tableDiffs` → returns 3 | Paragraph-only section |
| CC-U3 | SectionDiff with empty `paragraphDiffs` and 2 modified tableDiffs → returns 2 | Table-only section |
| CC-U4 | SectionDiff with 2 modified paragraphs and 1 added table → returns 3 | Mixed content |
| CC-U5 | SectionDiff with all unchanged paragraphs and tables → returns 0 | All unchanged = zero |
| CC-U6 | SectionDiff with empty `paragraphDiffs: []` and empty `tableDiffs: []` → returns 0 | Empty arrays |
| CC-U7 | 5 paragraphs total, 2 unchanged → returns 3 | Unchanged filtered out correctly |
| CC-U8 | All non-unchanged changeTypes counted: added, removed, modified, reordered, moved all contribute | Filter correctness |
| CC-U9 | Subsection diffs are NOT recursively counted (section with subsectionDiffs returns count of direct children only) | Documents design constraint |

---

## 4. Integration Tests — App-Level Data Flow

**Owner: Tester** (written after implementation)

File: `apps/web/src/App.test.tsx` (extends existing test file)

### 4.1 Diff summary computation

| ID | Test | Rationale |
|----|------|-----------|
| DS-I1 | `diffSummary` counts sections by changeType: added, removed, modified (including reordered/moved), unchanged | Aggregation logic |
| DS-I2 | Reordered/moved sections are bucketed under "modified" in summary | Design decision verified |

### 4.2 End-to-end data flow

| ID | Test | Rationale |
|----|------|-----------|
| E2E-I1 | App.tsx maps `SectionDiff[]` → `SectionNavItem[]` including computed `changeCount` | Full data pipeline |
| E2E-I2 | App.tsx computes `diffSummary` from section changeTypes and passes it to SectionNav | Summary data flow |

---

## 5. Boundary Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| BC-1 | `changeCount = 0` for a modified section | No badge rendered |
| BC-2 | `changeCount = 1` | Badge shows "1 change" (singular) |
| BC-3 | Large `changeCount` (e.g., 999) | Badge shows "999 changes" — no truncation |
| BC-4 | Section with only paragraph changes (empty `tableDiffs`) | changeCount counts only paragraph changes |
| BC-5 | Section with only table changes (empty `paragraphDiffs`) | changeCount counts only table changes |
| BC-6 | All sections unchanged | No badges anywhere; summary shows only "N unchanged" |
| BC-7 | All sections have changes | Every modified/reordered/moved section shows a badge |
| BC-8 | Single section in list | Badge renders correctly |
| BC-9 | Mix of zero-change and non-zero-change sections | Only non-zero modified/reordered/moved sections show badges |
| BC-10 | All `diffSummary` counts are 0 | Summary bar not rendered (all categories hidden) |
| BC-11 | Section with `changeType='added'` and changeCount > 0 | Shows "Added" text badge, ignores changeCount |
| BC-12 | Negative `changeCount` (defensive) | Treated as 0 — no badge rendered |
| BC-13 | Many sections (20+) | Badges render correctly; nav scrolls as before |

---

## 6. Error Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| EC-1 | `diffSummary` prop omitted | Summary bar not rendered; no crash |
| EC-2 | Sections array is empty AND `diffSummary` has non-zero counts | Summary renders; "No sections" message shown below |

---

## 7. Test Data Strategy

### Extended fixture helper

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

### Update existing fixtures

The existing `standardSections` and `mixedChangeTypes` arrays use `makeSectionNavItem(id, heading, changeType)` — the helper defaults `changeCount` to `0`, so existing fixtures continue to work unchanged. No badge will be rendered for items with `changeCount=0`, preserving existing test behavior.

### New fixture arrays

| Fixture | Contents | Use case |
|---------|----------|----------|
| `sectionsWithCounts` | 4 sections: modified (5 changes), added (3 — ignored), removed (2 — ignored), unchanged (0) | Badge rendering + color tests |
| `sectionsAllUnchanged` | 3 sections all with `changeType='unchanged'` | No-badge boundary |
| `sectionsAllChanged` | 3 sections all modified with various counts (1, 10, 100) | All-badges boundary |
| `singleSection` | 1 section with `changeType='modified'`, `changeCount=7` | Single-item edge case |

### SectionDiff fixtures for `countChanges` tests

| Fixture | Contents | Use case |
|---------|----------|----------|
| `sectionDiffParagraphsOnly` | SectionDiff with 3 modified paragraphDiffs, empty tableDiffs | Paragraph-only count |
| `sectionDiffTablesOnly` | SectionDiff with empty paragraphDiffs, 2 modified tableDiffs | Table-only count |
| `sectionDiffMixed` | SectionDiff with 2 modified paragraphs + 1 added table | Mixed count |
| `sectionDiffAllUnchanged` | SectionDiff with all unchanged paragraphs and tables | Zero count |
| `sectionDiffPartiallyChanged` | SectionDiff with 5 paragraphs (2 unchanged, 3 modified) | Filter verification |
| `sectionDiffWithSubsections` | SectionDiff with subsectionDiffs containing changes | Verifies no recursion |

### DiffSummary test data

| Fixture | Values | Use case |
|---------|--------|----------|
| `typicalSummary` | `{ added: 2, removed: 1, modified: 3, unchanged: 4 }` | Happy path |
| `allZeroSummary` | `{ added: 0, removed: 0, modified: 0, unchanged: 0 }` | Edge: nothing rendered |
| `modifiedOnlySummary` | `{ added: 0, removed: 0, modified: 5, unchanged: 0 }` | Single-category edge |

---

## 8. Test File Organization

```
apps/web/src/
  components/
    SectionNav.tsx           # Extended: changeCount prop, badge rendering, DiffSummary bar (inline)
    SectionNav.test.tsx      # Extended: SN-U24 through SN-U52 (badges, summary, a11y, compat)
  App.tsx                    # Extended: countChanges() helper, diffSummary computation

.specs/us-2-7-change-badges/
  test-plan.md              # This file
  uat.md                    # Visual validation scenarios (future)
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 9. Testing Limitations (jsdom)

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No CSS computed styles | Cannot verify amber/green/red badge colors visually | Verify CSS class presence; UAT for visual check |
| No layout verification | Cannot verify badge positioning (right-aligned, inline) | Verify DOM order; UAT for positioning |
| No font/size rendering | Cannot verify badge text size matches design | Verify CSS classes; UAT for visual check |
| No scroll behavior | Cannot verify badges remain visible during scroll | UAT for scroll behavior |

### What jsdom CAN verify (and we test thoroughly)

- Badge text content ("5 changes", "1 change", "Added", "Removed")
- Correct CSS classes applied per changeType (amber/green/red)
- Badge not rendered when changeCount is 0 or negative
- Badge not rendered for unchanged sections
- Added/Removed sections show text badges (changeCount ignored)
- Badge rendered inside the correct button element
- `aria-label` on badges: "{n} changes" for modified, "Section added"/"Section removed" for added/removed
- DiffSummary renders correct counts with labels, omits zero-count categories
- DiffSummary has `role="status"`, `aria-label="Diff summary"`, correct DOM position
- DiffSummary not rendered when prop omitted
- Backward compatibility: existing test fixtures work with `changeCount` defaulting to `0`
- Click behavior and active section styling unaffected by badge presence
- `countChanges()` filters unchanged, handles empty arrays, handles all change types, does not recurse into subsections
