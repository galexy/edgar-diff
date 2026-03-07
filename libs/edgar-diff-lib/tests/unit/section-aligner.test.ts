import { describe, it, expect } from 'vitest';
import { alignSections } from '../../src/diff/section-aligner.js';
import { makeSection, makeParagraph } from '../helpers/diff-fixtures.js';
import type { FilingSection } from '../../src/types.js';

function section(id: string, heading: string, start = 0): FilingSection {
  return makeSection(id, heading, [makeParagraph('text', start + 50)], start);
}

describe('section-aligner', () => {
  // SA-U1: Identical section IDs produce 1:1 alignment
  it('SA-U1: matches sections with identical headings', () => {
    const old = [section('item-1', 'Item 1. Business', 0), section('item-1a', 'Item 1A. Risk Factors', 200)];
    const neu = [section('item-1', 'Item 1. Business', 0), section('item-1a', 'Item 1A. Risk Factors', 200)];
    const result = alignSections(old, neu);
    expect(result.matched).toHaveLength(2);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.matched[0].similarity).toBe(1);
  });

  // SA-U2: Similar headings (JW >= 0.75) matched
  it('SA-U2: matches sections with similar headings above threshold', () => {
    const old = [section('item-1a', 'Item 1A. Risk Factors', 0)];
    const neu = [section('item-1a', 'Item 1A - Risk Factors', 0)];
    const result = alignSections(old, neu);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].similarity).toBeGreaterThanOrEqual(0.75);
  });

  // SA-U3: Sections below threshold remain unmatched
  it('SA-U3: does not match sections below threshold', () => {
    const old = [section('item-1', 'Item 1. Business', 0)];
    const neu = [section('item-7', 'Item 7. Financial Statements', 0)];
    const result = alignSections(old, neu);
    expect(result.matched).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.added).toHaveLength(1);
  });

  // SA-U4: Unmatched base sections are removed
  it('SA-U4: unmatched base sections appear as removed', () => {
    const old = [section('item-1', 'Item 1. Business', 0), section('item-2', 'Item 2. Properties', 200)];
    const neu = [section('item-1', 'Item 1. Business', 0)];
    const result = alignSections(old, neu);
    expect(result.matched).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].id).toBe('item-2');
  });

  // SA-U5: Unmatched target sections are added
  it('SA-U5: unmatched target sections appear as added', () => {
    const old = [section('item-1', 'Item 1. Business', 0)];
    const neu = [section('item-1', 'Item 1. Business', 0), section('item-3', 'Item 3. Legal Proceedings', 200)];
    const result = alignSections(old, neu);
    expect(result.matched).toHaveLength(1);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].id).toBe('item-3');
  });

  // SA-U6: Empty base returns all target as added
  it('SA-U6: empty base returns all target as added', () => {
    const neu = [section('item-1', 'Item 1. Business', 0)];
    const result = alignSections([], neu);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
  });

  // SA-U7: Empty target returns all base as removed
  it('SA-U7: empty target returns all base as removed', () => {
    const old = [section('item-1', 'Item 1. Business', 0)];
    const result = alignSections(old, []);
    expect(result.matched).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
    expect(result.added).toHaveLength(0);
  });

  // SA-U8: Both empty returns empty
  it('SA-U8: both empty returns empty alignment', () => {
    const result = alignSections([], []);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  // SA-U9: Single section in each, matching
  it('SA-U9: single section match', () => {
    const old = [section('item-1', 'Risk Factors', 0)];
    const neu = [section('item-1', 'Risk Factors', 0)];
    const result = alignSections(old, neu);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].oldSection).toBe(old[0]);
    expect(result.matched[0].newSection).toBe(neu[0]);
  });

  // SA-U10: Deterministic
  it('SA-U10: alignment is deterministic', () => {
    const old = [section('a', 'Alpha Section', 0), section('b', 'Beta Section', 200)];
    const neu = [section('b', 'Beta Section', 0), section('a', 'Alpha Section', 200)];
    const r1 = alignSections(old, neu);
    const r2 = alignSections(old, neu);
    expect(r1.matched.map(m => m.oldSection.id)).toEqual(r2.matched.map(m => m.oldSection.id));
    expect(r1.matched.map(m => m.newSection.id)).toEqual(r2.matched.map(m => m.newSection.id));
  });

  // SA-U11: Case-insensitive matching
  it('SA-U11: case-insensitive heading matching', () => {
    const old = [section('item-1a', 'RISK FACTORS', 0)];
    const neu = [section('item-1a', 'Risk Factors', 0)];
    const result = alignSections(old, neu);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].similarity).toBe(1);
  });

  // SA-U12: Minor wording changes still match
  it('SA-U12: headings with minor wording changes match', () => {
    const old = [section('item-1a', 'Item 1A. Risk Factors', 0)];
    const neu = [section('item-1a', 'Item 1A - Risk Factors', 0)];
    const result = alignSections(old, neu);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].similarity).toBeGreaterThanOrEqual(0.75);
  });

  // Additional: SectionMatch has oldIndex and newIndex
  it('matched pairs have oldIndex and newIndex', () => {
    const old = [section('a', 'Alpha', 100), section('b', 'Beta', 200)];
    const neu = [section('a', 'Alpha', 200), section('b', 'Beta', 100)];
    const result = alignSections(old, neu);
    for (const m of result.matched) {
      expect(m.oldIndex).toBeGreaterThanOrEqual(0);
      expect(m.newIndex).toBeGreaterThanOrEqual(0);
    }
  });

  // Additional: AlignmentOptions as object
  it('accepts AlignmentOptions object with threshold', () => {
    const old = [section('a', 'Alpha Section', 0)];
    const neu = [section('a', 'Alpha Section Modified', 0)];
    const result = alignSections(old, neu, { threshold: 0.5 });
    expect(result.matched).toHaveLength(1);
  });
});
