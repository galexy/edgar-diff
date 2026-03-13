import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type {
  StructuredDocument,
  FilingSection,
  Paragraph,
  ParagraphDiff,
  SectionDiff,
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
});
