import type { SectionDiff, ParagraphDiff, TableDiff, RowDiff, CellDiff, StructuredDocument, Table } from '@edgar-diff/lib';

/**
 * Build a synthetic SectionDiff[] from a StructuredDocument.
 *
 * For visual validation, this creates sample diff data by:
 * - Marking the first paragraph of each section as 'modified' with a word-level change
 * - Marking the second paragraph (if present) as 'added' on new side / 'removed' on old side
 * - Leaving remaining paragraphs unchanged
 * - For sections with tables, creating sample table diffs showing:
 *   - Modified cells with old→new value annotations
 *   - Added rows (new side) and removed rows (old side)
 *
 * This produces visible highlights in both panels without needing a real second filing.
 */
export function buildSampleDiffs(doc: StructuredDocument): SectionDiff[] {
  const sectionDiffs: SectionDiff[] = [];

  for (const section of doc.sections) {
    const paragraphs = section.blocks.filter((b) => b.type === 'paragraph');
    const tables = section.blocks.filter((b): b is Table => b.type === 'table');

    // Skip sections with no paragraphs and no tables
    if (paragraphs.length === 0 && tables.length === 0) continue;

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

    // Build table diffs for the first table in the section (if it has enough rows)
    const tableDiffs: TableDiff[] = [];
    for (const table of tables) {
      const td = buildSampleTableDiff(table);
      if (td) tableDiffs.push(td);
    }

    sectionDiffs.push({
      id: section.id,
      heading: section.heading,
      changeType: 'modified',
      paragraphDiffs,
      tableDiffs,
      subsectionDiffs: [],
      sourceMapping: {
        old: { start: section.source.start, end: section.source.end },
        new: { start: section.source.start, end: section.source.end },
      },
    });
  }

  return sectionDiffs;
}

/**
 * Build a sample TableDiff for visual validation.
 * Only creates diffs for tables with >= 4 data rows.
 * Demonstrates: modified cells, added rows, removed rows.
 */
function buildSampleTableDiff(table: Table): TableDiff | null {
  // Need at least 4 rows (header-ish + 3 data rows) to show meaningful diffs
  if (table.rows.length < 4) return null;

  const rowDiffs: RowDiff[] = [];
  const allCellDiffs: CellDiff[] = [];

  for (let ri = 0; ri < table.rows.length; ri++) {
    const row = table.rows[ri];

    if (ri === 0 || ri === 1) {
      // First two rows (often header/sub-header): unchanged
      rowDiffs.push({
        oldRowIndex: ri,
        newRowIndex: ri,
        changeType: 'unchanged',
        cellDiffs: [],
      });
    } else if (ri === 2) {
      // Third row: modified — find a cell with numeric text and change it
      const cellDiffs: CellDiff[] = [];
      for (let ci = 0; ci < row.cells.length; ci++) {
        const cell = row.cells[ci];
        const numMatch = cell.text.match(/[\d,]+/);
        if (numMatch && ci > 0 && cellDiffs.length === 0) {
          // Modify the first numeric cell
          const cd: CellDiff = {
            row: ri,
            col: ci,
            changeType: 'modified',
            oldValue: cell.text,
            newValue: String(parseInt(cell.text.replace(/,/g, '')) + 5000),
            sourceMapping: {
              old: { start: cell.source.start, end: cell.source.end },
              new: { start: cell.source.start, end: cell.source.end },
            },
          };
          cellDiffs.push(cd);
          allCellDiffs.push(cd);
        }
      }
      if (cellDiffs.length > 0) {
        rowDiffs.push({
          oldRowIndex: ri,
          newRowIndex: ri,
          changeType: 'modified',
          cellDiffs,
        });
      } else {
        rowDiffs.push({
          oldRowIndex: ri,
          newRowIndex: ri,
          changeType: 'unchanged',
          cellDiffs: [],
        });
      }
    } else if (ri === table.rows.length - 2) {
      // Second-to-last row: removed (only on old side)
      rowDiffs.push({
        oldRowIndex: ri,
        newRowIndex: undefined,
        changeType: 'removed',
        cellDiffs: [],
      });
    } else if (ri === table.rows.length - 1) {
      // Last row: added (only on new side)
      rowDiffs.push({
        oldRowIndex: undefined,
        newRowIndex: ri,
        changeType: 'added',
        cellDiffs: [],
      });
    } else {
      // Middle rows: unchanged
      rowDiffs.push({
        oldRowIndex: ri,
        newRowIndex: ri,
        changeType: 'unchanged',
        cellDiffs: [],
      });
    }
  }

  return {
    changeType: 'modified',
    rowDiffs,
    cellDiffs: allCellDiffs,
    sourceMapping: {
      old: { start: table.source.start, end: table.source.end },
      new: { start: table.source.start, end: table.source.end },
    },
    summary: {
      rowsAdded: 1,
      rowsRemoved: 1,
      rowsModified: 1,
      rowsUnchanged: table.rows.length - 3,
      cellsChanged: allCellDiffs.length,
    },
  };
}
