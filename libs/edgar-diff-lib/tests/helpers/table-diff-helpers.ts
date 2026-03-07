import type { Table, TableRow, TableCell, SourceLocation } from '../../src/types.js';
import { tryParseNumeric } from '../../src/parser/table-extractor.js';

const defaultSource: SourceLocation = { start: 0, end: 1 };

/** Build a TableCell for testing. */
export function makeTableCell(
  text: string,
  opts?: { numericValue?: number; colspan?: number; rowspan?: number; source?: SourceLocation },
): TableCell {
  const cell: TableCell = {
    text,
    colspan: opts?.colspan ?? 1,
    rowspan: opts?.rowspan ?? 1,
    source: opts?.source ?? { ...defaultSource },
  };
  if (opts?.numericValue !== undefined) {
    cell.numericValue = opts.numericValue;
  }
  return cell;
}

/** Build a TableRow for testing. */
export function makeTableRow(
  cells: TableCell[],
  opts?: { isHeader?: boolean; source?: SourceLocation },
): TableRow {
  return {
    cells,
    isHeader: opts?.isHeader ?? false,
    source: opts?.source ?? { ...defaultSource },
  };
}

/** Build a Table object for testing (bypasses HTML parsing). */
export function makeTable(rows: TableRow[], source?: SourceLocation): Table {
  return {
    type: 'table',
    rows,
    source: source ?? { ...defaultSource },
  };
}

/** Build a simple financial table with label column + value columns. */
export function makeFinancialTable(data: {
  headers: string[];
  rows: Array<{ label: string; values: string[] }>;
}): Table {
  const headerRow = makeTableRow(
    data.headers.map((h) => makeTableCell(h)),
    { isHeader: true },
  );

  const bodyRows = data.rows.map((r) => {
    const cells = [makeTableCell(r.label)];
    for (const v of r.values) {
      const numericValue = tryParseNumeric(v);
      cells.push(makeTableCell(v, numericValue !== undefined ? { numericValue } : undefined));
    }
    return makeTableRow(cells);
  });

  return makeTable([headerRow, ...bodyRows]);
}
