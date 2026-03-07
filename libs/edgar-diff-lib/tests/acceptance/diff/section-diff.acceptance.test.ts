import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  alignSections,
  serializeSectionContent,
  classifySectionDiff,
  isReordered,
} from '../../../src/diff/section-aligner.js';
import type { SectionMatch } from '../../../src/diff/section-aligner.js';
import type { ChangeType } from '../../../src/diff/types.js';
import type { FilingSection, ContentBlock } from '../../../src/types.js';
import {
  arbHeading,
  arbUniqueHeading,
  arbContentBlocks,
  arbFilingSectionWithHeading,
  makeSection,
  makeParagraph,
  makeTable,
  makeDoc,
} from '../../helpers/diff-arbitraries.js';
import { makeFilingSection } from '../../helpers/diff-helpers.js';

// Helper: build matched pairs and classify all of them
function classifyAll(
  oldSections: FilingSection[],
  newSections: FilingSection[],
): Array<{ match: SectionMatch; changeType: ChangeType }> {
  const alignment = alignSections(oldSections, newSections);
  return alignment.matched.map((match) => ({
    match,
    changeType: classifySectionDiff(match, alignment.matched),
  }));
}

// Helper: generate N unique SEC-like headings
function arbUniqueHeadings(n: number): fc.Arbitrary<string[]> {
  if (n === 0) return fc.constant([]);
  return fc.uniqueArray(arbHeading(), { minLength: n, maxLength: n })
    .filter(arr => arr.length === n);
}

// Helper: generate section with specific heading and random content
function arbSectionWithHeading(heading: string): fc.Arbitrary<FilingSection> {
  return arbContentBlocks(undefined).map((blocks) =>
    makeFilingSection(`id-${heading.replace(/\W/g, '-').toLowerCase()}`, heading, { blocks }),
  );
}

