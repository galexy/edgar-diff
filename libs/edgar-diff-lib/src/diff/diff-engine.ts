import { Temporal } from '@js-temporal/polyfill';
import type { StructuredDocument, FilingSection, ContentBlock, Table } from '../types.js';
import type { RawFiling } from '../client/types.js';
import type { StructuredDiff, SectionDiff, DiffOptions, DiffRange, DiffFilingMetadata, TableDiff } from './types.js';
import { alignSections, classifySectionDiff } from './section-aligner.js';
import type { SectionMatch } from './section-aligner.js';
import { diffParagraphs } from './paragraph-differ.js';
import { diffTables } from './table-differ.js';

/** Strip the html field from a RawFiling to produce DiffFilingMetadata. */
function toDiffFilingMetadata(filing: RawFiling): DiffFilingMetadata {
  return {
    accessionNumber: filing.accessionNumber,
    cik: filing.cik,
    formType: filing.formType,
    filingDate: filing.filingDate,
    primaryDocumentFilename: filing.primaryDocumentFilename,
    fetchedAt: filing.fetchedAt,
  };
}

/** Extract table blocks from a section's content blocks. */
function extractTables(blocks: ContentBlock[]): Table[] {
  return blocks.filter((b): b is Table => b.type === 'table');
}

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

  // Compute paragraph-level diffs for matched sections, then filter unchanged
  const allParagraphDiffs = options.match ? diffParagraphs(options.match) : [];
  const paragraphDiffs = allParagraphDiffs.filter(pd => pd.changeType !== 'unchanged');

  // Compute table diffs
  let tableDiffs: TableDiff[];
  if (options.match) {
    // Matched section — diff tables between old and new
    const oldTables = extractTables(options.match.oldSection.blocks);
    const newTables = extractTables(options.match.newSection.blocks);
    tableDiffs = diffTables(oldTables, newTables);
  } else if (options.newSection && !options.oldSection) {
    // Added section — all tables are added
    tableDiffs = extractTables(options.newSection.blocks).map(table => ({
      changeType: 'added' as const,
      rowDiffs: [],
      cellDiffs: [],
      sourceMapping: { new: table.source },
      summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
    }));
  } else if (options.oldSection && !options.newSection) {
    // Removed section — all tables are removed
    tableDiffs = extractTables(options.oldSection.blocks).map(table => ({
      changeType: 'removed' as const,
      rowDiffs: [],
      cellDiffs: [],
      sourceMapping: { old: table.source },
      summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
    }));
  } else {
    tableDiffs = [];
  }

  // Filter unchanged tables
  tableDiffs = tableDiffs.filter(td => td.changeType !== 'unchanged');

  return {
    id: section.id,
    heading: section.heading,
    changeType,
    paragraphDiffs,
    tableDiffs,
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
    oldFiling: toDiffFilingMetadata(oldDoc.filing),
    newFiling: toDiffFilingMetadata(newDoc.filing),
    sectionDiffs,
    summary: buildSummary(sectionDiffs),
    generatedAt: Temporal.Now.instant(),
  };
}
