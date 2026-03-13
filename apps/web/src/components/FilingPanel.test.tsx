import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { StructuredDocument, FilingSection } from '@edgar-diff/lib';
import { FilingPanel } from './FilingPanel';

// --- Test Fixture Helpers ---

function makeSection(
  id: string,
  heading: string,
  start: number,
  end: number,
): FilingSection {
  return { id, heading, level: 1, blocks: [], subsections: [], source: { start, end } };
}

function makeDocument(
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

// --- Existing US-2.2 tests (preserved) ---

describe('FilingPanel', () => {
  it('renders the provided heading', () => {
    render(<FilingPanel label="Filing A" />);
    expect(screen.getByText('Filing A')).toBeInTheDocument();
  });

  it('renders a disabled filing selector', () => {
    render(<FilingPanel label="Filing A" />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(select).toBeDisabled();
    expect(select).toHaveTextContent(/select a filing/i);
  });

  it('renders Filing B with correct heading', () => {
    render(<FilingPanel label="Filing B" />);
    expect(screen.getByText('Filing B')).toBeInTheDocument();
  });

  // --- US-2.3: Backward compatibility ---

  it('shows placeholder text when no document is provided', () => {
    render(<FilingPanel label="Filing A" />);
    expect(
      screen.getByText(/filing content will appear here/i),
    ).toBeInTheDocument();
  });

  it('does not render FilingContent when no document is provided', () => {
    const { container } = render(<FilingPanel label="Filing A" />);
    expect(container.querySelector('.filing-content-root')).toBeNull();
  });

  // --- US-2.3: HTML content rendering ---

  it('renders HTML content from the document (not escaped)', () => {
    const html = '<p>Hello <b>World</b></p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    render(<FilingPanel label="Filing A" document={doc} />);

    expect(screen.getByText('World')).toBeInTheDocument();
    expect(screen.queryByText('<p>')).not.toBeInTheDocument();
  });

  it('hides placeholder text when document is provided', () => {
    const html = '<p>Content</p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    render(<FilingPanel label="Filing A" document={doc} />);
    expect(
      screen.queryByText(/filing content will appear here/i),
    ).not.toBeInTheDocument();
  });

  // --- US-2.3: Section containers ---

  it('renders section containers with IDs derived from section.id', () => {
    const html = '<h2>Risk Factors</h2><p>Details</p>';
    const doc = makeDocument(html, [
      makeSection('item-1a', 'Item 1A. Risk Factors', 0, html.length),
    ]);
    const { container } = render(
      <FilingPanel label="Filing A" document={doc} />,
    );

    expect(container.querySelector('#item-1a')).not.toBeNull();
  });

  // --- US-2.3: Formatting preservation ---

  it('preserves table structure in rendered HTML', () => {
    const html =
      '<table><tr><th>Header</th></tr><tr><td>Cell 1</td></tr></table>';
    const doc = makeDocument(html, [
      makeSection('item-8', 'Item 8. Financial Statements', 0, html.length),
    ]);
    const { container } = render(
      <FilingPanel label="Filing A" document={doc} />,
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('th')).not.toBeNull();
    expect(container.querySelector('td')).not.toBeNull();
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(screen.getByText('Cell 1')).toBeInTheDocument();
  });

  // --- US-2.3: Filing selector still works ---

  it('still renders the disabled filing selector when document is provided', () => {
    const html = '<p>Content</p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    render(<FilingPanel label="Filing A" document={doc} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeDisabled();
  });

  it('still renders the panel heading when document is provided', () => {
    const html = '<p>Content</p>';
    const doc = makeDocument(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    render(<FilingPanel label="Filing A" document={doc} />);
    expect(screen.getByText('Filing A')).toBeInTheDocument();
  });
});
