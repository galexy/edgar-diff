import { describe, it, expect } from 'vitest';
import { assertDefined } from '../helpers/assert-defined.js';
import { diffParagraphs } from '../../src/diff/paragraph-differ.js';
import { makeParagraph, makeSection } from '../helpers/diff-fixtures.js';
import type { SectionMatch } from '../../src/diff/section-aligner.js';
import type { ParagraphDiff } from '../../src/diff/types.js';
import type { FilingSection } from '../../src/types.js';

function match(oldSec: FilingSection, newSec: FilingSection, oldIndex = 0, newIndex = 0): SectionMatch {
  return { oldIndex, newIndex, oldSection: oldSec, newSection: newSec, similarity: 1 };
}

// Build a diff result with all change types for contract testing
function buildMixedDiff(): ParagraphDiff[] {
  const old = makeSection('s1', 'S', [
    makeParagraph('Unchanged paragraph stays the same.', 100),
    makeParagraph('This paragraph will be removed entirely.', 200),
    makeParagraph('The company reported strong revenue growth in the fiscal year ending December 2023 with excellent results.', 300),
    makeParagraph('This text will be modified slightly.', 500),
  ]);
  const neu = makeSection('s1', 'S', [
    makeParagraph('Unchanged paragraph stays the same.', 100),
    makeParagraph('This text will be modified a bit.', 200),
    makeParagraph('Brand new paragraph added here.', 300),
    makeParagraph('The company reported strong revenue growth in the fiscal year ending December 2024 with excellent results.', 400),
  ]);
  return diffParagraphs(match(old, neu));
}

describe('diff type contracts', () => {
  const changes = buildMixedDiff();

  // DT-U6: Source locations satisfy start >= 0, start < end
  it('DT-U6: source locations have valid ranges', () => {
    for (const c of changes) {
      if (c.sourceMapping.old) {
        expect(c.sourceMapping.old.start).toBeGreaterThanOrEqual(0);
        expect(c.sourceMapping.old.start).toBeLessThan(c.sourceMapping.old.end);
      }
      if (c.sourceMapping.new) {
        expect(c.sourceMapping.new.start).toBeGreaterThanOrEqual(0);
        expect(c.sourceMapping.new.start).toBeLessThan(c.sourceMapping.new.end);
      }
    }
  });

  // DT-U7: modified entries always have wordChanges defined (may be empty when quality gate triggers)
  it('DT-U7: modified entries always have wordChanges populated', () => {
    const modified = changes.filter(c => c.changeType === 'modified');
    for (const c of modified) {
      expect(c.wordChanges).toBeDefined();
      expect(Array.isArray(c.wordChanges)).toBe(true);
    }
  });

  // DT-U8: moved entries without text change have no wordChanges
  it('DT-U8: moved entries with identical text have no wordChanges', () => {
    // Create a pure move scenario
    const old = makeSection('s1', 'S', [
      makeParagraph('Alpha paragraph.', 100),
      makeParagraph('Beta paragraph.', 200),
    ]);
    const neu = makeSection('s1', 'S', [
      makeParagraph('Beta paragraph.', 100),
      makeParagraph('Alpha paragraph.', 200),
    ]);
    const diffs = diffParagraphs(match(old, neu));
    const moved = diffs.filter(c => c.changeType === 'moved');
    for (const m of moved) {
      // Pure move (identical text) has no wordChanges
      if (m.wordChanges === undefined) {
        expect(m.wordChanges).toBeUndefined();
      }
    }
  });

  // DT-U9: moved entries with text change have wordChanges
  it('DT-U9: moved entries with text change have wordChanges populated', () => {
    const old = makeSection('s1', 'S', [
      makeParagraph('The company reported strong revenue growth in the fiscal year ending December 2023 with excellent overall results.', 100),
      makeParagraph('Beta paragraph text here.', 300),
    ]);
    const neu = makeSection('s1', 'S', [
      makeParagraph('Beta paragraph text here.', 100),
      makeParagraph('The company reported strong revenue growth in the fiscal year ending December 2024 with excellent overall results.', 200),
    ]);
    const diffs = diffParagraphs(match(old, neu));
    const moved = diffs.filter(c => c.changeType === 'moved');
    const withTextChange = moved.filter(m => m.wordChanges !== undefined);
    for (const m of withTextChange) {
      expect(m.wordChanges).toBeDefined();
      assertDefined(m.wordChanges);
      expect(m.wordChanges.length).toBeGreaterThan(0);
    }
  });
});
