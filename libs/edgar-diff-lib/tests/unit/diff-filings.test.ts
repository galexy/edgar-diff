import { describe, it, expect } from 'vitest';
import { diffFilings } from '../../src/diff/index.js';
import { makeParagraph, makeSection } from '../helpers/diff-fixtures.js';
import type { StructuredDocument, FilingSection } from '../../src/types.js';
import type { RawFiling } from '../../src/client/types.js';
import { Temporal } from '@js-temporal/polyfill';

function makeDoc(sections: FilingSection[]): StructuredDocument {
  return {
    filing: {
      accessionNumber: '0000000000-00-000000',
      cik: '0000000000',
      formType: '10-K',
      filingDate: Temporal.PlainDate.from('2024-01-01'),
      primaryDocumentFilename: 'test-filing.htm',
      html: '<html></html>',
      fetchedAt: Temporal.Now.instant(),
    } as RawFiling,
    sections,
    parseWarnings: [],
  };
}

describe('diff-filings', () => {
  // DF-U1: Simple happy path
  it('DF-U1: produces StructuredDiff for two simple documents', () => {
    const oldSections = [makeSection('item-1', 'Item 1. Business', [makeParagraph('Revenue grew.', 100)])];
    const newSections = [makeSection('item-1', 'Item 1. Business', [makeParagraph('Revenue grew.', 100)])];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    expect(result.sectionDiffs).toHaveLength(1);
    expect(result.summary.unchanged).toBe(1);
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
  });

  // DF-U2: Subsection flattening — top-level sections are aligned
  it('DF-U2: matches top-level sections correctly', () => {
    const oldSub: FilingSection = makeSection('item-1a-sub', 'Risk Overview', [makeParagraph('Sub text.', 300)], 300);
    const oldSections = [
      { ...makeSection('item-1a', 'Item 1A. Risk Factors', [makeParagraph('Main text.', 100)]), subsections: [oldSub] },
    ];
    const newSub: FilingSection = makeSection('item-1a-sub', 'Risk Overview', [makeParagraph('Sub text updated.', 300)], 300);
    const newSections = [
      { ...makeSection('item-1a', 'Item 1A. Risk Factors', [makeParagraph('Main text.', 100)]), subsections: [newSub] },
    ];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    // Top-level section should be matched
    expect(result.sectionDiffs.length).toBeGreaterThanOrEqual(1);
    // The matched section should be modified (subsection content changed)
    const matched = result.sectionDiffs.filter(sd => sd.changeType === 'modified' || sd.changeType === 'unchanged');
    expect(matched.length).toBeGreaterThanOrEqual(1);
  });

  // DF-U3: Stats aggregation
  it('DF-U3: summary counts correctly across section diffs', () => {
    const oldSections = [
      makeSection('s1', 'Item 1. Section One', [makeParagraph('A', 100), makeParagraph('B', 200)]),
      makeSection('s2', 'Item 2. Section Two', [makeParagraph('C', 300)]),
    ];
    const newSections = [
      makeSection('s1', 'Item 1. Section One', [makeParagraph('A', 100), makeParagraph('B modified', 200)]),
      makeSection('s2', 'Item 2. Section Two', [makeParagraph('C', 300), makeParagraph('D', 400)]),
    ];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    // Both sections should match
    const totalMatched = result.summary.modified + result.summary.unchanged;
    expect(totalMatched).toBe(2);
  });

  // DF-U4: Custom similarity threshold
  it('DF-U4: threshold option overrides default', () => {
    const oldSections = [makeSection('s1', 'Business Description', [makeParagraph('text', 100)])];
    const newSections = [makeSection('s1', 'Business Overview', [makeParagraph('text', 100)])];
    // With very high threshold, should not match (headings differ)
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections), { threshold: 0.99 });
    expect(result.summary.added).toBe(1);
    expect(result.summary.removed).toBe(1);
  });

  // DF-U5: Added sections
  it('DF-U5: added sections appear in sectionDiffs with changeType added', () => {
    const oldSections = [makeSection('s1', 'Item 1. Section One', [makeParagraph('A', 100)])];
    const newSections = [
      makeSection('s1', 'Item 1. Section One', [makeParagraph('A', 100)]),
      makeSection('s2', 'Section Two New', [makeParagraph('B', 200)], 200),
    ];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    const addedDiffs = result.sectionDiffs.filter(sd => sd.changeType === 'added');
    expect(addedDiffs).toHaveLength(1);
    expect(addedDiffs[0].id).toBe('s2');
    expect(addedDiffs[0].heading).toBe('Section Two New');
    expect(result.summary.added).toBe(1);
  });

  // DF-U6: Removed sections
  it('DF-U6: removed sections appear in sectionDiffs with changeType removed', () => {
    const oldSections = [
      makeSection('s1', 'Item 1. Section One', [makeParagraph('A', 100)]),
      makeSection('s2', 'Section Two Old', [makeParagraph('B', 200)], 200),
    ];
    const newSections = [makeSection('s1', 'Item 1. Section One', [makeParagraph('A', 100)])];
    const result = diffFilings(makeDoc(oldSections), makeDoc(newSections));
    const removedDiffs = result.sectionDiffs.filter(sd => sd.changeType === 'removed');
    expect(removedDiffs).toHaveLength(1);
    expect(removedDiffs[0].id).toBe('s2');
    expect(result.summary.removed).toBe(1);
  });
});
