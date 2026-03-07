import { describe, it, expect } from 'vitest';
import { diffFilings } from '../../src/diff/diff-filings.js';
import { makeParagraph, makeSection } from '../helpers/diff-fixtures.js';
import type { StructuredDocument, FilingSection } from '../../src/types.js';
import type { RawFiling } from '../../src/client/types.js';
import { Temporal } from '@js-temporal/polyfill';

function makeDoc(sections: FilingSection[]): StructuredDocument {
  return {
    filing: {
      accessionNumber: '0000000000-00-000000',
      cik: '0000000000',
      companyName: 'Test Corp',
      formType: '10-K',
      filingDate: Temporal.PlainDate.from('2024-01-01'),
      documentUrl: 'https://example.com',
      html: '<html></html>',
    } as RawFiling,
    sections,
    parseWarnings: [],
  };
}

describe('diff-filings', () => {
  // DF-U1: Simple happy path
  it('DF-U1: produces FilingDiffResult for two simple documents', () => {
    const oldSections = [makeSection('item-1', 'Item 1. Business', [makeParagraph('Revenue grew.', 100)])];
    const newSections = [makeSection('item-1', 'Item 1. Business', [makeParagraph('Revenue grew.', 100)])];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    expect(result.sectionDiffs).toHaveLength(1);
    expect(result.addedSections).toHaveLength(0);
    expect(result.removedSections).toHaveLength(0);
    expect(result.totalStats.sectionsMatched).toBe(1);
    expect(result.totalStats.totalUnchanged).toBe(1);
  });

  // DF-U2: Subsection flattening
  it('DF-U2: flattens nested subsections for alignment', () => {
    const oldSub: FilingSection = makeSection('item-1a-sub', 'Risk Overview', [makeParagraph('Sub text.', 300)], 300);
    const oldSections = [
      { ...makeSection('item-1a', 'Item 1A. Risk Factors', [makeParagraph('Main text.', 100)]), subsections: [oldSub] },
    ];
    const newSub: FilingSection = makeSection('item-1a-sub', 'Risk Overview', [makeParagraph('Sub text updated.', 300)], 300);
    const newSections = [
      { ...makeSection('item-1a', 'Item 1A. Risk Factors', [makeParagraph('Main text.', 100)]), subsections: [newSub] },
    ];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    // Both parent and subsection should be matched
    expect(result.totalStats.sectionsMatched).toBe(2);
  });

  // DF-U3: Stats aggregation
  it('DF-U3: TotalDiffStats sums correctly across section diffs', () => {
    const oldSections = [
      makeSection('s1', 'Section One', [makeParagraph('A', 100), makeParagraph('B', 200)]),
      makeSection('s2', 'Section Two', [makeParagraph('C', 300)]),
    ];
    const newSections = [
      makeSection('s1', 'Section One', [makeParagraph('A', 100), makeParagraph('B modified', 200)]),
      makeSection('s2', 'Section Two', [makeParagraph('C', 300), makeParagraph('D', 400)]),
    ];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    expect(result.totalStats.sectionsMatched).toBe(2);
    // s1: 1 unchanged + 1 modified; s2: 1 unchanged + 1 added
    expect(result.totalStats.totalUnchanged).toBe(2);
    expect(result.totalStats.totalAdded + result.totalStats.totalModified).toBeGreaterThanOrEqual(1);
  });

  // DF-U4: Custom similarity threshold
  it('DF-U4: similarityThreshold overrides default', () => {
    const oldSections = [makeSection('s1', 'Item 1. Business Description', [makeParagraph('text', 100)])];
    const newSections = [makeSection('s1', 'Item 1 - Business', [makeParagraph('text', 100)])];
    // With very high threshold, should not match
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections), { similarityThreshold: 0.99 });
    expect(result.sectionDiffs).toHaveLength(0);
    expect(result.addedSections).toHaveLength(1);
    expect(result.removedSections).toHaveLength(1);
  });

  // DF-U5: Added sections
  it('DF-U5: added sections appear in addedSections', () => {
    const oldSections = [makeSection('s1', 'Section One', [makeParagraph('A', 100)])];
    const newSections = [
      makeSection('s1', 'Section One', [makeParagraph('A', 100)]),
      makeSection('s2', 'Section Two New', [makeParagraph('B', 200)], 200),
    ];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    expect(result.addedSections).toHaveLength(1);
    expect(result.addedSections[0].sectionId).toBe('s2');
    expect(result.addedSections[0].heading).toBe('Section Two New');
    expect(result.totalStats.sectionsAdded).toBe(1);
  });

  // DF-U6: Removed sections
  it('DF-U6: removed sections appear in removedSections', () => {
    const oldSections = [
      makeSection('s1', 'Section One', [makeParagraph('A', 100)]),
      makeSection('s2', 'Section Two Old', [makeParagraph('B', 200)], 200),
    ];
    const newSections = [makeSection('s1', 'Section One', [makeParagraph('A', 100)])];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    expect(result.removedSections).toHaveLength(1);
    expect(result.removedSections[0].sectionId).toBe('s2');
    expect(result.totalStats.sectionsRemoved).toBe(1);
  });
});
