import type { Element } from 'domhandler';
import { isTag } from 'domhandler';
import type { Table, TableRow, TableCell, SourceLocation } from '../types.js';
import type { ExtractionContext } from './types.js';
import { getTextContent } from './dom-utils.js';

/** Find all <tr> elements inside a <table>, tracking thead context. */
function findRows(tableNode: Element): { tr: Element; inThead: boolean }[] {
  const rows: { tr: Element; inThead: boolean }[] = [];
  for (const child of tableNode.children) {
    if (!isTag(child)) continue;
    const name = child.name;
    if (name === 'tr') {
      rows.push({ tr: child, inThead: false });
    } else if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
      for (const grandchild of child.children) {
        if (isTag(grandchild) && grandchild.name === 'tr') {
          rows.push({ tr: grandchild, inThead: name === 'thead' });
        }
      }
    }
  }
  return rows;
}

/** Check if all cell elements in a row are <th>. */
function isAllThRow(trNode: Element): boolean {
  const cellNodes = trNode.children.filter(
    c => isTag(c) && (c.name === 'td' || c.name === 'th'),
  );
  return cellNodes.length > 0 && cellNodes.every(
    c => isTag(c) && c.name === 'th',
  );
}

/** Extract cells from a <tr> element. */
function extractCells(trNode: Element, context: ExtractionContext): TableCell[] {
  const cells: TableCell[] = [];
  for (const child of trNode.children) {
    if (!isTag(child)) continue;
    const name = child.name;
    if (name !== 'td' && name !== 'th') continue;

    const rawText = getTextContent(child);
    const text = rawText
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const colspan = Math.max(1, parseInt(child.attribs?.['colspan'] ?? '', 10) || 1);
    const rowspan = Math.max(1, parseInt(child.attribs?.['rowspan'] ?? '', 10) || 1);
    const numericValue = tryParseNumeric(text);

    const source: SourceLocation = {
      start: child.startIndex ?? 0,
      end: (child.endIndex ?? 0) + 1,
    };

    const cell: TableCell = { text, colspan, rowspan, source };
    if (numericValue !== undefined) cell.numericValue = numericValue;
    if (context.includeSourceHtml) {
      cell.sourceHtml = context.html.slice(source.start, source.end);
    }
    cells.push(cell);
  }
  return cells;
}

/** Extract a fully populated Table from a <table> DOM element. */
export function extractTable(
  tableNode: Element,
  source: SourceLocation,
  context: ExtractionContext,
): Table {
  const rowInfos = findRows(tableNode);
  const rows: TableRow[] = rowInfos.map(({ tr, inThead }) => {
    const cells = extractCells(tr, context);
    const isHeader = inThead || isAllThRow(tr);
    const rowSource: SourceLocation = {
      start: tr.startIndex ?? 0,
      end: (tr.endIndex ?? 0) + 1,
    };
    const row: TableRow = { cells, isHeader, source: rowSource };
    if (context.includeSourceHtml) {
      row.sourceHtml = context.html.slice(rowSource.start, rowSource.end);
    }
    return row;
  });

  const table: Table = { type: 'table', rows, source };
  if (context.includeSourceHtml) {
    table.sourceHtml = context.html.slice(source.start, source.end);
  }
  return table;
}

/** Parse displayed text into a numeric value, or return undefined if not numeric. */
export function tryParseNumeric(text: string): number | undefined {
  if (!text || text.trim().length === 0) return undefined;

  let s = text.trim();

  // Dash patterns meaning zero/nil
  if (/^[\u2014\u2013\u2012\u2015\u2212—–-]{1,3}$/.test(s)) return 0;

  // Strip currency symbol and percentage
  s = s.replace(/^\$\s*/, '');
  s = s.replace(/\s*%$/, '');

  // Detect parenthetical negative: (1,234.56) -> -1234.56
  const isParenNegative = s.startsWith('(') && s.endsWith(')');
  if (isParenNegative) {
    s = s.slice(1, -1).trim();
  }

  // Strip commas
  s = s.replace(/,/g, '');

  // Must look like a number at this point
  if (!/^-?\s*\d+(\.\d+)?$/.test(s)) return undefined;

  // Strip internal whitespace (handles "- 1234")
  s = s.replace(/\s+/g, '');

  const value = parseFloat(s);
  if (isNaN(value)) return undefined;

  return isParenNegative ? -value : value;
}
