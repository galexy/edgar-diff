import { Temporal } from '@js-temporal/polyfill';
import type { StructuredDocument, FilingSection } from '../types.js';
import type { StructuredDiff, SectionDiff, DiffOptions, DiffRange } from './types.js';
import { alignSections, classifySectionDiff } from './section-aligner.js';
import type { SectionMatch } from './section-aligner.js';
import { diffParagraphs } from './paragraph-differ.js';

/** Compute summary counts from sectionDiffs. */
export function buildSummary(
  sectionDiffs: SectionDiff[],
): StructuredDiff['summary'] {
  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0, reordered: 0 };
  for (const diff of sectionDiffs) {
    const ct = diff.changeType;
    if (ct === 'moved') {
      // 'moved' sections count as 'reordered' in the summary
      summary.reordered++;
    } else if (ct in summary) {
      summary[ct as keyof typeof summary]++;
    }
  }
  return summary;
}

function makeSectionDiff(
  changeType: SectionDiff['changeType'],
  options: {
    oldSection?: FilingSection;
    newSection?: FilingSection;
    match?: SectionMatch;
  },
): SectionDiff {
  const section = options.newSection ?? options.oldSection;
  if (!section) {
    throw new Error('makeSectionDiff requires at least one of oldSection or newSection');
  }
  const sourceMapping: DiffRange = {};
  if (options.oldSection) sourceMapping.old = options.oldSection.source;
  if (options.newSection) sourceMapping.new = options.newSection.source;

  // Compute paragraph-level diffs for matched sections
  const paragraphDiffs = options.match ? diffParagraphs(options.match) : [];

  return {
    id: section.id,
    heading: section.heading,
    changeType,
    oldSection: options.oldSection,
    newSection: options.newSection,
    paragraphDiffs,
    tableDiffs: [],
    subsectionDiffs: [],
    sourceMapping,
  };
}

/** Compute section-level diff between two StructuredDocuments. */
export function diffFilings(
  oldDoc: StructuredDocument,
  newDoc: StructuredDocument,
  options?: DiffOptions,
): StructuredDiff {
  const { matched, added, removed } = alignSections(
    oldDoc.sections,
    newDoc.sections,
    options,
  );

  // Build a map of newIndex -> SectionDiff for matched sections
  const matchedByNewIndex = new Map<number, { match: SectionMatch; changeType: SectionDiff['changeType'] }>();
  for (const match of matched) {
    const changeType = classifySectionDiff(match, matched);
    matchedByNewIndex.set(match.newIndex, { match, changeType });
  }

  // Build set of added section indices in newDoc
  const addedSet = new Set(added.map((s) => newDoc.sections.indexOf(s)));

  // Order: sections present in new filing (matched + added) in new-filing order,
  // then removed sections in old-filing order
  const sectionDiffs: SectionDiff[] = [];

  for (let i = 0; i < newDoc.sections.length; i++) {
    const matchEntry = matchedByNewIndex.get(i);
    if (matchEntry) {
      sectionDiffs.push(
        makeSectionDiff(matchEntry.changeType, {
          oldSection: matchEntry.match.oldSection,
          newSection: matchEntry.match.newSection,
          match: matchEntry.match,
        }),
      );
    } else if (addedSet.has(i)) {
      sectionDiffs.push(
        makeSectionDiff('added', { newSection: newDoc.sections[i] }),
      );
    }
  }

  // Append removed sections in old-filing order
  for (const section of removed) {
    sectionDiffs.push(makeSectionDiff('removed', { oldSection: section }));
  }

  return {
    oldFiling: oldDoc.filing,
    newFiling: newDoc.filing,
    sectionDiffs,
    summary: buildSummary(sectionDiffs),
    generatedAt: Temporal.Now.instant(),
  };
}
