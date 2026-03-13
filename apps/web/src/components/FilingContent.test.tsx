import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { StructuredDocument, FilingSection } from '@edgar-diff/lib';
import { FilingContent } from './FilingContent';

// --- Test Fixture Helpers ---

function makeSection(
  id: string,
  heading: string,
  start: number,
  end: number,
): FilingSection {
  return { id, heading, level: 1, blocks: [], subsections: [], source: { start, end } };
}

function makeDoc(
  html: string,
  sections: FilingSection[] = [],
): StructuredDocument {
  return {
    filing: {
      accessionNumber: '0000000000-00-000000',
      cik: '0000000000',
      formType: '10-K' as const,
      filingDate: Temporal.PlainDate.from('2024-01-15'),
      primaryDocumentFilename: 'test.htm',
      html,
      fetchedAt: Temporal.Now.instant(),
    },
    sections,
    parseWarnings: [],
  };
}

describe('FilingContent', () => {
  // --- Preamble rendering ---

  it('renders preamble content before the first section', () => {
    const html = '<p>Preamble</p><h2>Item 1</h2><p>Content</p>';
    const item1Start = html.indexOf('<h2>');
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', item1Start, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(screen.getByText('Preamble')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(container.querySelector('#preamble')).not.toBeNull();
  });

  it('does not render preamble when first section starts at offset 0', () => {
    const html = '<h2>Item 1</h2><p>Content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('#preamble')).toBeNull();
  });

  // --- Section ID assignment ---

  it('wraps each section in a <section> element with the section id', () => {
    const html = '<h2>Item 1</h2><p>A</p><h2>Item 2</h2><p>B</p>';
    const item2Start = html.indexOf('<h2>Item 2');
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, item2Start),
      makeSection('item-2', 'Item 2', item2Start, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    const s1 = container.querySelector('#item-1');
    const s2 = container.querySelector('#item-2');
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s1?.tagName.toLowerCase()).toBe('section');
    expect(s2?.tagName.toLowerCase()).toBe('section');
  });

  // --- No sections fallback ---

  it('renders entire HTML as id="content" when there are no sections', () => {
    const html = '<p>No sections here</p>';
    const doc = makeDoc(html, []);
    const { container } = render(<FilingContent document={doc} />);

    expect(screen.getByText('No sections here')).toBeInTheDocument();
    expect(container.querySelector('#content')).not.toBeNull();
  });

  it('renders empty container when HTML is empty and no sections', () => {
    const { container } = render(<FilingContent document={makeDoc('', [])} />);
    const root = container.querySelector('.filing-content-root');
    expect(root).not.toBeNull();
    expect(root?.children).toHaveLength(0);
  });

  // --- Single section ---

  it('handles a single section covering the full document', () => {
    const html = '<h2>Only Section</h2><p>All the content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('#item-1')).not.toBeNull();
    expect(screen.getByText('All the content')).toBeInTheDocument();
  });

  // --- Formatting preservation ---

  it('preserves table markup from original HTML', () => {
    const html = '<h2>Item 1</h2><table><tr><td>Cell</td></tr></table>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getByText('Cell')).toBeInTheDocument();
  });

  it('preserves list markup from original HTML', () => {
    const html = '<ul><li>First</li><li>Second</li></ul>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  // --- CSS isolation structure ---

  it('wraps content in a .filing-content-root container', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('.filing-content-root')).not.toBeNull();
  });

  it('applies .filing-section class to each section element', () => {
    const html = '<h2>A</h2><p>1</p><h2>B</h2><p>2</p>';
    const bStart = html.indexOf('<h2>B');
    const doc = makeDoc(html, [
      makeSection('item-1', 'A', 0, bStart),
      makeSection('item-2', 'B', bStart, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    const sections = container.querySelectorAll('.filing-section');
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });
});
