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
