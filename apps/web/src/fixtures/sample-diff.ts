import type { SectionDiff, ParagraphDiff, StructuredDocument } from '@edgar-diff/lib';

/**
 * Build a synthetic SectionDiff[] from a StructuredDocument.
 *
 * For visual validation, this creates sample diff data by:
 * - Marking the first paragraph of each section as 'modified' with a word-level change
 * - Marking the second paragraph (if present) as 'added' on new side / 'removed' on old side
 * - Leaving remaining paragraphs unchanged
 *
 * This produces visible highlights in both panels without needing a real second filing.
 */
export function buildSampleDiffs(doc: StructuredDocument): SectionDiff[] {
  const sectionDiffs: SectionDiff[] = [];

  for (const section of doc.sections) {
    const paragraphs = section.blocks.filter((b) => b.type === 'paragraph');
    if (paragraphs.length === 0) continue;

    const paragraphDiffs: ParagraphDiff[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];

      if (i === 0 && para.text.length >= 10) {
        // First paragraph: modified with a word-level change on the first word
        const firstSpace = para.text.indexOf(' ');
        const wordEnd = firstSpace > 0 ? firstSpace : Math.min(5, para.text.length);
        paragraphDiffs.push({
          changeType: 'modified',
          wordChanges: [
            { type: 'removed', start: 0, end: wordEnd },
            { type: 'added', start: 0, end: wordEnd },
          ],
          sourceMapping: {
            old: { start: para.source.start, end: para.source.end },
            new: { start: para.source.start, end: para.source.end },
          },
        });
      } else if (i === 1) {
        // Second paragraph: added/removed
        paragraphDiffs.push({
          changeType: 'added',
          sourceMapping: {
            old: undefined,
            new: { start: para.source.start, end: para.source.end },
          },
        });
      } else {
        // Remaining: unchanged
        paragraphDiffs.push({
          changeType: 'unchanged',
          sourceMapping: {
            old: { start: para.source.start, end: para.source.end },
            new: { start: para.source.start, end: para.source.end },
          },
        });
      }
    }

    sectionDiffs.push({
      id: section.id,
      heading: section.heading,
      changeType: 'modified',
      paragraphDiffs,
      tableDiffs: [],
      subsectionDiffs: [],
      sourceMapping: {
        old: { start: section.source.start, end: section.source.end },
        new: { start: section.source.start, end: section.source.end },
      },
    });
  }

  return sectionDiffs;
}
