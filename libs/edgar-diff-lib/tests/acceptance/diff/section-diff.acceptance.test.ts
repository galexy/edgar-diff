import { test, describe, expect } from 'vitest';
import { test as fcTest } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  alignSections,
  serializeSectionContent,
  classifySectionDiff,
  isReordered,
} from '../../../src/diff/section-aligner.js';
import type { SectionMatch } from '../../../src/diff/section-aligner.js';
import type { ChangeType } from '../../../src/diff/types.js';
import type { FilingSection } from '../../../src/types.js';
import {
  arbUniqueHeadings,
  arbUniqueHeading,
  arbContentBlocks,
  makeParagraph,
  makeTable,
} from '../../helpers/diff-arbitraries.js';
import { makeFilingSection } from '../../helpers/diff-helpers.js';

const PROP_RUNS = { numRuns: 100 };

function arbSectionWithHeading(heading: string): fc.Arbitrary<FilingSection> {
  return arbContentBlocks(undefined).map((blocks) =>
    makeFilingSection(`id-${heading.replace(/\W/g, '-').toLowerCase()}`, heading, { blocks }),
  );
}

function arbSectionsFromHeadings(headings: string[]): fc.Arbitrary<FilingSection[]> {
  if (headings.length === 0) return fc.constant([]);
  return fc.tuple(...headings.map((h) => arbSectionWithHeading(h)))
    .map((sections) => sections as FilingSection[]);
}