describe('Acceptance: Section-Level Diff (Property-Based)', () => {
  describe('AC-1: Identical headings never produce added or removed sections', () => {
    it('every sectionDiff is unchanged or modified, never added/removed', () => {
      fc.assert(
        fc.property(
          arbUniqueHeadings(5).chain((headings) =>
            fc.tuple(
              fc.tuple(...headings.map((h) => arbSectionWithHeading(h))),
              fc.tuple(...headings.map((h) => arbSectionWithHeading(h))),
            ).map(([oldSections, newSections]) => ({
              headings,
              oldSections: oldSections as FilingSection[],
              newSections: newSections as FilingSection[],
            })),
          ),
          ({ headings, oldSections, newSections }) => {
            const result = alignSections(oldSections, newSections);
            expect(result.added).toHaveLength(0);
            expect(result.removed).toHaveLength(0);
            expect(result.matched).toHaveLength(headings.length);

            const classified = classifyAll(oldSections, newSections);
            for (const { changeType } of classified) {
              expect(['unchanged', 'modified']).toContain(changeType);
            }
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('AC-2: Heading similarity above threshold always produces a match', () => {
    it('mutated heading (suffix appended) still matches', () => {
      fc.assert(
        fc.property(
          arbHeading(),
          fc.constantFrom(' Amendment', ' Revised', ' Updated', ' (Cont.)'),
          arbContentBlocks(),
          arbContentBlocks(),
          (heading, suffix, oldBlocks, newBlocks) => {
            const oldSection = makeFilingSection('s1', heading, { blocks: oldBlocks });
            const newSection = makeFilingSection('s1', heading + suffix, { blocks: newBlocks });

            const result = alignSections([oldSection], [newSection]);
            expect(result.matched).toHaveLength(1);
            expect(result.added).toHaveLength(0);
            expect(result.removed).toHaveLength(0);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('AC-3: Permuted sections with unchanged content are "reordered"', () => {
    it('all sections matched; moved ones are reordered, stable ones unchanged', () => {
      fc.assert(
        fc.property(
          arbUniqueHeadings(4).chain((headings) =>
            fc.tuple(
              ...headings.map((h) => arbSectionWithHeading(h)),
            ).chain((sections) => {
              const sectionArr = sections as FilingSection[];
              return fc.shuffledSubarray(sectionArr, { minLength: sectionArr.length, maxLength: sectionArr.length })
                .map((permuted) => ({ original: sectionArr, permuted }));
            }),
          ),
          ({ original, permuted }) => {
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
                // Should only be reordered or unchanged when content is same
                expect(ct).toMatch(/^(reordered|unchanged)$/);
              }
            }
            expect(reorderedCount + unchangedCount).toBe(original.length);
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('AC-3b: Content change takes precedence over reorder', () => {
    it('sections with changed content are modified regardless of position', () => {
      fc.assert(
        fc.property(
          arbUniqueHeadings(4).chain((headings) =>
            fc.tuple(
              ...headings.map((h) => arbSectionWithHeading(h)),
            ).chain((sections) => {
              const sectionArr = sections as FilingSection[];
              // Pick at least 1 section to modify content
              return fc.tuple(
                fc.shuffledSubarray(sectionArr, { minLength: sectionArr.length, maxLength: sectionArr.length }),
                fc.nat({ max: sectionArr.length - 1 }),
                fc.lorem({ maxCount: 3, mode: 'sentences' }),
              ).map(([permuted, modifyIdx, newText]) => ({
                original: sectionArr,
                permuted: permuted.map((s, i) =>
                  i === modifyIdx
                    ? makeFilingSection(s.id, s.heading, {
                        blocks: [makeParagraph(newText + ' MODIFIED')],
                      })
                    : s,
                ),
                modifyIdx,
              }));
            }),
          ),
          ({ original, permuted, modifyIdx }) => {
            const result = alignSections(original, permuted);
            expect(result.matched).toHaveLength(original.length);

            // Find the match for the modified section
            for (const match of result.matched) {
              const ct = classifySectionDiff(match, result.matched);
              const oldContent = serializeSectionContent(match.oldSection);
              const newContent = serializeSectionContent(match.newSection);

              if (oldContent !== newContent) {
                // Content change takes precedence
                expect(ct).toBe('modified');
              } else {
                expect(['unchanged', 'reordered']).toContain(ct);
              }
            }
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('AC-4: Extra sections in new document are "added"', () => {
    it('K extra sections with unique headings are detected as added', () => {
      fc.assert(
        fc.property(
          arbUniqueHeadings(3).chain((headings) =>
            fc.tuple(
              fc.tuple(...headings.map((h) => arbSectionWithHeading(h))),
              fc.array(arbUniqueHeading().chain((h) => arbSectionWithHeading(h)), {
                minLength: 1,
                maxLength: 3,
              }),
            ).map(([commonSections, extraSections]) => ({
              headings,
              common: commonSections as FilingSection[],
              extras: extraSections,
            })),
          ),
          ({ headings, common, extras }) => {
            const oldSections = [...common];
            const newSections = [...common, ...extras];

            const result = alignSections(oldSections, newSections);
            expect(result.added).toHaveLength(extras.length);
            expect(result.matched).toHaveLength(headings.length);
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('AC-5: Missing sections in new document are "removed"', () => {
    it('K removed sections are detected', () => {
      fc.assert(
        fc.property(
          arbUniqueHeadings(5).chain((headings) =>
            fc.tuple(
              ...headings.map((h) => arbSectionWithHeading(h)),
            ).chain((sections) => {
              const sectionArr = sections as FilingSection[];
              // Remove 1-2 sections
              return fc.nat({ max: Math.min(1, sectionArr.length - 2) }).map((removeCount) => {
                const k = removeCount + 1;
                return {
                  allSections: sectionArr,
                  newSections: sectionArr.slice(0, sectionArr.length - k),
                  removedCount: k,
                };
              });
            }),
          ),
          ({ allSections, newSections, removedCount }) => {
            const result = alignSections(allSections, newSections);
            expect(result.removed).toHaveLength(removedCount);
            expect(result.matched).toHaveLength(allSections.length - removedCount);
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('AC-6: Self-diff produces all "unchanged"', () => {
    it('diffing a document against itself yields all unchanged', () => {
      fc.assert(
        fc.property(
          arbUniqueHeadings(5).chain((headings) =>
            fc.tuple(...headings.map((h) => arbSectionWithHeading(h))).map(
              (sections) => sections as FilingSection[],
            ),
          ),
          (sections) => {
            const result = alignSections(sections, sections);
            expect(result.matched).toHaveLength(sections.length);
            expect(result.added).toHaveLength(0);
            expect(result.removed).toHaveLength(0);

            for (const match of result.matched) {
              const ct = classifySectionDiff(match, result.matched);
              expect(ct).toBe('unchanged');
            }
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('AC-7: Content modifications produce "modified" classification', () => {
    it('AC-7a: paragraph text change', () => {
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

    it('AC-7b: table content change', () => {
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

    it('AC-7c: block addition', () => {
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

    it('AC-7d: block removal', () => {
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

    it('AC-7e: mixed block type changes', () => {
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

    it('AC-7f: block type replacement', () => {
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

    it('AC-7 aggregate: exactly K modified sections, N-K unchanged (property)', () => {
      fc.assert(
        fc.property(
          arbUniqueHeadings(4).chain((headings) =>
            fc.tuple(
              ...headings.map((h) => arbSectionWithHeading(h)),
            ).chain((sections) => {
              const sectionArr = sections as FilingSection[];
              // Randomly select 1-2 sections to modify
              return fc.subarray(
                sectionArr.map((_, i) => i),
                { minLength: 1, maxLength: 2 },
              ).map((modifyIndices) => ({
                sections: sectionArr,
                modifyIndices: new Set(modifyIndices),
              }));
            }),
          ),
          ({ sections, modifyIndices }) => {
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
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('AC-8: Summary counts are consistent with sectionDiffs', () => {
    it('counts match actual changeTypes in alignment results (property)', () => {
      fc.assert(
        fc.property(
          arbUniqueHeadings(4).chain((headings) =>
            fc.tuple(
              // Old doc: use all headings
              fc.tuple(...headings.map((h) => arbSectionWithHeading(h))),
              // New doc: shuffled subset + possible extras
              fc.tuple(...headings.map((h) => arbSectionWithHeading(h))),
            ).map(([oldSections, newSections]) => ({
              oldSections: oldSections as FilingSection[],
              newSections: newSections as FilingSection[],
            })),
          ),
          ({ oldSections, newSections }) => {
            const result = alignSections(oldSections, newSections);

            // Count change types
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

            // Total should equal total unique sections
            const total = counts.added + counts.removed + counts.modified +
              counts.unchanged + counts.reordered;
            expect(total).toBe(
              result.matched.length + result.added.length + result.removed.length,
            );
          },
        ),
        { numRuns: 20 },
      );
    });
  });
});
