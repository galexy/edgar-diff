import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type {
  StructuredDocument,
  FilingSection,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  ParagraphDiff,
  SectionDiff,
  TableDiff,
  RowDiff,
  CellDiff,
  WordChange,
  ChangeType,
} from '@edgar-diff/lib';
import { FilingContent } from './FilingContent';

// --- Test Fixture Helpers ---

function makeSection(
  id: string,
  heading: string,
  start: number,
  end: number,
  blocks: FilingSection['blocks'] = [],
): FilingSection {
  return { id, heading, level: 1, blocks, subsections: [], source: { start, end } };
}

function makeParagraph(text: string, start: number, end: number): Paragraph {
  return { type: 'paragraph', text, source: { start, end } };
}

function makeParagraphDiff(
  changeType: ChangeType,
  oldSource?: { start: number; end: number },
  newSource?: { start: number; end: number },
  wordChanges?: WordChange[],
): ParagraphDiff {
  return {
    changeType,
    wordChanges,
    sourceMapping: {
      old: oldSource ? { start: oldSource.start, end: oldSource.end } : undefined,
      new: newSource ? { start: newSource.start, end: newSource.end } : undefined,
    },
  };
}

function makeSectionDiff(
  id: string,
  heading: string,
  paragraphDiffs: ParagraphDiff[],
  changeType: ChangeType = 'modified',
): SectionDiff {
  return {
    id,
    heading,
    changeType,
    paragraphDiffs,
    tableDiffs: [],
    subsectionDiffs: [],
    sourceMapping: { old: undefined, new: undefined },
  };
}

function makeSectionDiffWithTables(
  id: string,
  heading: string,
  paragraphDiffs: ParagraphDiff[],
  tableDiffs: TableDiff[],
  changeType: ChangeType = 'modified',
): SectionDiff {
  return {
    id,
    heading,
    changeType,
    paragraphDiffs,
    tableDiffs,
    subsectionDiffs: [],
    sourceMapping: { old: undefined, new: undefined },
  };
}

function makeTableBlock(rows: TableRow[], start: number, end: number): Table {
  return { type: 'table', rows, source: { start, end } };
}

function makeTableRow(cells: TableCell[], start: number, end: number, isHeader = false): TableRow {
  return { cells, isHeader, source: { start, end } };
}

function makeTableCell(text: string, start: number, end: number, opts: { colspan?: number; rowspan?: number } = {}): TableCell {
  return { text, colspan: opts.colspan ?? 1, rowspan: opts.rowspan ?? 1, source: { start, end } };
}

function makeRowDiff(
  changeType: ChangeType,
  cellDiffs: CellDiff[],
  oldRowIndex?: number,
  newRowIndex?: number,
): RowDiff {
  return { changeType, cellDiffs, oldRowIndex, newRowIndex };
}

function makeCellDiff(
  row: number,
  col: number,
  changeType: ChangeType,
  opts: {
    oldSource?: { start: number; end: number };
    newSource?: { start: number; end: number };
    oldValue?: string;
    newValue?: string;
  } = {},
): CellDiff {
  return {
    row,
    col,
    changeType,
    oldValue: opts.oldValue,
    newValue: opts.newValue,
    sourceMapping: {
      old: opts.oldSource,
      new: opts.newSource,
    },
  };
}

