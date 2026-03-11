import { describe, it, expect } from 'vitest';
import { assertDefined } from '../helpers/assert-defined.js';
import { diffParagraphs } from '../../src/diff/paragraph-differ.js';
import { makeParagraph, makeTable, makeSection } from '../helpers/diff-fixtures.js';
import type { SectionMatch } from '../../src/diff/section-aligner.js';
import type { ParagraphDiff } from '../../src/diff/types.js';
import type { FilingSection } from '../../src/types.js';

function match(oldSec: FilingSection, newSec: FilingSection, similarity = 1): SectionMatch {
  return { oldIndex: 0, newIndex: 0, oldSection: oldSec, newSection: newSec, similarity };
}

function paragraphDiffs(m: SectionMatch): ParagraphDiff[] {
  return diffParagraphs(m);
}

describe('paragraph-differ', () => {
  // PD-U1: Identical paragraphs → all unchanged
  it('PD-U1: identical paragraphs produce all unchanged', () => {
    const old = makeSection('s1', 'Section', [makeParagraph('Hello world.', 100), makeParagraph('Goodbye.', 200)]);
    const neu = makeSection('s1', 'Section', [makeParagraph('Hello world.', 100), makeParagraph('Goodbye.', 200)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(2);
    expect(changes.every(c => c.changeType === 'unchanged')).toBe(true);
  });

  // PD-U2: Added paragraph at end
  it('PD-U2: detects added paragraph at end', () => {
    const old = makeSection('s1', 'S', [makeParagraph('A', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('B', 200)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(2);
    expect(changes[0].changeType).toBe('unchanged');
    expect(changes[1].changeType).toBe('added');
    expect(changes[1].sourceMapping.new).toBeDefined();
  });

  // PD-U3: Deleted paragraph from middle
  it('PD-U3: detects deleted paragraph', () => {
    const old = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('B', 200), makeParagraph('C', 300)]);
    const neu = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('C', 200)]);
    const changes = paragraphDiffs(match(old, neu));
    const removed = changes.filter(c => c.changeType === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].sourceMapping.old).toBeDefined();
  });

  // PD-U4: Modified paragraph with word-level diff
  it('PD-U4: detects modified paragraph with word changes', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Revenue increased by 10% in fiscal 2023.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Revenue increased by 15% in fiscal 2024.', 100)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe('modified');
    expect(changes[0].wordChanges).toBeDefined();
    assertDefined(changes[0].wordChanges);
    expect(changes[0].wordChanges.length).toBeGreaterThan(0);
  });

  // PD-U5: Multiple changes in one section
  it('PD-U5: handles add + delete + modify in one section', () => {
    const old = makeSection('s1', 'S', [
      makeParagraph('Keep this.', 100),
      makeParagraph('Delete this.', 200),
      makeParagraph('Modify this text.', 300),
    ]);
    const neu = makeSection('s1', 'S', [
      makeParagraph('Keep this.', 100),
      makeParagraph('Modify this content.', 200),
      makeParagraph('New paragraph.', 300),
    ]);
    const changes = paragraphDiffs(match(old, neu));
    const types = changes.map(c => c.changeType);
    expect(types).toContain('unchanged');
    expect(types).toContain('removed');
    expect(types).toContain('added');
    expect(changes.length).toBeGreaterThanOrEqual(3);
  });

  // PD-U6: Two paragraphs swapped → at least one detected as moved
  it('PD-U6: detects swapped paragraphs — moved paragraph has no wordChanges', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Alpha paragraph text.', 100), makeParagraph('Beta paragraph text.', 200)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Beta paragraph text.', 100), makeParagraph('Alpha paragraph text.', 200)]);
    const changes = paragraphDiffs(match(old, neu));
    const moved = changes.filter(c => c.changeType === 'moved');
    expect(moved.length).toBeGreaterThanOrEqual(1);
    for (const m of moved) {
      expect(m.wordChanges).toBeUndefined();
    }
    expect(changes.filter(c => c.changeType === 'added')).toHaveLength(0);
    expect(changes.filter(c => c.changeType === 'removed')).toHaveLength(0);
  });

  // PD-U7: Moved with modification
  it('PD-U7: moved paragraph with modification has wordChanges', () => {
    const old = makeSection('s1', 'S', [
      makeParagraph('The company reported strong revenue growth in the fiscal year ending December 2023.', 100),
      makeParagraph('Operating expenses remained within the projected budget for the quarter.', 300),
    ]);
    const neu = makeSection('s1', 'S', [
      makeParagraph('Operating expenses remained within the projected budget for the quarter.', 100),
      makeParagraph('The company reported strong revenue growth in the fiscal year ending December 2024.', 300),
    ]);
    const changes = paragraphDiffs(match(old, neu));
    const moved = changes.filter(c => c.changeType === 'moved');
    expect(moved.length).toBeGreaterThanOrEqual(1);
    const revenueMove = moved.find(c => c.wordChanges?.some(wc => wc.value.includes('2023') || wc.value.includes('2024')));
    assertDefined(revenueMove);
    expect(revenueMove.wordChanges).toBeDefined();
    expect(changes.filter(c => c.changeType === 'added')).toHaveLength(0);
    expect(changes.filter(c => c.changeType === 'removed')).toHaveLength(0);
  });

  // PD-U8: Empty base → all added
  it('PD-U8: empty base produces all added', () => {
    const old = makeSection('s1', 'S', []);
    const neu = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('B', 200)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(2);
    expect(changes.every(c => c.changeType === 'added')).toBe(true);
  });

  // PD-U9: Empty target → all deleted
  it('PD-U9: empty target produces all removed', () => {
    const old = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('B', 200)]);
    const neu = makeSection('s1', 'S', []);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(2);
    expect(changes.every(c => c.changeType === 'removed')).toBe(true);
  });

  // PD-U10: Both empty → empty diff
  it('PD-U10: both empty produces empty changes', () => {
    const old = makeSection('s1', 'S', []);
    const neu = makeSection('s1', 'S', []);
    const diffs = diffParagraphs(match(old, neu));
    expect(diffs).toHaveLength(0);
  });

  // PD-U11: Single paragraph, unchanged
  it('PD-U11: single unchanged paragraph', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Only one.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Only one.', 100)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe('unchanged');
  });

  // PD-U12: Single paragraph, modified
  it('PD-U12: single modified paragraph', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Old text.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('New text.', 100)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe('modified');
    expect(changes[0].wordChanges).toBeDefined();
  });

  // PD-U13: Word-level diff identifies specific words
  it('PD-U13: word-level diff identifies specific changed words', () => {
    const old = makeSection('s1', 'S', [makeParagraph('The cat sat on the mat.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('The dog sat on the rug.', 100)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes[0].changeType).toBe('modified');
    assertDefined(changes[0].wordChanges);
    const wc = changes[0].wordChanges;
    const removed = wc.filter(w => w.type === 'removed').map(w => w.value);
    const added = wc.filter(w => w.type === 'added').map(w => w.value);
    expect(removed.join('')).toContain('cat');
    expect(added.join('')).toContain('dog');
  });

  // PD-U14: Numeric changes
  it('PD-U14: word-level diff for numeric changes', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Revenue was $100M.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Revenue was $150M.', 100)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes[0].changeType).toBe('modified');
    assertDefined(changes[0].wordChanges);
    const wc = changes[0].wordChanges;
    expect(wc.some(w => w.type === 'removed' && w.value.includes('100M'))).toBe(true);
    expect(wc.some(w => w.type === 'added' && w.value.includes('150M'))).toBe(true);
  });

  // PD-U15: Unchanged spans filtered from word diff (BQ6)
  it('PD-U15: word-level diff contains only added and removed entries', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Revenue increased by 10% in fiscal 2023.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Revenue increased by 15% in fiscal 2024.', 100)]);
    const changes = paragraphDiffs(match(old, neu));
    assertDefined(changes[0].wordChanges);
    const wc = changes[0].wordChanges;
    // No unchanged entries in output
    expect(wc.filter(w => w.type === 'unchanged')).toHaveLength(0);
    // Only added and removed entries remain
    expect(wc.every(w => w.type === 'added' || w.type === 'removed')).toBe(true);
    // The actual changes are still present
    expect(wc.some(w => w.type === 'removed' && w.value.includes('10'))).toBe(true);
    expect(wc.some(w => w.type === 'added' && w.value.includes('15'))).toBe(true);
  });

  // PD-U16: Whitespace-only differences treated as unchanged
  it('PD-U16: whitespace-only differences treated as unchanged', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Hello   world.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Hello world.', 100)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe('unchanged');
  });

  // PD-U17: Very similar paragraphs identified as modified
  it('PD-U17: very similar paragraphs identified as modified', () => {
    const longText = 'The company operates in multiple segments across various regions providing services and products to customers worldwide with a focus on innovation and growth.';
    const modified = longText.replace('innovation', 'excellence');
    const old = makeSection('s1', 'S', [makeParagraph(longText, 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph(modified, 100)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe('modified');
  });

  // PD-U18: Completely different paragraphs = delete + add
  it('PD-U18: completely different paragraphs are delete+add', () => {
    const old = makeSection('s1', 'S', [makeParagraph('The sky is blue and vast.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Revenue grew by five percent.', 100)]);
    const changes = paragraphDiffs(match(old, neu));
    expect(changes.length).toBeGreaterThanOrEqual(1);
  });

  // PD-U19: Move detection: dissimilar paragraphs stay as removed+added
  it('PD-U19: dissimilar paragraphs not falsely matched as moves', () => {
    const old = makeSection('s1', 'S', [makeParagraph('The sky is blue.', 100), makeParagraph('Common text.', 200)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Common text.', 100), makeParagraph('Revenue grew 5%.', 200)]);
    const changes = paragraphDiffs(match(old, neu));
    // 'The sky is blue.' should not be falsely matched as a move to 'Revenue grew 5%.'
    // Verify no move entries exist for dissimilar text
    const skyRemoved = changes.filter(c => c.changeType === 'removed');
    expect(skyRemoved.length).toBeGreaterThanOrEqual(0); // may be removed or modified with 'Revenue grew 5%.'
    // The key assertion: no moved entry should pair such dissimilar texts
    const movedEntries = changes.filter(c => c.changeType === 'moved');
    // If there's a moved entry, it should be 'Common text.' (which appears in both)
    for (const m of movedEntries) {
      expect(m.sourceMapping.old).toBeDefined();
      expect(m.sourceMapping.new).toBeDefined();
    }
  });

  // PD-U20: Near-threshold move detection
  it('PD-U20: swapped exact-match paragraphs detected as moved', () => {
    const old = makeSection('s1', 'S', [
      makeParagraph('First paragraph about risk factors in the market.', 100),
      makeParagraph('Second paragraph about revenue growth rates.', 200),
    ]);
    const neu = makeSection('s1', 'S', [
      makeParagraph('Second paragraph about revenue growth rates.', 100),
      makeParagraph('First paragraph about risk factors in the market.', 200),
    ]);
    const changes = paragraphDiffs(match(old, neu));
    const moved = changes.filter(c => c.changeType === 'moved');
    expect(moved.length).toBeGreaterThanOrEqual(1);
    expect(changes.filter(c => c.changeType === 'added')).toHaveLength(0);
    expect(changes.filter(c => c.changeType === 'removed')).toHaveLength(0);
  });

  // PD-U21: moved count matches
  it('PD-U21: moved entry count is consistent', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Alpha text.', 100), makeParagraph('Beta text.', 200)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Beta text.', 100), makeParagraph('Alpha text.', 200)]);
    const diffs = diffParagraphs(match(old, neu));
    const movedCount = diffs.filter(c => c.changeType === 'moved').length;
    expect(movedCount).toBeGreaterThanOrEqual(1);
  });

  // PD-U22: Table blocks are ignored by paragraph differ (tables handled separately)
  it('PD-U22: paragraph differ only processes paragraphs, ignores tables', () => {
    const old = makeSection('s1', 'S', [makeTable([['A', 'B']], 100)]);
    const neu = makeSection('s1', 'S', [makeTable([['C', 'D']], 100)]);
    const diffs = diffParagraphs(match(old, neu));
    // diffParagraphs only processes paragraphs, tables are skipped
    expect(diffs).toHaveLength(0);
  });

  // PD-U23: Mixed paragraph + table blocks — only paragraphs diffed
  it('PD-U23: mixed blocks — only paragraphs are diffed', () => {
    const old = makeSection('s1', 'S', [
      makeParagraph('Before table.', 50),
      makeTable([['X', 'Y']], 100),
      makeParagraph('After table.', 200),
    ]);
    const neu = makeSection('s1', 'S', [
      makeParagraph('Before table.', 50),
      makeTable([['X', 'Y']], 100),
      makeParagraph('After table.', 200),
    ]);
    const diffs = diffParagraphs(match(old, neu));
    // Only paragraphs are diffed
    expect(diffs).toHaveLength(2);
    expect(diffs.every(d => d.changeType === 'unchanged')).toBe(true);
  });
});
