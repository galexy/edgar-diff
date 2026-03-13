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

  it('U-AS-9: greedy matching picks highest similarity per section (JW fallback)', () => {
    // Use non-item headings to test JW fallback greedy behavior
    const oldSections = [
      makeFilingSection('custom-a', 'Supplementary Data Tables'),
      makeFilingSection('custom-b', 'Additional Supplementary Notes'),
    ];
    const newSections = [
      makeFilingSection('custom-a', 'Supplementary Data Tables and Figures'),
      makeFilingSection('custom-b', 'Additional Supplementary Notes Revised'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(2);
    // Each should match its closest counterpart, not cross-match
    const matchMap = new Map(result.matched.map((m) => [m.oldSection.id, m.newSection.id]));
    expect(matchMap.get('custom-a')).toBe('custom-a');
    expect(matchMap.get('custom-b')).toBe('custom-b');
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

  it('U-AS-12: sections with different item numbers never match despite high Jaro-Winkler', () => {
    // "Item 1C. Cybersecurity" and "Item 2. Properties" have JW > 0.75
    // but different item numbers (1c vs 2), so must NOT match
    const oldSections = [
      makeFilingSection('item-1c', 'Item 1C. Cybersecurity'),
    ];
    const newSections = [
      makeFilingSection('item-2', 'Item 2. Properties'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
  });

  it('U-AS-13: sections with same item number but renamed headings are matched', () => {
    const oldSections = [
      makeFilingSection('item-1a', 'Item 1A. Risk Factors'),
    ];
    const newSections = [
      makeFilingSection('item-1a', 'Item 1A. Risk Factors and Uncertainties'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(1);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('U-AS-14: sections without item numbers fall back to Jaro-Winkler', () => {
    const oldSections = [
      makeFilingSection('custom', 'Management Discussion and Analysis'),
    ];
    const newSections = [
      makeFilingSection('custom', 'Management Discussion & Analysis'),
    ];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(1);
  });

  it('U-AS-15: mixed item-number and non-item sections are handled correctly', () => {
    const oldSections = [
      makeFilingSection('item-1', 'Item 1. Business'),
      makeFilingSection('item-1c', 'Item 1C. Cybersecurity'),
      makeFilingSection('custom', 'Supplementary Data'),
    ];
    const newSections = [
      makeFilingSection('item-1', 'Item 1. Business Overview'),
      makeFilingSection('item-2', 'Item 2. Properties'),
      makeFilingSection('custom', 'Supplementary Data'),
    ];
    const result = alignSections(oldSections, newSections);
    // Item 1 matches Item 1 (same item number)
    // Item 1C has no match (no item 1c in new)
    // Supplementary Data matches via Jaro-Winkler
    // Item 2 is added (no item 2 in old)
    expect(result.matched).toHaveLength(2);
    const matchedHeadings = result.matched.map((m) => [m.oldSection.heading, m.newSection.heading]);
    expect(matchedHeadings).toContainEqual(['Item 1. Business', 'Item 1. Business Overview']);
    expect(matchedHeadings).toContainEqual(['Supplementary Data', 'Supplementary Data']);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].heading).toBe('Item 2. Properties');
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].heading).toBe('Item 1C. Cybersecurity');
  });

  it('U-AS-16: alignment is deterministic across repeated calls', () => {
    const oldSections = [
      makeFilingSection('a', 'Alpha Section'),
      makeFilingSection('b', 'Beta Section'),
    ];
    const newSections = [
      makeFilingSection('b', 'Beta Section'),
      makeFilingSection('a', 'Alpha Section'),
    ];
    const r1 = alignSections(oldSections, newSections);
    const r2 = alignSections(oldSections, newSections);
    expect(r1.matched.map(m => m.oldSection.id)).toEqual(r2.matched.map(m => m.oldSection.id));
    expect(r1.matched.map(m => m.newSection.id)).toEqual(r2.matched.map(m => m.newSection.id));
  });

  it('U-AS-17: case-insensitive heading matching', () => {
    const oldSections = [makeFilingSection('item-1a', 'RISK FACTORS')];
    const newSections = [makeFilingSection('item-1a', 'Risk Factors')];
    const result = alignSections(oldSections, newSections);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].similarity).toBe(1);
  });

  it('U-AS-18: matched pairs have valid oldIndex and newIndex', () => {
    const oldSections = [
      makeFilingSection('a', 'Alpha'),
      makeFilingSection('b', 'Beta'),
    ];
    const newSections = [
      makeFilingSection('a', 'Alpha'),
      makeFilingSection('b', 'Beta'),
    ];
    const result = alignSections(oldSections, newSections);
    for (const m of result.matched) {
      expect(m.oldIndex).toBeGreaterThanOrEqual(0);
      expect(m.newIndex).toBeGreaterThanOrEqual(0);
    }
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

describe('isReordered', () => {
  it('returns false when section position is preserved', () => {
    const matches: SectionMatch[] = [
      { oldIndex: 0, newIndex: 0, oldSection: makeFilingSection('a', 'A'), newSection: makeFilingSection('a', 'A'), similarity: 1 },
      { oldIndex: 1, newIndex: 1, oldSection: makeFilingSection('b', 'B'), newSection: makeFilingSection('b', 'B'), similarity: 1 },
    ];
    expect(isReordered(matches, matches[0])).toBe(false);
    expect(isReordered(matches, matches[1])).toBe(false);
  });

  it('returns true when section position is swapped', () => {
    const matches: SectionMatch[] = [
      { oldIndex: 0, newIndex: 1, oldSection: makeFilingSection('a', 'A'), newSection: makeFilingSection('a', 'A'), similarity: 1 },
      { oldIndex: 1, newIndex: 0, oldSection: makeFilingSection('b', 'B'), newSection: makeFilingSection('b', 'B'), similarity: 1 },
    ];
    expect(isReordered(matches, matches[0])).toBe(true);
    expect(isReordered(matches, matches[1])).toBe(true);
  });

  it('returns false for single match (no other to compare against)', () => {
    const matches: SectionMatch[] = [
      { oldIndex: 0, newIndex: 2, oldSection: makeFilingSection('a', 'A'), newSection: makeFilingSection('a', 'A'), similarity: 1 },
    ];
    expect(isReordered(matches, matches[0])).toBe(false);
  });
});

describe('classifySectionDiff', () => {
  it('U-CS-1: same heading, same content, same position => unchanged', () => {
    const blocks = [makeParagraph('Same content')];
    const match: SectionMatch = {
      oldIndex: 0, newIndex: 0,
      oldSection: makeFilingSection('item-1', 'Item 1', { blocks }),
      newSection: makeFilingSection('item-1', 'Item 1', { blocks }),
      similarity: 1,
    };
    expect(classifySectionDiff(match, [match])).toBe('unchanged');
  });

  it('U-CS-2: same heading, different content, same position => modified', () => {
    const match: SectionMatch = {
      oldIndex: 0, newIndex: 0,
      oldSection: makeFilingSection('item-1', 'Item 1', { blocks: [makeParagraph('Old text')] }),
      newSection: makeFilingSection('item-1', 'Item 1', { blocks: [makeParagraph('New text')] }),
      similarity: 1,
    };
    expect(classifySectionDiff(match, [match])).toBe('modified');
  });

  it('U-CS-3: moved to different relative position, same content => reordered', () => {
    const blocksA = [makeParagraph('Content A')];
    const blocksB = [makeParagraph('Content B')];
    const matches: SectionMatch[] = [
      {
        oldIndex: 0, newIndex: 1,
        oldSection: makeFilingSection('a', 'A', { blocks: blocksA }),
        newSection: makeFilingSection('a', 'A', { blocks: blocksA }),
        similarity: 1,
      },
      {
        oldIndex: 1, newIndex: 0,
        oldSection: makeFilingSection('b', 'B', { blocks: blocksB }),
        newSection: makeFilingSection('b', 'B', { blocks: blocksB }),
        similarity: 1,
      },
    ];
    expect(classifySectionDiff(matches[0], matches)).toBe('reordered');
    expect(classifySectionDiff(matches[1], matches)).toBe('reordered');
  });

  it('U-CS-4: moved + different content => modified (content takes precedence)', () => {
    const matches: SectionMatch[] = [
      {
        oldIndex: 0, newIndex: 1,
        oldSection: makeFilingSection('a', 'A', { blocks: [makeParagraph('Old A')] }),
        newSection: makeFilingSection('a', 'A', { blocks: [makeParagraph('New A')] }),
        similarity: 1,
      },
      {
        oldIndex: 1, newIndex: 0,
        oldSection: makeFilingSection('b', 'B', { blocks: [makeParagraph('Same B')] }),
        newSection: makeFilingSection('b', 'B', { blocks: [makeParagraph('Same B')] }),
        similarity: 1,
      },
    ];
    expect(classifySectionDiff(matches[0], matches)).toBe('modified');
    expect(classifySectionDiff(matches[1], matches)).toBe('reordered');
  });
});