function makeTableDiff(
  changeType: ChangeType,
  rowDiffs: RowDiff[],
  oldSource?: { start: number; end: number },
  newSource?: { start: number; end: number },
): TableDiff {
  return {
    changeType,
    rowDiffs,
    cellDiffs: rowDiffs.flatMap((rd) => rd.cellDiffs),
    sourceMapping: { old: oldSource, new: newSource },
    summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
  };
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

  // --- Style block stripping ---

  it('strips <style> blocks from rendered HTML', () => {
    const html = '<style>body { font-family: Comic Sans; }</style><p>Content</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('strips multiple <style> blocks', () => {
    const html = '<style>.a { color: red; }</style><p>Text</p><style>.b { color: blue; }</style>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    expect(screen.getByText('Text')).toBeInTheDocument();
  });

  it('preserves inline styles while stripping <style> blocks', () => {
    const html = '<style>p { margin: 0; }</style><p style="color: red;">Styled text</p>';
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', 0, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    const p = container.querySelector('p[style]');
    expect(p).not.toBeNull();
    expect(p?.getAttribute('style')).toContain('color');
    expect(screen.getByText('Styled text')).toBeInTheDocument();
  });

  it('strips <style> blocks from preamble content too', () => {
    const html = '<style>body { margin: 0; }</style><p>Preamble</p><h2>Item 1</h2><p>Section</p>';
    const item1Start = html.indexOf('<h2>');
    const doc = makeDoc(html, [
      makeSection('item-1', 'Item 1', item1Start, html.length),
    ]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelectorAll('style')).toHaveLength(0);
    expect(screen.getByText('Preamble')).toBeInTheDocument();
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

  // --- Boundary conditions ---

  describe('Boundary conditions', () => {
    it('handles 0 sections with non-empty HTML (renders as id="content")', () => {
      const html = '<p>No sections here</p>';
      const doc = makeDoc(html, []);
      const { container } = render(<FilingContent document={doc} />);
      expect(screen.getByText('No sections here')).toBeInTheDocument();
      expect(container.querySelector('#content')).not.toBeNull();
    });

    it('handles 1 section covering the full document', () => {
      const html = '<p>Only section</p>';
      const doc = makeDoc(html, [
        makeSection('item-1', 'Item 1', 0, html.length),
      ]);
      const { container } = render(<FilingContent document={doc} />);
      expect(container.querySelector('#item-1')).not.toBeNull();
    });

    it('handles many sections (20+)', () => {
      let html = '';
      const sections: FilingSection[] = [];
      for (let i = 0; i < 20; i++) {
        const start = html.length;
        html += `<h2>Section ${i}</h2><p>Content ${i}</p>`;
        sections.push(makeSection(`sec-${i}`, `Section ${i}`, start, html.length));
      }
      const doc = makeDoc(html, sections);
      const { container } = render(<FilingContent document={doc} />);

      for (let i = 0; i < 20; i++) {
        expect(container.querySelector(`#sec-${i}`)).not.toBeNull();
      }
    });

    it('handles empty HTML string with empty sections', () => {
      const { container } = render(<FilingContent document={makeDoc('', [])} />);
      const root = container.querySelector('.filing-content-root');
      expect(root).not.toBeNull();
      expect(root?.children).toHaveLength(0);
    });

    it('handles section with start === end (zero-length range)', () => {
      const html = '<p>Content</p>';
      const doc = makeDoc(html, [
        makeSection('empty', 'Empty Section', 5, 5),
      ]);
      const { container } = render(<FilingContent document={doc} />);
      const section = container.querySelector('#empty');
      expect(section).not.toBeNull();
      expect(section?.innerHTML).toBe('');
    });

    it('handles preamble-only document (sections start after all content)', () => {
      const html = '<p>All preamble</p>';
      const doc = makeDoc(html, [
        makeSection('item-1', 'Item 1', html.length, html.length),
      ]);
      const { container } = render(<FilingContent document={doc} />);
      expect(container.querySelector('#preamble')).not.toBeNull();
      expect(screen.getByText('All preamble')).toBeInTheDocument();
    });
  });

  // --- Error conditions ---

  describe('Error conditions', () => {
    it('handles document with undefined filing.html gracefully', () => {
      const doc: StructuredDocument = {
        filing: {
          ...makeDoc('', []).filing,
          html: undefined as unknown as string,
        },
        sections: [],
        parseWarnings: [],
      };
      expect(() =>
        render(<FilingContent document={doc} />),
      ).not.toThrow();
    });

    it('handles source location beyond HTML string length', () => {
      const html = '<p>Short</p>';
      const doc = makeDoc(html, [
        makeSection('item-1', 'Item 1', 0, 9999),
      ]);
      expect(() =>
        render(<FilingContent document={doc} />),
      ).not.toThrow();
      expect(screen.getByText('Short')).toBeInTheDocument();
    });

    it('handles source location with start > end (inverted range)', () => {
      const html = '<p>Content</p>';
      const doc = makeDoc(html, [
        makeSection('item-1', 'Item 1', 10, 5),
      ]);
      expect(() =>
        render(<FilingContent document={doc} />),
      ).not.toThrow();
    });

    it('does not execute <script> tags in filing HTML', () => {
      const html = '<p>Safe</p><script>alert("xss")</script><p>Also safe</p>';
      const doc = makeDoc(html, [
        makeSection('item-1', 'Item 1', 0, html.length),
      ]);
      render(<FilingContent document={doc} />);

      expect(screen.getByText('Safe')).toBeInTheDocument();
      expect(screen.getByText('Also safe')).toBeInTheDocument();
    });
  });

  // --- CSS isolation structure (extended) ---

  describe('CSS isolation structure', () => {
    it('.filing-content-root container exists with document', () => {
      const html = '<p>Content</p>';
      const doc = makeDoc(html, [makeSection('item-1', 'Item 1', 0, html.length)]);
      const { container } = render(<FilingContent document={doc} />);

      expect(container.querySelector('.filing-content-root')).not.toBeNull();
    });

    it('each section has .filing-section class', () => {
      const html = '<p>A</p><p>B</p>';
      const doc = makeDoc(html, [
        makeSection('item-1', 'A', 0, 8),
        makeSection('item-2', 'B', 8, html.length),
      ]);
      const { container } = render(<FilingContent document={doc} />);

      const sections = container.querySelectorAll('.filing-section');
      expect(sections.length).toBe(2);
    });
  });

  // =====================================================================
  // US-2.5: Paragraph Diff Highlighting — Integration Tests
  // =====================================================================

  describe('US-2.5: Paragraph Diff Highlighting', () => {
    // --- 3.1 No-op without diff data ---

    describe('No-op without diff data', () => {
      it('FC-I1: renders normally without sectionDiffs — no <ins>/<del> in DOM', () => {
        const html = '<h2>Item 1</h2><p>The quick brown fox</p>';
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length),
        ]);
        const { container } = render(<FilingContent document={doc} />);

        expect(container.querySelectorAll('ins')).toHaveLength(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
        expect(screen.getByText('The quick brown fox')).toBeInTheDocument();
      });

      it('FC-I2: section slicing still works when sectionDiffs is undefined', () => {
        const html = '<h2>Item 1</h2><p>First</p><h2>Item 2</h2><p>Second</p>';
        const item2Start = html.indexOf('<h2>Item 2');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, item2Start),
          makeSection('item-2', 'Item 2', item2Start, html.length),
        ]);
        const { container } = render(<FilingContent document={doc} />);

        expect(container.querySelector('#item-1')).not.toBeNull();
        expect(container.querySelector('#item-2')).not.toBeNull();
        expect(screen.getByText('First')).toBeInTheDocument();
        expect(screen.getByText('Second')).toBeInTheDocument();
        expect(container.querySelectorAll('ins')).toHaveLength(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
      });
    });

    // --- 3.2 Whole-paragraph changes ---

    describe('Whole-paragraph changes', () => {
      it('FC-I3: added paragraph renders <ins class="diff-paragraph-added">', () => {
        const paraHtml = '<p>New paragraph added</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('New paragraph added', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('added', undefined, { start: paraStart, end: html.length }),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="new" />,
        );

        const ins = container.querySelector('ins.diff-paragraph-added');
        expect(ins).not.toBeNull();
        expect(ins?.textContent).toContain('New paragraph added');
      });

      it('FC-I4: removed paragraph renders <del class="diff-paragraph-removed">', () => {
        const paraHtml = '<p>Removed paragraph</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Removed paragraph', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: paraStart, end: html.length }, undefined),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        const del = container.querySelector('del.diff-paragraph-removed');
        expect(del).not.toBeNull();
        expect(del?.textContent).toContain('Removed paragraph');
      });

      it('FC-I5: unchanged paragraph has no <ins> or <del>', () => {
        const paraHtml = '<p>Unchanged content</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Unchanged content', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('unchanged', { start: paraStart, end: html.length }, { start: paraStart, end: html.length }),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        expect(container.querySelectorAll('ins')).toHaveLength(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
        expect(screen.getByText('Unchanged content')).toBeInTheDocument();
      });
    });

    // --- 3.3 Word-level changes ---

    describe('Word-level changes', () => {
      it('FC-I6: modified paragraph wraps only changed word in <del>', () => {
        const paraHtml = '<p>The quick brown fox</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('The quick brown fox', paraStart, paraEnd),
          ]),
        ]);
        // "quick" is at offsets 4-9 in "The quick brown fox"
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 4, end: 9 }],
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        const del = container.querySelector('del.diff-removed');
        expect(del).not.toBeNull();
        expect(del?.textContent).toBe('quick');
        // Unchanged text should NOT be wrapped
        expect(container.querySelectorAll('ins')).toHaveLength(0);
      });

      it('FC-I7: word change spanning HTML tag boundary produces multiple <del> elements', () => {
        // "quick brown" spans across the <b> tag boundary
        const paraHtml = '<p>The <b>quick brown</b> fox</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('The quick brown fox', paraStart, paraEnd),
          ]),
        ]);
        // "quick brown" is at offsets 4-15 in "The quick brown fox"
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 4, end: 15 }],
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        // Should produce multiple <del> elements (one per text node across the tag boundary)
        const dels = container.querySelectorAll('del.diff-removed');
        expect(dels.length).toBeGreaterThanOrEqual(1);
        // Combined text should be "quick brown"
        const combinedText = Array.from(dels).map(el => el.textContent).join('');
        expect(combinedText).toBe('quick brown');
        // Original <b> tag should still be present
        expect(container.querySelector('b')).not.toBeNull();
      });
    });

    // --- 3.4 Side filtering ---

    describe('Side filtering', () => {
      it('FC-I8: side="old" shows <del> for removed paragraphs, no <ins>', () => {
        const paraHtml = '<p>Old content removed</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Old content removed', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: paraStart, end: html.length }, undefined),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        expect(container.querySelectorAll('del').length).toBeGreaterThan(0);
        expect(container.querySelectorAll('ins')).toHaveLength(0);
      });

      it('FC-I9: side="new" shows <ins> for added paragraphs, no <del>', () => {
        const paraHtml = '<p>New content added</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('New content added', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('added', undefined, { start: paraStart, end: html.length }),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="new" />,
        );

        expect(container.querySelectorAll('ins').length).toBeGreaterThan(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
      });

      it('FC-I10: added paragraph ignored on old side (no source location for old)', () => {
        const paraHtml = '<p>Content</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Content', paraStart, html.length),
          ]),
        ]);
        // Added paragraph has no old sourceMapping
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('added', undefined, { start: paraStart, end: html.length }),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        // No highlights since added paragraph has no old source
        expect(container.querySelectorAll('ins')).toHaveLength(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
      });
    });

    // --- 3.5 Moved and reordered paragraphs ---

    describe('Moved and reordered paragraphs', () => {
      it('FC-I11: moved paragraph with wordChanges renders word-level highlights', () => {
        const paraHtml = '<p>The quick brown fox</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('The quick brown fox', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'moved',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 4, end: 9 }],
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        const del = container.querySelector('del.diff-removed');
        expect(del).not.toBeNull();
        expect(del?.textContent).toBe('quick');
      });

      it('FC-I12: moved paragraph without wordChanges renders as unchanged', () => {
        const paraHtml = '<p>Moved but identical text</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Moved but identical text', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'moved',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              // No wordChanges
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        expect(container.querySelectorAll('ins')).toHaveLength(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
      });

      it('FC-I13: reordered paragraph renders as unchanged', () => {
        const paraHtml = '<p>Reordered paragraph</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Reordered paragraph', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'reordered',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        expect(container.querySelectorAll('ins')).toHaveLength(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
      });
    });

    // --- 4. Boundary Conditions ---

    describe('Boundary conditions (US-2.5)', () => {
      it('BC-1: empty paragraph does not crash', () => {
        const html = '<h2>Item 1</h2><p></p>';
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: paraStart, end: paraEnd }, undefined),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('BC-2: modified paragraph with empty wordChanges array', () => {
        const paraHtml = '<p>Some content here</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Some content here', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [], // empty wordChanges
            ),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
        expect(screen.getByText('Some content here')).toBeInTheDocument();
      });

      it('BC-3: single-character word change', () => {
        const paraHtml = '<p>abcde</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('abcde', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 2, end: 3 }], // single char 'c'
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        const del = container.querySelector('del.diff-removed');
        expect(del).not.toBeNull();
        expect(del?.textContent).toBe('c');
      });

      it('BC-4: change at very start of paragraph text (offset 0)', () => {
        const paraHtml = '<p>Hello world</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Hello world', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 0, end: 5 }], // "Hello"
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        const del = container.querySelector('del.diff-removed');
        expect(del).not.toBeNull();
        expect(del?.textContent).toBe('Hello');
      });

      it('BC-5: change at very end of paragraph text', () => {
        const paraHtml = '<p>Hello world</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Hello world', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 6, end: 11 }], // "world"
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        const del = container.querySelector('del.diff-removed');
        expect(del).not.toBeNull();
        expect(del?.textContent).toBe('world');
      });

      it('BC-6: HTML entities in changed text', () => {
        const paraHtml = '<p>Revenue &amp; growth</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            // Parsed text normalizes &amp; to &
            makeParagraph('Revenue & growth', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 8, end: 9 }], // "&" character
            ),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('BC-7: deeply nested tags with whole-paragraph removal', () => {
        const paraHtml = '<p><span><b>Deep nested text</b></span></p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Deep nested text', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: paraStart, end: paraEnd }, undefined),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        expect(container.querySelector('del')).not.toBeNull();
      });

      it('BC-8: paragraph with only whitespace does not crash', () => {
        const paraHtml = '<p>   </p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: paraStart, end: paraEnd }, undefined),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('BC-9: section with 50+ paragraphs (all unchanged) does not crash', () => {
        let sectionHtml = '<h2>Item 1</h2>';
        const paragraphs: Paragraph[] = [];
        const paragraphDiffs: ParagraphDiff[] = [];

        for (let i = 0; i < 55; i++) {
          const start = sectionHtml.length;
          sectionHtml += `<p>Paragraph ${i}</p>`;
          const end = sectionHtml.length;
          paragraphs.push(makeParagraph(`Paragraph ${i}`, start, end));
          paragraphDiffs.push(
            makeParagraphDiff(
              'unchanged',
              { start, end },
              { start, end },
            ),
          );
        }

        const doc = makeDoc(sectionHtml, [
          makeSection('item-1', 'Item 1', 0, sectionHtml.length, paragraphs),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', paragraphDiffs),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });
    });

    // --- 5. Error Conditions ---

    describe('Error conditions (US-2.5)', () => {
      it('EC-1: WordChange end beyond paragraph text length does not crash', () => {
        const paraHtml = '<p>Short</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Short', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 0, end: 999 }],
            ),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('EC-2: SourceMapping start > HTML length does not crash', () => {
        const html = '<h2>Item 1</h2><p>Content</p>';
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Content', 9999, 10010),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: 9999, end: 10010 }, undefined),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('EC-3: modified paragraph with undefined wordChanges does not crash', () => {
        const paraHtml = '<p>Content here</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Content here', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              undefined, // no wordChanges
            ),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('EC-4: inverted wordChange range (start > end) does not crash', () => {
        const paraHtml = '<p>Some text</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Some text', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 8, end: 3 }], // inverted
            ),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('EC-5: SectionDiff ID does not match any document section', () => {
        const html = '<h2>Item 1</h2><p>Content</p>';
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('nonexistent-section', 'No Match', [
            makeParagraphDiff('removed', { start: 0, end: 10 }, undefined),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        // Section renders unmodified — no highlights
        expect(container.querySelectorAll('ins')).toHaveLength(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
        expect(screen.getByText('Content')).toBeInTheDocument();
      });

      it('EC-6: empty sectionDiffs array renders normally', () => {
        const html = '<h2>Item 1</h2><p>Content</p>';
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length),
        ]);
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[]} side="old" />,
        );

        expect(container.querySelectorAll('ins')).toHaveLength(0);
        expect(container.querySelectorAll('del')).toHaveLength(0);
        expect(screen.getByText('Content')).toBeInTheDocument();
      });

      it('EC-7: negative wordChange offsets does not crash', () => {
        const paraHtml = '<p>Some text</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Some text', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: -5, end: 4 }],
            ),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('EC-8: paragraph sourceLocation outside section range does not crash', () => {
        const html = '<h2>Item 1</h2><p>Content</p>';
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Content', 5000, 5010), // way outside
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: 5000, end: 5010 }, undefined),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });

      it('EC-9: style block mid-section with highlights does not crash', () => {
        const html = '<h2>Item 1</h2><style>.x{}</style><p>After style</p>';
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('After style', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: paraStart, end: paraEnd }, undefined),
          ]),
        ];
        expect(() =>
          render(<FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />),
        ).not.toThrow();
      });
    });

    // --- 6. Accessibility Tests ---

    describe('Accessibility (US-2.5)', () => {
      it('A11Y-1: added content uses semantic <ins> element', () => {
        const paraHtml = '<p>Added paragraph</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Added paragraph', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('added', undefined, { start: paraStart, end: html.length }),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="new" />,
        );

        const insElements = container.querySelectorAll('ins');
        expect(insElements.length).toBeGreaterThan(0);
        // Ensure it's a real <ins> not a styled <span>
        expect(insElements[0].tagName.toLowerCase()).toBe('ins');
      });

      it('A11Y-2: removed content uses semantic <del> element', () => {
        const paraHtml = '<p>Removed paragraph</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Removed paragraph', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: paraStart, end: html.length }, undefined),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        const delElements = container.querySelectorAll('del');
        expect(delElements.length).toBeGreaterThan(0);
        expect(delElements[0].tagName.toLowerCase()).toBe('del');
      });

      it('A11Y-3: word-level <ins> has diff-added class', () => {
        const paraHtml = '<p>Hello world</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Hello world', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'added', start: 6, end: 11 }],
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="new" />,
        );

        const ins = container.querySelector('ins.diff-added');
        expect(ins).not.toBeNull();
      });

      it('A11Y-4: word-level <del> has diff-removed class', () => {
        const paraHtml = '<p>Hello world</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const paraEnd = html.indexOf('</p>') + 4;
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Hello world', paraStart, paraEnd),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff(
              'modified',
              { start: paraStart, end: paraEnd },
              { start: paraStart, end: paraEnd },
              [{ type: 'removed', start: 0, end: 5 }],
            ),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="old" />,
        );

        const del = container.querySelector('del.diff-removed');
        expect(del).not.toBeNull();
      });

      it('A11Y-5: paragraph-level <ins> has diff-paragraph-added class', () => {
        const paraHtml = '<p>New paragraph</p>';
        const html = `<h2>Item 1</h2>${paraHtml}`;
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('New paragraph', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('added', undefined, { start: paraStart, end: html.length }),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="new" />,
        );

        const ins = container.querySelector('ins.diff-paragraph-added');
        expect(ins).not.toBeNull();
      });

      it('A11Y-6: highlight elements do not break heading hierarchy', () => {
        const html = '<h2>Item 1</h2><p>Added content</p>';
        const paraStart = html.indexOf('<p>');
        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Added content', paraStart, html.length),
          ]),
        ]);
        const sectionDiffs: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('added', undefined, { start: paraStart, end: html.length }),
          ]),
        ];
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={sectionDiffs} side="new" />,
        );

        // Section heading should still be queryable
        expect(screen.getByText('Item 1')).toBeInTheDocument();
        expect(container.querySelector('h2')).not.toBeNull();
      });

      it('A11Y-7: screen readers can distinguish additions from removals via semantics', () => {
        // Two paragraphs: one added, one removed (on appropriate sides)
        const html = '<h2>Item 1</h2><p>Removed text</p><p>Added text</p>';
        const p1Start = html.indexOf('<p>Removed');
        const p1End = html.indexOf('</p>') + 4;
        const p2Start = html.indexOf('<p>Added');
        const p2End = html.lastIndexOf('</p>') + 4;

        // Test old side — should have <del>
        const docOld = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Removed text', p1Start, p1End),
            makeParagraph('Added text', p2Start, p2End),
          ]),
        ]);
        const sectionDiffsOld: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('removed', { start: p1Start, end: p1End }, undefined),
            makeParagraphDiff('unchanged', { start: p2Start, end: p2End }, { start: p2Start, end: p2End }),
          ]),
        ];
        const { container: oldContainer } = render(
          <FilingContent document={docOld} sectionDiffs={sectionDiffsOld} side="old" />,
        );
        expect(oldContainer.querySelectorAll('del').length).toBeGreaterThan(0);
        expect(oldContainer.querySelectorAll('ins')).toHaveLength(0);

        // Test new side — should have <ins>
        const docNew = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Removed text', p1Start, p1End),
            makeParagraph('Added text', p2Start, p2End),
          ]),
        ]);
        const sectionDiffsNew: SectionDiff[] = [
          makeSectionDiff('item-1', 'Item 1', [
            makeParagraphDiff('unchanged', { start: p1Start, end: p1End }, { start: p1Start, end: p1End }),
            makeParagraphDiff('added', undefined, { start: p2Start, end: p2End }),
          ]),
        ];
        const { container: newContainer } = render(
          <FilingContent document={docNew} sectionDiffs={sectionDiffsNew} side="new" />,
        );
        expect(newContainer.querySelectorAll('ins').length).toBeGreaterThan(0);
        expect(newContainer.querySelectorAll('del')).toHaveLength(0);
      });
    });
  });

  // ─── US-2.6: Table diff highlighting ────────────────────────────

  describe('Table diff highlighting', () => {
    // Helper to build a doc with a table in a section
    function makeTableDoc(tableHtml: string, blocks: FilingSection['blocks'] = []) {
      const sectionHtml = `<h2>Item 1</h2>${tableHtml}`;
      const html = sectionHtml;
      const sectionStart = 0;
      const sectionEnd = html.length;
      const section = makeSection('item-1', 'Item 1', sectionStart, sectionEnd, blocks);
      return makeDoc(html, [section]);
    }

    describe('No-op without diff data', () => {
      it('TFC-I1: table without sectionDiffs renders normally — no diff-* classes', () => {
        const tableHtml = '<table><tr><td>Revenue</td><td>$1,000</td></tr></table>';
        const doc = makeTableDoc(tableHtml);
        const { container } = render(<FilingContent document={doc} />);
        const tds = container.querySelectorAll('td');
        expect(tds.length).toBe(2);
        tds.forEach((td) => {
          expect(td.className).not.toContain('diff-');
        });
      });

      it('TFC-I2: table with sectionDiffs but empty tableDiffs — table unmodified', () => {
        const tableHtml = '<table><tr><td>Revenue</td><td>$1,000</td></tr></table>';
        const doc = makeTableDoc(tableHtml);
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], []);
        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        const tds = container.querySelectorAll('td');
        tds.forEach((td) => {
          expect(td.className).not.toContain('diff-');
        });
      });
    });

    describe('Cell-level changes', () => {
      it('TFC-I3: modified cell has diff-cell-modified class and old→new annotation', () => {
        const html = '<h2>Item 1</h2><table><tr><td>$1,234</td></tr></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('$1,234', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'modified', {
          oldValue: '$1,000', newValue: '$1,234',
          newSource: { start: tdStart, end: tdEnd },
        });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        const cell = container.querySelector('td');
        expect(cell?.className).toContain('diff-cell-modified');
        expect(cell?.querySelector('del.diff-removed')?.textContent).toBe('$1,000');
        expect(cell?.querySelector('ins.diff-added')?.textContent).toBe('$1,234');
      });

      it('TFC-I4: added cell on new side has diff-cell-added class', () => {
        const html = '<h2>Item 1</h2><table><tr><td>New</td></tr></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('New', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'added', { newSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        const cell = container.querySelector('td');
        expect(cell?.className).toContain('diff-cell-added');
        expect(cell?.textContent).toBe('New');
      });

      it('TFC-I5: removed cell on old side has diff-cell-removed class', () => {
        const html = '<h2>Item 1</h2><table><tr><td>Old</td></tr></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('Old', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'removed', { oldSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="old" />,
        );
        const cell = container.querySelector('td');
        expect(cell?.className).toContain('diff-cell-removed');
        expect(cell?.textContent).toBe('Old');
      });

      it('TFC-I6: unchanged cell in a modified row has no diff-* class', () => {
        const html = '<h2>Item 1</h2><table><tr><td>A</td><td>B</td></tr></table>';
        const td1Start = html.indexOf('<td>A');
        const td1End = html.indexOf('</td>') + 5;
        const td2Start = html.indexOf('<td>B');
        const td2End = html.indexOf('</td>', td2Start) + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([
                makeTableCell('A', td1Start, td1End),
                makeTableCell('B', td2Start, td2End),
              ], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        // Only cell A modified; cell B unchanged
        const modCd = makeCellDiff(0, 0, 'modified', {
          oldSource: { start: td1Start, end: td1End },
          newSource: { start: td1Start, end: td1End },
          oldValue: 'X', newValue: 'A',
        });
        const unchangedCd = makeCellDiff(0, 1, 'unchanged', {
          oldSource: { start: td2Start, end: td2End },
          newSource: { start: td2Start, end: td2End },
        });
        const rd = makeRowDiff('modified', [modCd, unchangedCd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );

        expect(container.querySelectorAll('td.diff-cell-modified')).toHaveLength(1);
        // Cell B should not have any diff class
        const allTds = container.querySelectorAll('td');
        const cellB = Array.from(allTds).find((el) => el.textContent === 'B');
        expect(cellB?.className).not.toContain('diff-');
      });
    });

    describe('Row-level changes', () => {
      it('TFC-I7: added row on new side has diff-row-added class', () => {
        const html = '<h2>Item 1</h2><table><tr><td>NewRow</td></tr></table>';
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('NewRow', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const rd = makeRowDiff('added', [], undefined, 0);
        const td = makeTableDiff('modified', [rd],
          undefined,
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        const tr = container.querySelector('tr');
        expect(tr?.className).toContain('diff-row-added');
      });

      it('TFC-I8: removed row on old side has diff-row-removed class', () => {
        const html = '<h2>Item 1</h2><table><tr><td>OldRow</td></tr></table>';
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('OldRow', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const rd = makeRowDiff('removed', [], 0, undefined);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          undefined,
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="old" />,
        );
        const tr = container.querySelector('tr');
        expect(tr?.className).toContain('diff-row-removed');
      });

      it('TFC-I9: unchanged row has no diff-* classes', () => {
        const html = '<h2>Item 1</h2><table><tr><td>Val</td></tr></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('Val', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const rd = makeRowDiff('unchanged', [], 0, 0);
        const td = makeTableDiff('unchanged', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );

        expect(container.querySelectorAll('[class*="diff-"]')).toHaveLength(0);
      });
    });

    describe('Side filtering', () => {
      it('TFC-I10: old side shows only removed, no added classes', () => {
        const html = '<h2>Item 1</h2><table><tr><td>Val</td></tr></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('Val', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'removed', { oldSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="old" />,
        );
        expect(container.innerHTML).toContain('diff-cell-removed');
        expect(container.innerHTML).not.toContain('diff-cell-added');
        expect(container.innerHTML).not.toContain('diff-row-added');
      });

      it('TFC-I11: new side shows added classes, no removed classes', () => {
        const html = '<h2>Item 1</h2><table><tr><td>Val</td></tr></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('Val', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'added', { newSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        expect(container.innerHTML).toContain('diff-cell-added');
        expect(container.innerHTML).not.toContain('diff-cell-removed');
        expect(container.innerHTML).not.toContain('diff-row-removed');
      });

      it('TFC-I12: added row ignored on old side (no old rowIndex)', () => {
        const html = '<h2>Item 1</h2><table><tr><td>Row</td></tr></table>';
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('Row', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const rd = makeRowDiff('added', [], undefined, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="old" />,
        );
        // Added row on old side → no highlighting
        expect(container.querySelectorAll('[class*="diff-"]')).toHaveLength(0);
      });

      it('TFC-I13: modified cell shows old→new annotation on both sides', () => {
        const html = '<h2>Item 1</h2><table><tr><td>Val</td></tr></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('Val', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'modified', {
          oldSource: { start: tdStart, end: tdEnd },
          newSource: { start: tdStart, end: tdEnd },
          oldValue: 'X', newValue: 'Val',
        });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        // Old side shows annotation
        const { container: oldC } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="old" />,
        );
        const oldCell = oldC.querySelector('td.diff-cell-modified');
        expect(oldCell).not.toBeNull();
        expect(oldCell?.querySelector('del')).not.toBeNull();
        expect(oldCell?.querySelector('ins')).not.toBeNull();

        // New side also shows annotation
        const { container: newC } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        const newCell = newC.querySelector('td.diff-cell-modified');
        expect(newCell).not.toBeNull();
        expect(newCell?.querySelector('del')).not.toBeNull();
        expect(newCell?.querySelector('ins')).not.toBeNull();
      });
    });

    describe('Table structure preservation', () => {
      it('TFC-I14: table, tr, td, th elements all present after highlighting', () => {
        const html = '<h2>Item 1</h2><table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Data</td></tr></tbody></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const dataRowStart = html.indexOf('<tr>', html.indexOf('<tbody>'));
        const dataRowEnd = html.indexOf('</tr>', dataRowStart) + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [
                makeTableRow(
                  [makeTableCell('Header', html.indexOf('<th>'), html.indexOf('</th>') + 5)],
                  html.indexOf('<tr>'), html.indexOf('</tr>') + 5, true,
                ),
                makeTableRow(
                  [makeTableCell('Data', tdStart, tdEnd)],
                  dataRowStart, dataRowEnd,
                ),
              ],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(1, 0, 'modified', {
          oldSource: { start: tdStart, end: tdEnd },
          newSource: { start: tdStart, end: tdEnd },
          oldValue: 'Old', newValue: 'Data',
        });
        const rd = makeRowDiff('modified', [cd], 1, 1);
        const td = makeTableDiff('modified',
          [makeRowDiff('unchanged', [], 0, 0), rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );

        expect(container.querySelector('table')).not.toBeNull();
        expect(container.querySelectorAll('tr').length).toBeGreaterThanOrEqual(2);
        expect(container.querySelector('td')).not.toBeNull();
        expect(container.querySelector('th')).not.toBeNull();
      });

      it('TFC-I15: colspan attribute preserved on highlighted cell', () => {
        const html = '<h2>Item 1</h2><table><tr><td colspan="2">Span</td></tr></table>';
        const tdStart = html.indexOf('<td');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('Span', tdStart, tdEnd, { colspan: 2 })], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'added', { newSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        const cell = container.querySelector('td');
        expect(cell?.getAttribute('colspan')).toBe('2');
        expect(cell?.className).toContain('diff-cell-added');
      });

      it('TFC-I16: rowspan attribute preserved on highlighted cell', () => {
        const html = '<h2>Item 1</h2><table><tr><td rowspan="2">Span</td><td>A</td></tr><tr><td>B</td></tr></table>';
        const tdStart = html.indexOf('<td rowspan');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('Span', tdStart, tdEnd, { rowspan: 2 })], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'added', { newSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );

        const addedCell = container.querySelector('td.diff-cell-added');
        expect(addedCell).not.toBeNull();
        expect(addedCell?.getAttribute('rowspan')).toBe('2');
      });

      it('TFC-I17: inline style attributes preserved alongside injected class', () => {
        const html = '<h2>Item 1</h2><table><tr><td style="text-align:right;font-weight:bold;">$100</td></tr></table>';
        const tdStart = html.indexOf('<td style');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('$100', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'added', { newSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );

        const addedCell = container.querySelector('td.diff-cell-added');
        expect(addedCell).not.toBeNull();
        expect(addedCell?.getAttribute('style')).toContain('text-align');
        expect(addedCell?.getAttribute('style')).toContain('font-weight');
      });

      it('TFC-I18: thead and tbody elements preserved', () => {
        const html = '<h2>Item 1</h2><table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Val</td></tr></tbody></table>';
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;
        const dataRowStart = html.indexOf('<tr>', html.indexOf('<tbody>'));
        const dataRowEnd = html.indexOf('</tr>', dataRowStart) + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [
                makeTableRow(
                  [makeTableCell('Col', html.indexOf('<th>'), html.indexOf('</th>') + 5)],
                  html.indexOf('<tr>'), html.indexOf('</tr>') + 5, true,
                ),
                makeTableRow(
                  [makeTableCell('Val', tdStart, tdEnd)],
                  dataRowStart, dataRowEnd,
                ),
              ],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(1, 0, 'added', { newSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 1, 1);
        const td = makeTableDiff('modified',
          [makeRowDiff('unchanged', [], 0, 0), rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );

        expect(container.querySelector('thead')).not.toBeNull();
        expect(container.querySelector('tbody')).not.toBeNull();
        expect(container.querySelector('td.diff-cell-added')).not.toBeNull();
      });

      it('TFC-I19: existing CSS class on <td> preserved alongside diff-* class', () => {
        const html = '<h2>Item 1</h2><table><tr><td class="num">100</td></tr></table>';
        const tdStart = html.indexOf('<td');
        const tdEnd = html.indexOf('</td>') + 5;
        const tableStart = html.indexOf('<table>');
        const tableEnd = html.indexOf('</table>') + 8;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('100', tdStart, tdEnd)], trStart, trEnd)],
              tableStart, tableEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'added', { newSource: { start: tdStart, end: tdEnd } });
        const rd = makeRowDiff('modified', [cd], 0, 0);
        const td = makeTableDiff('modified', [rd],
          { start: tableStart, end: tableEnd },
          { start: tableStart, end: tableEnd },
        );
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [td]);

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        const cell = container.querySelector('td');
        expect(cell?.className).toContain('num');
        expect(cell?.className).toContain('diff-cell-added');
      });
    });

    // --- 3.6 Mixed content in section ---

    describe('Mixed content in section', () => {
      it('TFC-I20: section with both paragraph diffs AND table diffs renders both', () => {
        const paraHtml = '<p>Text here.</p>';
        const tableHtml = '<table><tr><td>Cell</td></tr></table>';
        const html = paraHtml + tableHtml;

        const paraStart = 0;
        const paraEnd = paraHtml.length;
        const tblStart = paraEnd;
        const tblEnd = html.length;
        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Text here.', paraStart, paraEnd),
            makeTableBlock(
              [makeTableRow([makeTableCell('Cell', tdStart, tdEnd)], trStart, trEnd)],
              tblStart, tblEnd,
            ),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'added', { newSource: { start: tdStart, end: tdEnd } });
        const sd = makeSectionDiffWithTables(
          'item-1', 'Item 1',
          [makeParagraphDiff('added', undefined, { start: paraStart, end: paraEnd })],
          [makeTableDiff('modified',
            [makeRowDiff('modified', [cd], 0, 0)],
            { start: tblStart, end: tblEnd },
            { start: tblStart, end: tblEnd },
          )],
        );

        const { container } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );

        // Paragraph highlighted
        expect(container.querySelector('ins.diff-paragraph-added')).not.toBeNull();
        // Table cell highlighted
        expect(container.querySelector('td.diff-cell-added')).not.toBeNull();
      });

      it('TFC-I21: multiple tables in a section — each processed independently', () => {
        const t1Html = '<table><tr><td>T1</td></tr></table>';
        const t2Html = '<table><tr><td>T2</td></tr></table>';
        const html = t1Html + t2Html;

        const t1Start = 0;
        const t1End = t1Html.length;
        const t2Start = t1End;
        const t2End = html.length;

        const t1TrStart = html.indexOf('<tr>');
        const t1TrEnd = html.indexOf('</tr>') + 5;
        const t1TdStart = html.indexOf('<td>');
        const t1TdEnd = html.indexOf('</td>') + 5;

        const t2TrStart = html.indexOf('<tr>', t1End);
        const t2TrEnd = html.indexOf('</tr>', t1End) + 5;
        const t2TdStart = html.indexOf('<td>', t1End);
        const t2TdEnd = html.indexOf('</td>', t1End) + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeTableBlock(
              [makeTableRow([makeTableCell('T1', t1TdStart, t1TdEnd)], t1TrStart, t1TrEnd)],
              t1Start, t1End,
            ),
            makeTableBlock(
              [makeTableRow([makeTableCell('T2', t2TdStart, t2TdEnd)], t2TrStart, t2TrEnd)],
              t2Start, t2End,
            ),
          ]),
        ]);

        const cd1 = makeCellDiff(0, 0, 'added', { newSource: { start: t1TdStart, end: t1TdEnd } });
        const cd2 = makeCellDiff(0, 0, 'removed', { oldSource: { start: t2TdStart, end: t2TdEnd } });
        const sd = makeSectionDiffWithTables('item-1', 'Item 1', [], [
          makeTableDiff('modified',
            [makeRowDiff('modified', [cd1], 0, 0)],
            { start: t1Start, end: t1End },
            { start: t1Start, end: t1End },
          ),
          makeTableDiff('modified',
            [makeRowDiff('modified', [cd2], 0, 0)],
            { start: t2Start, end: t2End },
            { start: t2Start, end: t2End },
          ),
        ]);

        // New side: T1 added shown, T2 removed not shown
        const { container: newC } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        expect(newC.querySelectorAll('td.diff-cell-added')).toHaveLength(1);
        expect(newC.querySelectorAll('td.diff-cell-removed')).toHaveLength(0);

        // Old side: T2 removed shown, T1 added not shown
        const { container: oldC } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="old" />,
        );
        expect(oldC.querySelectorAll('td.diff-cell-removed')).toHaveLength(1);
        expect(oldC.querySelectorAll('td.diff-cell-added')).toHaveLength(0);
      });

      it('TFC-I22: table between two paragraphs — all three get correct highlights', () => {
        const p1Html = '<p>Before table.</p>';
        const tableHtml = '<table><tr><td>Cell</td></tr></table>';
        const p2Html = '<p>After table.</p>';
        const html = p1Html + tableHtml + p2Html;

        const p1Start = 0;
        const p1End = p1Html.length;
        const tblStart = p1End;
        const tblEnd = p1End + tableHtml.length;
        const p2Start = tblEnd;
        const p2End = html.length;

        const trStart = html.indexOf('<tr>');
        const trEnd = html.indexOf('</tr>') + 5;
        const tdStart = html.indexOf('<td>');
        const tdEnd = html.indexOf('</td>') + 5;

        const doc = makeDoc(html, [
          makeSection('item-1', 'Item 1', 0, html.length, [
            makeParagraph('Before table.', p1Start, p1End),
            makeTableBlock(
              [makeTableRow([makeTableCell('Cell', tdStart, tdEnd)], trStart, trEnd)],
              tblStart, tblEnd,
            ),
            makeParagraph('After table.', p2Start, p2End),
          ]),
        ]);

        const cd = makeCellDiff(0, 0, 'modified', {
          oldSource: { start: tdStart, end: tdEnd },
          newSource: { start: tdStart, end: tdEnd },
          oldValue: 'Old', newValue: 'Cell',
        });
        const sd = makeSectionDiffWithTables(
          'item-1', 'Item 1',
          [
            makeParagraphDiff('removed', { start: p1Start, end: p1End }, undefined),
            makeParagraphDiff('added', undefined, { start: p2Start, end: p2End }),
          ],
          [makeTableDiff('modified',
            [makeRowDiff('modified', [cd], 0, 0)],
            { start: tblStart, end: tblEnd },
            { start: tblStart, end: tblEnd },
          )],
        );

        // Old side: p1 removed, table modified, p2 not shown
        const { container: oldC } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="old" />,
        );
        expect(oldC.querySelector('del.diff-paragraph-removed')).not.toBeNull();
        expect(oldC.querySelector('td.diff-cell-modified')).not.toBeNull();
        expect(oldC.querySelectorAll('ins.diff-paragraph-added')).toHaveLength(0);

        // New side: p2 added, table modified, p1 not shown
        const { container: newC } = render(
          <FilingContent document={doc} sectionDiffs={[sd]} side="new" />,
        );
        expect(newC.querySelector('ins.diff-paragraph-added')).not.toBeNull();
        expect(newC.querySelector('td.diff-cell-modified')).not.toBeNull();
        expect(newC.querySelectorAll('del.diff-paragraph-removed')).toHaveLength(0);
      });
    });
  });
});
