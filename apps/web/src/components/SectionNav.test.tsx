import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SectionNav } from './SectionNav';
import type { SectionNavItem } from './SectionNav';
import type { ChangeType } from '@edgar-diff/lib';

// --- Fixture helpers ---

function makeSectionNavItem(
  id: string,
  heading: string,
  changeType: ChangeType = 'modified',
): SectionNavItem {
  return { id, heading, changeType };
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
});
