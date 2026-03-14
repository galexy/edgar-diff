import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SectionNav } from './SectionNav';
import type { SectionNavItem, DiffSummaryData } from './SectionNav';
import type { ChangeType } from '@edgar-diff/lib';

// --- Fixture helpers ---

function makeSectionNavItem(
  id: string,
  heading: string,
  changeType: ChangeType = 'modified',
  changeCount = 0,
): SectionNavItem {
  return { id, heading, changeType, changeCount };
}

const standardSections: SectionNavItem[] = [
  makeSectionNavItem('item-1', 'Item 1. Business'),
  makeSectionNavItem('item-1a', 'Item 1A. Risk Factors'),
  makeSectionNavItem('item-2', 'Item 2. Properties'),
  makeSectionNavItem('item-7', 'Item 7. MD&A'),
  makeSectionNavItem('item-7a', 'Item 7A. Quant. Disclosures'),
  makeSectionNavItem('item-8', 'Item 8. Financial Statements'),
];

const mixedChangeTypes: SectionNavItem[] = [
  makeSectionNavItem('s-added', 'New Section', 'added'),
  makeSectionNavItem('s-removed', 'Old Section', 'removed'),
  makeSectionNavItem('s-modified', 'Changed Section', 'modified'),
  makeSectionNavItem('s-unchanged', 'Same Section', 'unchanged'),
];

// --- Tests ---

