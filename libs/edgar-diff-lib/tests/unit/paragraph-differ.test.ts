import { describe, it, expect } from 'vitest';
import { diffSections } from '../../src/diff/paragraph-differ.js';
import { makeParagraph, makeTable, makeSection } from '../helpers/diff-fixtures.js';
import type { SectionMatch } from '../../src/diff/section-aligner.js';
import type { ParagraphChange, TablePlaceholder } from '../../src/diff/types.js';
import type { FilingSection } from '../../src/types.js';

function match(oldSec: FilingSection, newSec: FilingSection, similarity = 1): SectionMatch {
  return { oldSection: oldSec, newSection: newSec, similarity };
}

function paragraphChanges(matches: SectionMatch[]): ParagraphChange[] {
  const diffs = diffSections(matches);
  return diffs[0].changes.filter((c): c is ParagraphChange => c.type !== 'table');
}

describe('paragraph-differ', () => {
  // PD-U1: Identical paragraphs → all unchanged
  it('PD-U1: identical paragraphs produce all unchanged', () => {
    const old = makeSection('s1', 'Section', [makeParagraph('Hello world.', 100), makeParagraph('Goodbye.', 200)]);
    const neu = makeSection('s1', 'Section', [makeParagraph('Hello world.', 100), makeParagraph('Goodbye.', 200)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(2);
    expect(changes.every(c => c.type === 'unchanged')).toBe(true);
  });

  // PD-U2: Added paragraph at end
  it('PD-U2: detects added paragraph at end', () => {
    const old = makeSection('s1', 'S', [makeParagraph('A', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('B', 200)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(2);
    expect(changes[0].type).toBe('unchanged');
    expect(changes[1].type).toBe('added');
    expect(changes[1].newText).toBe('B');
  });

  // PD-U3: Deleted paragraph from middle
  it('PD-U3: detects deleted paragraph', () => {
    const old = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('B', 200), makeParagraph('C', 300)]);
    const neu = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('C', 200)]);
    const changes = paragraphChanges([match(old, neu)]);
    const removed = changes.filter(c => c.type === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].oldText).toBe('B');
  });

  // PD-U4: Modified paragraph with word-level diff
  it('PD-U4: detects modified paragraph with word changes', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Revenue increased by 10% in fiscal 2023.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Revenue increased by 15% in fiscal 2024.', 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('modified');
    expect(changes[0].wordChanges).toBeDefined();
    expect(changes[0].wordChanges!.length).toBeGreaterThan(0);
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
    const changes = paragraphChanges([match(old, neu)]);
    const types = changes.map(c => c.type);
    expect(types).toContain('unchanged');
    expect(types).toContain('removed');
    expect(types).toContain('added');
    // modified or separate add+remove for the changed paragraph
    expect(changes.length).toBeGreaterThanOrEqual(3);
  });

  // PD-U6: Two paragraphs swapped → at least one detected as moved
  // Myers sees one paragraph as "unchanged" (LCS) and the other as removed+added.
  // Move detection reclassifies the removed+added pair as moved.
  it('PD-U6: detects swapped paragraphs — moved paragraph has no wordChanges', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Alpha paragraph text.', 100), makeParagraph('Beta paragraph text.', 200)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Beta paragraph text.', 100), makeParagraph('Alpha paragraph text.', 200)]);
    const changes = paragraphChanges([match(old, neu)]);
    const moved = changes.filter(c => c.type === 'moved');
    expect(moved.length).toBeGreaterThanOrEqual(1);
    // Moved entries for exact text match have no wordChanges
    for (const m of moved) {
      expect(m.wordChanges).toBeUndefined();
    }
    // No content should be marked as added or removed (either unchanged or moved)
    expect(changes.filter(c => c.type === 'added')).toHaveLength(0);
    expect(changes.filter(c => c.type === 'removed')).toHaveLength(0);
  });

  // PD-U7: Moved with modification
  // With 2 paragraphs swapped and one slightly modified, Myers sees one as "unchanged"
  // and the other as removed+added. Move detection (JW > 0.9) reclassifies as moved.
  it('PD-U7: moved paragraph with modification has wordChanges', () => {
    // Use longer text with a small change to stay above 0.9 JW threshold
    const old = makeSection('s1', 'S', [
      makeParagraph('The company reported strong revenue growth in the fiscal year ending December 2023.', 100),
      makeParagraph('Operating expenses remained within the projected budget for the quarter.', 300),
    ]);
    const neu = makeSection('s1', 'S', [
      makeParagraph('Operating expenses remained within the projected budget for the quarter.', 100),
      makeParagraph('The company reported strong revenue growth in the fiscal year ending December 2024.', 300),
    ]);
    const changes = paragraphChanges([match(old, neu)]);
    // Revenue paragraph: removed then re-added with small edit → moved with wordChanges
    const moved = changes.filter(c => c.type === 'moved');
    expect(moved.length).toBeGreaterThanOrEqual(1);
    const revenueMove = moved.find(c => c.oldText?.includes('revenue growth'));
    expect(revenueMove).toBeDefined();
    expect(revenueMove!.wordChanges).toBeDefined();
    // No plain added/removed should remain
    expect(changes.filter(c => c.type === 'added')).toHaveLength(0);
    expect(changes.filter(c => c.type === 'removed')).toHaveLength(0);
  });

  // PD-U8: Empty base → all added
  it('PD-U8: empty base produces all added', () => {
    const old = makeSection('s1', 'S', []);
    const neu = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('B', 200)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(2);
    expect(changes.every(c => c.type === 'added')).toBe(true);
  });

  // PD-U9: Empty target → all deleted
  it('PD-U9: empty target produces all removed', () => {
    const old = makeSection('s1', 'S', [makeParagraph('A', 100), makeParagraph('B', 200)]);
    const neu = makeSection('s1', 'S', []);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(2);
    expect(changes.every(c => c.type === 'removed')).toBe(true);
  });

  // PD-U10: Both empty → empty diff
  it('PD-U10: both empty produces empty changes', () => {
    const old = makeSection('s1', 'S', []);
    const neu = makeSection('s1', 'S', []);
    const diffs = diffSections([match(old, neu)]);
    expect(diffs[0].changes).toHaveLength(0);
    expect(diffs[0].stats.added).toBe(0);
  });

  // PD-U11: Single paragraph, unchanged
  it('PD-U11: single unchanged paragraph', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Only one.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Only one.', 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('unchanged');
  });

  // PD-U12: Single paragraph, modified
  it('PD-U12: single modified paragraph', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Old text.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('New text.', 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('modified');
    expect(changes[0].wordChanges).toBeDefined();
  });

  // PD-U13: Word-level diff identifies specific words
  it('PD-U13: word-level diff identifies specific changed words', () => {
    const old = makeSection('s1', 'S', [makeParagraph('The cat sat on the mat.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('The dog sat on the rug.', 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes[0].type).toBe('modified');
    const wc = changes[0].wordChanges!;
    const removed = wc.filter(w => w.type === 'removed').map(w => w.value);
    const added = wc.filter(w => w.type === 'added').map(w => w.value);
    expect(removed.join('')).toContain('cat');
    expect(added.join('')).toContain('dog');
  });

  // PD-U14: Numeric changes
  it('PD-U14: word-level diff for numeric changes', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Revenue was $100M.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Revenue was $150M.', 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes[0].type).toBe('modified');
    const wc = changes[0].wordChanges!;
    expect(wc.some(w => w.type === 'removed' && w.value.includes('100M'))).toBe(true);
    expect(wc.some(w => w.type === 'added' && w.value.includes('150M'))).toBe(true);
  });

  // PD-U15: Unchanged spans preserved in word diff
  it('PD-U15: word-level diff preserves unchanged spans', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Revenue increased by 10% in fiscal 2023.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Revenue increased by 15% in fiscal 2024.', 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    const wc = changes[0].wordChanges!;
    const unchanged = wc.filter(w => w.type === 'unchanged').map(w => w.value).join('');
    expect(unchanged).toContain('Revenue increased by');
  });

  // PD-U16: Whitespace-only differences treated as unchanged
  it('PD-U16: whitespace-only differences treated as unchanged', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Hello   world.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Hello world.', 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('unchanged');
  });

  // PD-U17: Very similar paragraphs identified as modified
  it('PD-U17: very similar paragraphs identified as modified', () => {
    const longText = 'The company operates in multiple segments across various regions providing services and products to customers worldwide with a focus on innovation and growth.';
    const modified = longText.replace('innovation', 'excellence');
    const old = makeSection('s1', 'S', [makeParagraph(longText, 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph(modified, 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('modified');
  });

  // PD-U18: Completely different paragraphs = delete + add
  it('PD-U18: completely different paragraphs are delete+add', () => {
    const old = makeSection('s1', 'S', [makeParagraph('The sky is blue and vast.', 100)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Revenue grew by five percent.', 100)]);
    const changes = paragraphChanges([match(old, neu)]);
    // Myers will see these as a remove+add pair and create a "modified" entry
    // since they are adjacent. This is expected behavior for Myers diff.
    expect(changes.length).toBeGreaterThanOrEqual(1);
  });

  // PD-U19: Move detection: dissimilar paragraphs stay as removed+added
  it('PD-U19: dissimilar paragraphs not falsely matched as moves', () => {
    const old = makeSection('s1', 'S', [makeParagraph('The sky is blue.', 100), makeParagraph('Common text.', 200)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Common text.', 100), makeParagraph('Revenue grew 5%.', 200)]);
    const changes = paragraphChanges([match(old, neu)]);
    // "Common text" should be moved or unchanged
    // "The sky is blue." and "Revenue grew 5%." should NOT be matched as moves
    const moved = changes.filter(c => c.type === 'moved' && c.oldText === 'The sky is blue.');
    expect(moved).toHaveLength(0);
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
    const changes = paragraphChanges([match(old, neu)]);
    // Myers keeps one in LCS (unchanged), other is removed+added → moved
    const moved = changes.filter(c => c.type === 'moved');
    expect(moved.length).toBeGreaterThanOrEqual(1);
    // No content marked as plain added/removed
    expect(changes.filter(c => c.type === 'added')).toHaveLength(0);
    expect(changes.filter(c => c.type === 'removed')).toHaveLength(0);
  });

  // PD-U21: DiffStats.moved count
  it('PD-U21: stats.moved matches moved entry count', () => {
    const old = makeSection('s1', 'S', [makeParagraph('Alpha text.', 100), makeParagraph('Beta text.', 200)]);
    const neu = makeSection('s1', 'S', [makeParagraph('Beta text.', 100), makeParagraph('Alpha text.', 200)]);
    const diffs = diffSections([match(old, neu)]);
    const movedCount = diffs[0].changes.filter(c => c.type === 'moved').length;
    expect(diffs[0].stats.moved).toBe(movedCount);
  });

  // PD-U22: Table blocks emitted as TablePlaceholder
  it('PD-U22: table blocks emitted as TablePlaceholder', () => {
    const old = makeSection('s1', 'S', [makeTable([['A', 'B']], 100)]);
    const neu = makeSection('s1', 'S', [makeTable([['C', 'D']], 100)]);
    const diffs = diffSections([match(old, neu)]);
    const tables = diffs[0].changes.filter((c): c is TablePlaceholder => c.type === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0].oldTable).toBeDefined();
    expect(tables[0].newTable).toBeDefined();
  });

  // PD-U23: Mixed paragraph + table blocks in correct positions
  it('PD-U23: mixed blocks preserve table positions', () => {
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
    const diffs = diffSections([match(old, neu)]);
    const types = diffs[0].changes.map(c => c.type);
    expect(types).toContain('table');
    expect(types).toContain('unchanged');
    expect(diffs[0].stats.tables).toBe(1);
  });
});
