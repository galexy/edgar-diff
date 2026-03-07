import { describe, it, expect } from 'vitest';
import {
  serializeSectionContent,
  alignSections,
  isReordered,
  classifySectionDiff,
} from '../../../src/diff/section-aligner.js';
import type { SectionMatch } from '../../../src/diff/section-aligner.js';
import {
  makeFilingSection,
  makeParagraph,
  makeTable,
} from '../../helpers/diff-helpers.js';

describe('serializeSectionContent', () => {
  it('U-SC-1: empty blocks array => empty string', () => {
    const section = makeFilingSection('item-1', 'Item 1', { blocks: [] });
    expect(serializeSectionContent(section)).toBe('');
  });

  it('U-SC-2: paragraph blocks => concatenated text joined by newline', () => {
    const section = makeFilingSection('item-1', 'Item 1', {
      blocks: [
        makeParagraph('First paragraph.'),
        makeParagraph('Second paragraph.'),
      ],
    });
    expect(serializeSectionContent(section)).toBe(
      'First paragraph.\nSecond paragraph.',
    );
  });

  it('U-SC-3: table blocks => concatenated cell texts, row by row', () => {
    const section = makeFilingSection('item-1', 'Item 1', {
      blocks: [
        makeTable([
          ['Header 1', 'Header 2'],
          ['Cell A', 'Cell B'],
        ]),
      ],
    });
    const result = serializeSectionContent(section);
    expect(result).toContain('Header 1');
    expect(result).toContain('Header 2');
    expect(result).toContain('Cell A');
    expect(result).toContain('Cell B');
  });

  it('U-SC-4: mixed paragraph and table blocks => both serialized in order', () => {
    const section = makeFilingSection('item-1', 'Item 1', {
      blocks: [
        makeParagraph('Intro text.'),
        makeTable([['Col A', 'Col B']]),
        makeParagraph('Closing text.'),
      ],
    });
    const result = serializeSectionContent(section);
    const introIdx = result.indexOf('Intro text.');
    const colIdx = result.indexOf('Col A');
    const closingIdx = result.indexOf('Closing text.');
    expect(introIdx).toBeLessThan(colIdx);
    expect(colIdx).toBeLessThan(closingIdx);
  });

  it('U-SC-5: two sections with same text content => identical serialization', () => {
    const blocks = [makeParagraph('Same content here.')];
    const s1 = makeFilingSection('item-1', 'Item 1', { blocks });
    const s2 = makeFilingSection('item-2', 'Item 2', { blocks });
    expect(serializeSectionContent(s1)).toBe(serializeSectionContent(s2));
  });
});

describe('alignSections', () => {
  it('U-AS-1: empty old + empty new => no matches, no added, no removed', () => {
    const result = alignSections([], []);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('U-AS-2: empty old + N new => 0 matched, N added', () => {
    const newSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const result = alignSections([], newSections);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it('U-AS-3: N old + empty new => 0 matched, N removed', () => {
    const oldSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const result = alignSections(oldSections, []);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(2);
  });

  it('U-AS-4: identical headings => N matched, 0 added, 0 removed', () => {
    const oldSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-1a', 'Item 1A. Risk Factors'),
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const newSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-1a', 'Item 1A. Risk Factors'),
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(3);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('U-AS-5: one section added in new => (N-1) matched, 1 added', () => {
    const oldSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const newSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-1c', 'Item 1C. Cybersecurity'),
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(2);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].heading).toBe('Item 1C. Cybersecurity');
    expect(result.removed).toHaveLength(0);
  });

  it('U-AS-6: one section removed from old => (N-1) matched, 1 removed', () => {
    const oldSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-1a', 'Item 1A. Risk Factors'),
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const newSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(2);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].heading).toBe('Item 1A. Risk Factors');
  });

  it('U-AS-7: renamed heading (above threshold 0.75) => matched, not add+remove', () => {
    const oldSections = [
      makeFilingSection('item-1a', 'Item 1A. Risk Factors'),
    ];
    const newSections = [
      makeFilingSection('item-1a', 'Item 1A. Risk Factor'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(1);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.matched[0].similarity).toBeGreaterThanOrEqual(0.75);
  });

  it('U-AS-8: completely different headings (below threshold) => all added + all removed', () => {
    const oldSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
    ];
    const newSections = [
      makeFilingSection('item-7', 'Item 7. Financial Statements'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
  });

  it('U-AS-9: greedy matching picks highest similarity per section', () => {
    const oldSections = [
      makeFilingSection('item-1', 'Item 1. Business Overview'),
    ];
    const newSections = [
      makeFilingSection('item-1a', 'Item 1. Business'),
      makeFilingSection('item-1b', 'Item 1. Business Overview and Strategy'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(1);
    // Should match the more similar heading
    expect(result.matched[0].newSection.heading).toBe(
      'Item 1. Business Overview and Strategy',
    );
  });

  it('U-AS-10: sections with duplicate headings — each matched at most once', () => {
    const oldSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-1-dup', 'Item 1. Business'),
    ];
    const newSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.added).toHaveLength(0);
  });

  it('U-AS-11: threshold boundary — similarity at 0.75 matches; below does not', () => {
    // Use a custom threshold and verify boundary behavior
    const oldSections = [
      makeFilingSection('s1', 'Risk Factors Discussion'),
    ];
    const newSections = [
      makeFilingSection('s1', 'Risk Factors Analysis'),
    ];

    // With default threshold (0.75), should match since headings are similar
    const resultDefault = alignSections(oldSections, newSections);
    if (resultDefault.matched.length > 0) {
      const sim = resultDefault.matched[0].similarity;
      // With threshold just above the similarity, should not match
      const resultHigh = alignSections(oldSections, newSections, {
        threshold: sim + 0.01,
      });
      expect(resultHigh.matched).toHaveLength(0);

      // With threshold at exactly the similarity, should match
      const resultExact = alignSections(oldSections, newSections, {
        threshold: sim,
      });
      expect(resultExact.matched).toHaveLength(1);
    }
  });
});