describe('Acceptance: Section-Level Diff (Property-Based)', () => {
  describe('AC-1: Identical headings never produce added or removed sections', () => {
    fcTest.prop(
      [arbUniqueHeadings(5).chain((headings) =>
        fc.tuple(
          arbSectionsFromHeadings(headings),
          arbSectionsFromHeadings(headings),
        ).map(([oldSections, newSections]) => ({ headings, oldSections, newSections })),
      )],
      PROP_RUNS,
    )('every sectionDiff is unchanged or modified, never added/removed', ({ headings, oldSections, newSections }) => {
      const result = alignSections(oldSections, newSections);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.matched).toHaveLength(headings.length);

      for (const match of result.matched) {
        const ct = classifySectionDiff(match, result.matched);
        expect(['unchanged', 'modified']).toContain(ct);
      }
    });
  });

  describe('AC-2: Heading similarity above threshold always produces a match', () => {
    fcTest.prop(
      [
        arbUniqueHeadings(1).map(h => h[0]),
        fc.constantFrom(' Amendment', ' Revised', ' Updated', ' (Cont.)'),
        arbContentBlocks(),
        arbContentBlocks(),
      ],
      PROP_RUNS,
    )('mutated heading (suffix appended) still matches', (heading, suffix, oldBlocks, newBlocks) => {
      const oldSection = makeFilingSection('s1', heading, { blocks: oldBlocks });
      const newSection = makeFilingSection('s1', heading + suffix, { blocks: newBlocks });

      const result = alignSections([oldSection], [newSection]);
      expect(result.matched).toHaveLength(1);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });
  });

  describe('AC-3: Permuted sections with unchanged content are "reordered"', () => {
    fcTest.prop(
      [arbUniqueHeadings(4).chain((headings) =>
        arbSectionsFromHeadings(headings).chain((sections) =>
          fc.shuffledSubarray(sections, { minLength: sections.length, maxLength: sections.length })
            .map((permuted) => ({ original: sections, permuted })),
        ),
      )],
      PROP_RUNS,
    )('all sections matched; moved ones are reordered, stable ones unchanged', ({ original, permuted }) => {
      const result = alignSections(original, permuted);
      expect(result.matched).toHaveLength(original.length);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);

      let reorderedCount = 0;
      let unchangedCount = 0;
      for (const match of result.matched) {
        const ct = classifySectionDiff(match, result.matched);
        if (ct === 'reordered') reorderedCount++;
        else if (ct === 'unchanged') unchangedCount++;
        else {
          expect(ct).toMatch(/^(reordered|unchanged)$/);
        }
      }
      expect(reorderedCount + unchangedCount).toBe(original.length);
    });
  });

  describe('AC-3b: Content change takes precedence over reorder', () => {
    fcTest.prop(
      [arbUniqueHeadings(4).chain((headings) =>
        arbSectionsFromHeadings(headings).chain((sections) =>
          fc.tuple(
            fc.shuffledSubarray(sections, { minLength: sections.length, maxLength: sections.length }),
            fc.nat({ max: sections.length - 1 }),
            fc.lorem({ maxCount: 3, mode: 'sentences' }),
          ).map(([permuted, modifyIdx, newText]) => ({
            original: sections,
            permuted: permuted.map((s, i) =>
              i === modifyIdx
                ? makeFilingSection(s.id, s.heading, {
                    blocks: [makeParagraph(newText + ' MODIFIED')],
                  })
                : s,
            ),
          })),
        ),
      )],
      PROP_RUNS,
    )('sections with changed content are modified regardless of position', ({ original, permuted }) => {
      const result = alignSections(original, permuted);
      expect(result.matched).toHaveLength(original.length);

      for (const match of result.matched) {
        const ct = classifySectionDiff(match, result.matched);
        const oldContent = serializeSectionContent(match.oldSection);
        const newContent = serializeSectionContent(match.newSection);

        if (oldContent !== newContent) {
          expect(ct).toBe('modified');
        } else {
          expect(['unchanged', 'reordered']).toContain(ct);
        }
      }
    });
  });

  describe('AC-4: Extra sections in new document are "added"', () => {
    fcTest.prop(
      [arbUniqueHeadings(3).chain((headings) =>
        fc.tuple(
          arbSectionsFromHeadings(headings),
          fc.array(arbUniqueHeading().chain((h) => arbSectionWithHeading(h)), {
            minLength: 1,
            maxLength: 3,
          }),
        ).map(([common, extras]) => ({ headings, common, extras })),
      )],
      PROP_RUNS,
    )('K extra sections with unique headings are detected as added', ({ headings, common, extras }) => {
      const oldSections = [...common];
      const newSections = [...common, ...extras];

      const result = alignSections(oldSections, newSections);
      expect(result.added).toHaveLength(extras.length);
      expect(result.matched).toHaveLength(headings.length);
    });
  });

  describe('AC-5: Missing sections in new document are "removed"', () => {
    fcTest.prop(
      [arbUniqueHeadings(5).chain((headings) =>
        arbSectionsFromHeadings(headings).chain((sections) =>
          fc.nat({ max: Math.min(1, sections.length - 2) }).map((removeCount) => {
            const k = removeCount + 1;
            return {
              allSections: sections,
              newSections: sections.slice(0, sections.length - k),
              removedCount: k,
            };
          }),
        ),
      )],
      PROP_RUNS,
    )('K removed sections are detected', ({ allSections, newSections, removedCount }) => {
      const result = alignSections(allSections, newSections);
      expect(result.removed).toHaveLength(removedCount);
      expect(result.matched).toHaveLength(allSections.length - removedCount);
    });
  });

  describe('AC-6: Self-diff produces all "unchanged"', () => {
    fcTest.prop(
      [arbUniqueHeadings(5).chain((headings) => arbSectionsFromHeadings(headings))],
      PROP_RUNS,
    )('diffing a document against itself yields all unchanged', (sections) => {
      const result = alignSections(sections, sections);
      expect(result.matched).toHaveLength(sections.length);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);

      for (const match of result.matched) {
        const ct = classifySectionDiff(match, result.matched);
        expect(ct).toBe('unchanged');
      }
    });
  });

  describe('AC-7: Content modifications produce "modified" classification', () => {
    test('AC-7a: paragraph text change', () => {
      const oldSection = makeFilingSection('s1', 'Item 1. Business', {
        blocks: [makeParagraph('Original text content.')],
      });
      const newSection = makeFilingSection('s1', 'Item 1. Business', {
        blocks: [makeParagraph('Modified text content with changes.')],
      });

      const match: SectionMatch = {
        oldIndex: 0, newIndex: 0,
        oldSection, newSection,
        similarity: 1.0,
      };
      expect(classifySectionDiff(match, [match])).toBe('modified');
    });

    test('AC-7b: table content change', () => {
      const oldSection = makeFilingSection('s1', 'Item 8. Financial Statements', {
        blocks: [makeTable([['Revenue', '100'], ['Profit', '20']])],
      });
      const newSection = makeFilingSection('s1', 'Item 8. Financial Statements', {
        blocks: [makeTable([['Revenue', '150'], ['Profit', '30']])],
      });

      const match: SectionMatch = {
        oldIndex: 0, newIndex: 0,
        oldSection, newSection,
        similarity: 1.0,
      };
      expect(classifySectionDiff(match, [match])).toBe('modified');
    });

    test('AC-7c: block addition', () => {
      const oldSection = makeFilingSection('s1', 'Item 1. Business', {
        blocks: [makeParagraph('Existing paragraph.')],
      });
      const newSection = makeFilingSection('s1', 'Item 1. Business', {
        blocks: [makeParagraph('Existing paragraph.'), makeParagraph('New paragraph added.')],
      });

      const match: SectionMatch = {
        oldIndex: 0, newIndex: 0,
        oldSection, newSection,
        similarity: 1.0,
      };
      expect(classifySectionDiff(match, [match])).toBe('modified');
    });

    test('AC-7d: block removal', () => {
      const oldSection = makeFilingSection('s1', 'Item 1. Business', {
        blocks: [makeParagraph('First paragraph.'), makeParagraph('Second paragraph.')],
      });
      const newSection = makeFilingSection('s1', 'Item 1. Business', {
        blocks: [makeParagraph('First paragraph.')],
      });

      const match: SectionMatch = {
        oldIndex: 0, newIndex: 0,
        oldSection, newSection,
        similarity: 1.0,
      };
      expect(classifySectionDiff(match, [match])).toBe('modified');
    });

    test('AC-7e: mixed block type changes', () => {
      const oldSection = makeFilingSection('s1', 'Item 7. MD&A', {
        blocks: [
          makeParagraph('Discussion text.'),
          makeTable([['Metric', 'Value'], ['Revenue', '100']]),
        ],
      });
      const newSection = makeFilingSection('s1', 'Item 7. MD&A', {
        blocks: [
          makeParagraph('Updated discussion text with more detail.'),
          makeTable([['Metric', 'Value'], ['Revenue', '200']]),
          makeParagraph('Additional analysis.'),
        ],
      });

      const match: SectionMatch = {
        oldIndex: 0, newIndex: 0,
        oldSection, newSection,
        similarity: 1.0,
      };
      expect(classifySectionDiff(match, [match])).toBe('modified');
    });

    test('AC-7f: block type replacement', () => {
      const oldSection = makeFilingSection('s1', 'Item 2. Properties', {
        blocks: [makeParagraph('Property listing as text.')],
      });
      const newSection = makeFilingSection('s1', 'Item 2. Properties', {
        blocks: [makeTable([['Location', 'Type'], ['NYC', 'Office']])],
      });

      const match: SectionMatch = {
        oldIndex: 0, newIndex: 0,
        oldSection, newSection,
        similarity: 1.0,
      };
      expect(classifySectionDiff(match, [match])).toBe('modified');
    });

    fcTest.prop(
      [arbUniqueHeadings(4).chain((headings) =>
        arbSectionsFromHeadings(headings).chain((sections) =>
          fc.subarray(
            sections.map((_, i) => i),
            { minLength: 1, maxLength: 2 },
          ).map((modifyIndices) => ({
            sections,
            modifyIndices: new Set(modifyIndices),
          })),
        ),
      )],
      PROP_RUNS,
    )('AC-7 aggregate: exactly K modified sections, N-K unchanged', ({ sections, modifyIndices }) => {
      const newSections = sections.map((s, i) =>
        modifyIndices.has(i)
          ? makeFilingSection(s.id, s.heading, {
              blocks: [makeParagraph(`Modified content for section ${i}`)],
            })
          : s,
      );

      const result = alignSections(sections, newSections);
      expect(result.matched).toHaveLength(sections.length);

      let modifiedCount = 0;
      let unchangedCount = 0;
      for (const match of result.matched) {
        const ct = classifySectionDiff(match, result.matched);
        if (ct === 'modified') modifiedCount++;
        else if (ct === 'unchanged') unchangedCount++;
      }
      expect(modifiedCount).toBe(modifyIndices.size);
      expect(unchangedCount).toBe(sections.length - modifyIndices.size);
    });
  });

  describe('AC-8: Summary counts are consistent with sectionDiffs', () => {
    fcTest.prop(
      [arbUniqueHeadings(4).chain((headings) =>
        fc.tuple(
          arbSectionsFromHeadings(headings),
          arbSectionsFromHeadings(headings),
        ).map(([oldSections, newSections]) => ({ oldSections, newSections })),
      )],
      PROP_RUNS,
    )('counts match actual changeTypes in alignment results', ({ oldSections, newSections }) => {
      const result = alignSections(oldSections, newSections);

      const counts = {
        added: result.added.length,
        removed: result.removed.length,
        modified: 0,
        unchanged: 0,
        reordered: 0,
      };

      for (const match of result.matched) {
        const ct = classifySectionDiff(match, result.matched);
        counts[ct as keyof typeof counts]++;
      }

      const total = counts.added + counts.removed + counts.modified +
        counts.unchanged + counts.reordered;
      expect(total).toBe(
        result.matched.length + result.added.length + result.removed.length,
      );
    });
  });
});