describe('SectionNav', () => {
  // 2.1 Rendering from props

  // SN-U1: Renders a <nav> with aria-labelledby referencing "Sections" heading
  it('renders a <nav> element with aria-labelledby referencing the "Sections" heading', () => {
    render(<SectionNav sections={standardSections} />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveAttribute('aria-labelledby', 'section-nav-heading');
  });

  // SN-U2: Renders one button per entry in sections prop
  it('renders one button per entry in sections prop', () => {
    render(<SectionNav sections={standardSections} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(standardSections.length);
  });

  // SN-U3: Each button's text matches the section's heading
  it("each button's text content matches the section's heading", () => {
    render(<SectionNav sections={standardSections} />);
    for (const section of standardSections) {
      expect(screen.getByText(section.heading)).toBeInTheDocument();
    }
  });

  // SN-U4: Renders sections in the same order as the sections array
  it('renders sections in the same order as the sections array', () => {
    render(<SectionNav sections={standardSections} />);
    const buttons = screen.getAllByRole('button');
    for (let i = 0; i < standardSections.length; i++) {
      expect(buttons[i]).toHaveTextContent(standardSections[i].heading);
    }
  });

  // SN-U5: Empty sections array renders "No sections" message
  it('renders "No sections" message when sections is empty', () => {
    render(<SectionNav sections={[]} />);
    expect(screen.getByText(/no sections/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  // 2.2 Click behavior

  // SN-U6: Clicking a section button calls onSectionClick with the section's id
  it("clicking a section button calls onSectionClick with the section's id", () => {
    const onClick = vi.fn();
    render(<SectionNav sections={standardSections} onSectionClick={onClick} />);

    fireEvent.click(screen.getByText('Item 1A. Risk Factors'));
    expect(onClick).toHaveBeenCalledWith('item-1a');
  });

  // SN-U7: Clicking different sections calls onSectionClick with correct ids
  it('clicking different sections calls onSectionClick with correct respective ids', () => {
    const onClick = vi.fn();
    render(<SectionNav sections={standardSections} onSectionClick={onClick} />);

    fireEvent.click(screen.getByText('Item 1. Business'));
    expect(onClick).toHaveBeenCalledWith('item-1');

    fireEvent.click(screen.getByText('Item 7. MD&A'));
    expect(onClick).toHaveBeenCalledWith('item-7');
  });

  // SN-U8: If onSectionClick is not provided, clicking does not throw
  it('clicking does not throw if onSectionClick is not provided', () => {
    render(<SectionNav sections={standardSections} />);

    expect(() => {
      fireEvent.click(screen.getByText('Item 1. Business'));
    }).not.toThrow();
  });

  // 2.3 Active section highlighting

  // SN-U9: Active button has aria-current="true"
  it('active section button has aria-current="true"', () => {
    render(<SectionNav sections={standardSections} activeSectionId="item-1a" />);
    const activeButton = screen.getByText('Item 1A. Risk Factors').closest('button');
    expect(activeButton).toHaveAttribute('aria-current', 'true');
  });

  // SN-U10: Active button has bg-blue-100 CSS class
  it('active section button has bg-blue-100 CSS class', () => {
    render(<SectionNav sections={standardSections} activeSectionId="item-1a" />);
    const activeButton = screen.getByText('Item 1A. Risk Factors').closest('button');
    expect(activeButton?.className).toContain('bg-blue-100');
  });

  // SN-U11: Non-active buttons do NOT have aria-current="true"
  it('non-active section buttons do NOT have aria-current', () => {
    render(<SectionNav sections={standardSections} activeSectionId="item-1a" />);
    const buttons = screen.getAllByRole('button');
    const nonActive = buttons.filter(
      (b) => b.textContent?.includes('Item 1A. Risk Factors') === false,
    );
    for (const button of nonActive) {
      expect(button).not.toHaveAttribute('aria-current');
    }
  });

  // SN-U12: When activeSectionId is undefined, no button has aria-current
  it('no button has aria-current when activeSectionId is undefined', () => {
    render(<SectionNav sections={standardSections} />);
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button).not.toHaveAttribute('aria-current');
    }
  });

  // SN-U13: When activeSectionId changes, previously active button loses style
  it('previously active button loses active style when activeSectionId changes', () => {
    const { rerender } = render(
      <SectionNav sections={standardSections} activeSectionId="item-1" />,
    );
    const item1Button = screen.getByText('Item 1. Business').closest('button');
    expect(item1Button?.className).toContain('bg-blue-100');

    rerender(<SectionNav sections={standardSections} activeSectionId="item-7" />);
    expect(item1Button?.className).not.toContain('bg-blue-100');
    const item7Button = screen.getByText('Item 7. MD&A').closest('button');
    expect(item7Button?.className).toContain('bg-blue-100');
  });

  // 2.4 Change-type indicators

  // SN-U14: Added section renders "Added" badge text
  it('section with changeType "added" renders "Added" badge text', () => {
    render(<SectionNav sections={mixedChangeTypes} />);
    expect(screen.getByText('Added')).toBeInTheDocument();
  });

  // SN-U15: Removed section renders "Removed" badge text
  it('section with changeType "removed" renders "Removed" badge text', () => {
    render(<SectionNav sections={mixedChangeTypes} />);
    expect(screen.getByText('Removed')).toBeInTheDocument();
  });

  // SN-U16: Modified section does NOT render a badge
  it('section with changeType "modified" does NOT render a badge', () => {
    const sections = [makeSectionNavItem('s1', 'Modified Section', 'modified')];
    render(<SectionNav sections={sections} />);
    expect(screen.queryByText('Added')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed')).not.toBeInTheDocument();
  });

  // SN-U17: Unchanged section does NOT render a badge
  it('section with changeType "unchanged" does NOT render a badge', () => {
    const sections = [makeSectionNavItem('s1', 'Unchanged Section', 'unchanged')];
    render(<SectionNav sections={sections} />);
    expect(screen.queryByText('Added')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed')).not.toBeInTheDocument();
  });

  // SN-U18: Added badge has green styling class
  it('added badge has green styling classes', () => {
    render(<SectionNav sections={mixedChangeTypes} />);
    const badge = screen.getByText('Added');
    expect(badge.className).toContain('text-green-700');
    expect(badge.className).toContain('bg-green-100');
  });

  // SN-U19: Removed badge has red styling class
  it('removed badge has red styling classes', () => {
    render(<SectionNav sections={mixedChangeTypes} />);
    const badge = screen.getByText('Removed');
    expect(badge.className).toContain('text-red-700');
    expect(badge.className).toContain('bg-red-100');
  });

  // 2.5 Accessibility

  // SN-U20: nav has aria-labelledby pointing to "Sections" heading id
  it('nav has aria-labelledby pointing to the "Sections" heading id', () => {
    render(<SectionNav sections={standardSections} />);
    const nav = screen.getByRole('navigation');
    const headingId = nav.getAttribute('aria-labelledby');
    expect(headingId).toBe('section-nav-heading');
    const heading = document.getElementById(headingId!);
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe('Sections');
  });

  // SN-U21: Section buttons have type="button"
  it('section buttons have type="button"', () => {
    render(<SectionNav sections={standardSections} />);
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });

  // SN-U22: "Sections" heading is rendered as h2 with an id attribute
  it('"Sections" heading is rendered as h2 with an id attribute', () => {
    render(<SectionNav sections={standardSections} />);
    const heading = screen.getByText('Sections');
    expect(heading.tagName).toBe('H2');
    expect(heading).toHaveAttribute('id', 'section-nav-heading');
  });

  // SN-U23: Long section headings wrapped in truncate class element
  it('section headings are wrapped in a truncate class element', () => {
    const longHeading =
      'Item 1. Business Overview and Corporate Governance and Risk Management Framework Analysis Report';
    const sections = [makeSectionNavItem('s1', longHeading)];
    render(<SectionNav sections={sections} />);
    const headingEl = screen.getByText(longHeading);
    expect(headingEl.className).toContain('truncate');
  });

  // 2.6 Change count badges

  // SN-U24: Modified section with changeCount=5 renders amber badge with "5 changes"
  it('modified section with changeCount=5 renders badge with "5 changes"', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified', 5)];
    render(<SectionNav sections={sections} />);
    expect(screen.getByText('5 changes')).toBeInTheDocument();
  });

  // SN-U25: Modified section with changeCount=1 renders "1 change" (singular)
  it('modified section with changeCount=1 renders "1 change" (singular)', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified', 1)];
    render(<SectionNav sections={sections} />);
    expect(screen.getByText('1 change')).toBeInTheDocument();
  });

  // SN-U26: Modified section with changeCount=0 renders no badge
  it('modified section with changeCount=0 renders no badge', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified', 0)];
    render(<SectionNav sections={sections} />);
    expect(screen.queryByText(/\d+ change/)).not.toBeInTheDocument();
  });

  // SN-U27: Unchanged section renders no badge regardless of changeCount
  it('unchanged section renders no badge regardless of changeCount', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'unchanged', 5)];
    render(<SectionNav sections={sections} />);
    expect(screen.queryByText(/\d+ change/)).not.toBeInTheDocument();
    expect(screen.queryByText('Added')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed')).not.toBeInTheDocument();
  });

  // SN-U28: Added section renders "Added" text badge (ignores changeCount)
  it('added section renders "Added" text badge regardless of changeCount', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'added', 10)];
    render(<SectionNav sections={sections} />);
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ change/)).not.toBeInTheDocument();
  });

  // SN-U29: Removed section renders "Removed" text badge (ignores changeCount)
  it('removed section renders "Removed" text badge regardless of changeCount', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'removed', 10)];
    render(<SectionNav sections={sections} />);
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ change/)).not.toBeInTheDocument();
  });

  // SN-U30: Amber badge has correct styling classes
  it('amber badge has text-amber-700 and bg-amber-100 classes', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified', 3)];
    render(<SectionNav sections={sections} />);
    const badge = screen.getByText('3 changes');
    expect(badge.className).toContain('text-amber-700');
    expect(badge.className).toContain('bg-amber-100');
  });

  // 2.7 Badge colors and changeTypes

  // SN-U31: Reordered section with changeCount > 0 renders amber badge
  it('reordered section with changeCount > 0 renders amber badge', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'reordered', 4)];
    render(<SectionNav sections={sections} />);
    const badge = screen.getByText('4 changes');
    expect(badge.className).toContain('text-amber-700');
    expect(badge.className).toContain('bg-amber-100');
  });

  // SN-U32: Moved section with changeCount > 0 renders amber badge
  it('moved section with changeCount > 0 renders amber badge', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'moved', 2)];
    render(<SectionNav sections={sections} />);
    const badge = screen.getByText('2 changes');
    expect(badge.className).toContain('text-amber-700');
    expect(badge.className).toContain('bg-amber-100');
  });

  // SN-U33: Badge is rendered inside the section button element
  it('badge is rendered inside the section button element', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified', 5)];
    render(<SectionNav sections={sections} />);
    const badge = screen.getByText('5 changes');
    expect(badge.closest('button')).not.toBeNull();
  });

  // SN-U34: Each section renders its own badge with its own count independently
  it('each section renders its own badge with its own count independently', () => {
    const sections = [
      makeSectionNavItem('s1', 'Section A', 'modified', 3),
      makeSectionNavItem('s2', 'Section B', 'modified', 7),
    ];
    render(<SectionNav sections={sections} />);
    expect(screen.getByText('3 changes')).toBeInTheDocument();
    expect(screen.getByText('7 changes')).toBeInTheDocument();
  });

  // 2.8 Badge interaction with existing features

  // SN-U35: Active section with a badge still shows active styling
  it('active section with a badge still shows active styling', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified', 5)];
    render(<SectionNav sections={sections} activeSectionId="s1" />);
    const button = screen.getByText('Section A').closest('button');
    expect(button?.className).toContain('bg-blue-100');
    expect(screen.getByText('5 changes')).toBeInTheDocument();
  });

  // SN-U36: Section with badge still triggers onSectionClick with correct id
  it('section with badge still triggers onSectionClick with correct id', () => {
    const onClick = vi.fn();
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified', 5)];
    render(<SectionNav sections={sections} onSectionClick={onClick} />);
    fireEvent.click(screen.getByText('Section A'));
    expect(onClick).toHaveBeenCalledWith('s1');
  });

  // SN-U37: Long heading with badge: heading text still has truncate class
  it('long heading with badge still has truncate class', () => {
    const longHeading = 'Item 1. Business Overview and Corporate Governance Framework';
    const sections = [makeSectionNavItem('s1', longHeading, 'modified', 5)];
    render(<SectionNav sections={sections} />);
    const headingEl = screen.getByText(longHeading);
    expect(headingEl.className).toContain('truncate');
    expect(screen.getByText('5 changes')).toBeInTheDocument();
  });

  // 2.9 Badge accessibility

  // SN-U38: Modified badge has aria-label "5 changes"
  it('modified badge has aria-label "5 changes"', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified', 5)];
    render(<SectionNav sections={sections} />);
    const badge = screen.getByText('5 changes');
    expect(badge).toHaveAttribute('aria-label', '5 changes');
  });

  // SN-U39: Added badge has aria-label "Section added"
  it('added badge has aria-label "Section added"', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'added')];
    render(<SectionNav sections={sections} />);
    const badge = screen.getByText('Added');
    expect(badge).toHaveAttribute('aria-label', 'Section added');
  });

  // SN-U40: Removed badge has aria-label "Section removed"
  it('removed badge has aria-label "Section removed"', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'removed')];
    render(<SectionNav sections={sections} />);
    const badge = screen.getByText('Removed');
    expect(badge).toHaveAttribute('aria-label', 'Section removed');
  });

  // 2.10 Backward compatibility

  // SN-U41: Section with changeCount=0 (default) renders no badge
  it('section with default changeCount=0 renders no badge', () => {
    const sections = [makeSectionNavItem('s1', 'Section A', 'modified')];
    render(<SectionNav sections={sections} />);
    expect(screen.queryByText(/\d+ change/)).not.toBeInTheDocument();
  });

  // SN-U42: Existing test fixtures with default changeCount=0 continue to pass
  it('existing fixtures with default changeCount=0 still work', () => {
    render(<SectionNav sections={standardSections} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(standardSections.length);
    // No badges should appear since all have changeCount=0
    expect(screen.queryByText(/\d+ change/)).not.toBeInTheDocument();
  });

  // 2.11 Diff summary bar

  // SN-U43: DiffSummary bar renders when diffSummary prop is provided
  it('DiffSummary bar renders when diffSummary prop is provided', () => {
    const summary: DiffSummaryData = { added: 2, removed: 1, modified: 3, unchanged: 4 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // SN-U44: DiffSummary bar is NOT rendered when diffSummary prop is omitted
  it('DiffSummary bar is NOT rendered when diffSummary prop is omitted', () => {
    render(<SectionNav sections={standardSections} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // SN-U45: DiffSummary bar omits zero-count categories
  it('DiffSummary bar omits zero-count categories', () => {
    const summary: DiffSummaryData = { added: 0, removed: 0, modified: 3, unchanged: 2 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    expect(screen.getByText('3 modified')).toBeInTheDocument();
    expect(screen.getByText('2 unchanged')).toBeInTheDocument();
    expect(screen.queryByText(/added/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/removed/i)).not.toBeInTheDocument();
  });

  // SN-U46: DiffSummary bar shows correct counts with labels
  it('DiffSummary bar shows correct counts with labels', () => {
    const summary: DiffSummaryData = { added: 2, removed: 1, modified: 3, unchanged: 4 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    expect(screen.getByText('3 modified')).toBeInTheDocument();
    expect(screen.getByText('2 added')).toBeInTheDocument();
    expect(screen.getByText('1 removed')).toBeInTheDocument();
    expect(screen.getByText('4 unchanged')).toBeInTheDocument();
  });

  // SN-U47: DiffSummary bar has role="status" and aria-label="Diff summary"
  it('DiffSummary bar has role="status" and aria-label="Diff summary"', () => {
    const summary: DiffSummaryData = { added: 1, removed: 0, modified: 2, unchanged: 0 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    const bar = screen.getByRole('status');
    expect(bar).toHaveAttribute('aria-label', 'Diff summary');
  });

  // SN-U48: DiffSummary bar renders between heading and section list in DOM order
  it('DiffSummary bar renders between heading and section list in DOM order', () => {
    const summary: DiffSummaryData = { added: 1, removed: 0, modified: 2, unchanged: 0 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    const heading = screen.getByText('Sections');
    const summaryBar = screen.getByRole('status');
    const firstButton = screen.getAllByRole('button')[0];
    // Summary bar should come after heading and before the first button in DOM order
    expect(heading.compareDocumentPosition(summaryBar)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(summaryBar.compareDocumentPosition(firstButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // SN-U49: Modified count in summary bar has amber styling
  it('modified count in summary bar has amber styling', () => {
    const summary: DiffSummaryData = { added: 0, removed: 0, modified: 3, unchanged: 0 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    const modifiedBadge = screen.getByText('3 modified');
    expect(modifiedBadge.className).toContain('text-amber-700');
    expect(modifiedBadge.className).toContain('bg-amber-100');
  });

  // SN-U50: Added count in summary bar has green styling
  it('added count in summary bar has green styling', () => {
    const summary: DiffSummaryData = { added: 2, removed: 0, modified: 0, unchanged: 0 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    const addedBadge = screen.getByText('2 added');
    expect(addedBadge.className).toContain('text-green-700');
    expect(addedBadge.className).toContain('bg-green-100');
  });

  // SN-U51: Removed count in summary bar has red styling
  it('removed count in summary bar has red styling', () => {
    const summary: DiffSummaryData = { added: 0, removed: 1, modified: 0, unchanged: 0 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    const removedBadge = screen.getByText('1 removed');
    expect(removedBadge.className).toContain('text-red-700');
    expect(removedBadge.className).toContain('bg-red-100');
  });

  // SN-U52: Unchanged count in summary bar has gray styling
  it('unchanged count in summary bar has gray styling', () => {
    const summary: DiffSummaryData = { added: 0, removed: 0, modified: 0, unchanged: 4 };
    render(<SectionNav sections={standardSections} diffSummary={summary} />);
    const unchangedBadge = screen.getByText('4 unchanged');
    expect(unchangedBadge.className).toContain('text-gray-500');
    expect(unchangedBadge.className).toContain('bg-gray-100');
  });
});
