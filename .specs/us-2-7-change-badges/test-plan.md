# US-2.7: Section Change Badges — Test Plan

## Overview

See [implementation-design.md](./implementation-design.md) for full architecture, types, and data flow.

This test plan covers two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — DOM structure, badge content, accessibility, data flow
2. **Visual validation** (Chrome DevTools MCP) — badge colors, positioning, summary layout (see `uat.md`)

### Test Ownership

| Area | Owner | Where specified |
|------|-------|-----------------|
| Unit tests (SN-U24–U52) | **Coder** — written during TDD | [implementation-design.md](./implementation-design.md) §3 |
| Integration tests (CC-U1–U9, DS-I1–I2, E2E-I1–I2) | **Tester** | This file, §3 |
| Boundary & error conditions | **Tester** — verified during integration | This file, §4–5 |
| BDD acceptance criteria | **Tester** — defines "done" | This file, §1 |
| UAT (visual validation) | **Tester** | `uat.md` (future) |

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

## 2. Unit Tests (Coder-Owned)

Unit tests for SectionNav (SN-U24–U52) are specified in [implementation-design.md](./implementation-design.md) §3. The coder writes these during TDD implementation. They are not repeated here.

---

## 3. Integration Tests (Tester-Owned)

File: `apps/web/src/App.test.tsx` (extends existing test file)

### 3.1 `countChanges` helper

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

### 3.2 Diff summary computation

| ID | Test | Rationale |
|----|------|-----------|
| DS-I1 | `diffSummary` counts sections by changeType: added, removed, modified (including reordered/moved), unchanged | Aggregation logic |
| DS-I2 | Reordered/moved sections are bucketed under "modified" in summary | Design decision verified |

### 3.3 End-to-end data flow

| ID | Test | Rationale |
|----|------|-----------|
| E2E-I1 | App.tsx maps `SectionDiff[]` → `SectionNavItem[]` including computed `changeCount` | Full data pipeline |
| E2E-I2 | App.tsx computes `diffSummary` from section changeTypes and passes it to SectionNav | Summary data flow |

---

## 4. Boundary Conditions

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

## 5. Error Conditions

| ID | Condition | Expected behavior |
|----|-----------|-------------------|
| EC-1 | `diffSummary` prop omitted | Summary bar not rendered; no crash |
| EC-2 | Sections array is empty AND `diffSummary` has non-zero counts | Summary renders; "No sections" message shown below |

---

## 6. Test Data Strategy

Unit test fixtures (SectionNav and `countChanges`) are specified in [implementation-design.md](./implementation-design.md) and owned by the coder.

### Integration test fixtures (tester-owned)

**SectionDiff fixtures for `countChanges` tests:**

| Fixture | Contents | Use case |
|---------|----------|----------|
| `sectionDiffParagraphsOnly` | SectionDiff with 3 modified paragraphDiffs, empty tableDiffs | Paragraph-only count |
| `sectionDiffTablesOnly` | SectionDiff with empty paragraphDiffs, 2 modified tableDiffs | Table-only count |
| `sectionDiffMixed` | SectionDiff with 2 modified paragraphs + 1 added table | Mixed count |
| `sectionDiffAllUnchanged` | SectionDiff with all unchanged paragraphs and tables | Zero count |
| `sectionDiffPartiallyChanged` | SectionDiff with 5 paragraphs (2 unchanged, 3 modified) | Filter verification |
| `sectionDiffWithSubsections` | SectionDiff with subsectionDiffs containing changes | Verifies no recursion |

**DiffSummary test data:**

| Fixture | Values | Use case |
|---------|--------|----------|
| `typicalSummary` | `{ added: 2, removed: 1, modified: 3, unchanged: 4 }` | Happy path |
| `allZeroSummary` | `{ added: 0, removed: 0, modified: 0, unchanged: 0 }` | Edge: nothing rendered |
| `modifiedOnlySummary` | `{ added: 0, removed: 0, modified: 5, unchanged: 0 }` | Single-category edge |

---

## 7. Test File Organization

```
apps/web/src/
  components/
    SectionNav.tsx           # Extended: changeCount prop, badge rendering, DiffSummary bar (inline)
    SectionNav.test.tsx      # Coder-owned: SN-U24–U52 (badges, summary, a11y, compat)
  App.tsx                    # Extended: countChanges() helper, diffSummary computation
  App.test.tsx               # Tester-owned: CC-U1–U9, DS-I1–I2, E2E-I1–I2 (integration tests)

.specs/us-2-7-change-badges/
  implementation-design.md  # Coder-owned: architecture + unit test specs
  test-plan.md              # Tester-owned: acceptance criteria, integration tests, boundary/error
  uat.md                    # Tester-owned: visual validation (future)
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 8. Testing Limitations (jsdom)

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No CSS computed styles | Cannot verify amber/green/red badge colors visually | Verify CSS class presence; UAT for visual check |
| No layout verification | Cannot verify badge positioning (right-aligned, inline) | Verify DOM order; UAT for positioning |
| No font/size rendering | Cannot verify badge text size matches design | Verify CSS classes; UAT for visual check |
| No scroll behavior | Cannot verify badges remain visible during scroll | UAT for scroll behavior |

See [implementation-design.md](./implementation-design.md) for the full list of what unit tests verify in jsdom.
