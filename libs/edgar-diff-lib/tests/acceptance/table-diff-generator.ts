/**
 * Table Diff Generator: produces pairs of Table objects with controlled mutations
 * for property-based testing of the table diff pipeline.
 */

import { parseFiling } from '../../src/parser/index.js';
import type { Table, TableRow, TableCell } from '../../src/types.js';
import { makeRawFiling } from '../helpers/ground-truth.js';
import { generateTable, wrapInSection } from './table-html-generator.js';

// ── Table Pair Generation ──

export interface TablePairMutation {
  type: 'none' | 'cell-values' | 'add-rows' | 'remove-rows' | 'add-columns' | 'remove-columns' | 'mixed';
}

export interface GeneratedTablePair {
  oldTable: Table;
  newTable: Table;
  mutation: TablePairMutation;
  expectedChangedCells?: number;
  expectedAddedRows?: number;
  expectedRemovedRows?: number;
}

// ── Table List Pair Generation ──

export interface TableListScenario {
  type: 'matched' | 'shifted' | 'added' | 'removed' | 'unchanged';
}

export interface GeneratedTableListPair {
  oldTables: Table[];
  newTables: Table[];
  scenario: TableListScenario;
}

// ── Helpers ──

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cloneTable(table: Table): Table {
  return JSON.parse(JSON.stringify(table)) as Table;
}

/**
 * Parse a generated table HTML to get a real Table object via the full parser pipeline.
 */
function parseTableFromHtml(tableHtml: string): Table | undefined {
  const html = wrapInSection(tableHtml);
  const doc = parseFiling(makeRawFiling(html));
  const section = doc.sections[0];
  if (!section) return undefined;
  return section.blocks.find(b => b.type === 'table') as Table | undefined;
}

/**
 * Generate a base Table with guaranteed rows for mutations.
 */
function generateBaseTable(): Table {
  let table: Table | undefined;
  let attempts = 0;
  while (!table || table.rows.length < 2) {
    const gen = generateTable({ minRows: 3, maxRows: 10, minCols: 2, maxCols: 6, useColspan: false, useRowspan: false });
    table = parseTableFromHtml(gen.html);
    attempts++;
    if (attempts > 20) {
      throw new Error('Failed to generate a valid base table after 20 attempts');
    }
  }
  return table;
}

// ── Mutation Functions ──

function mutateCellValues(table: Table): { table: Table; changedCells: number } {
  const newTable = cloneTable(table);
  const dataRows = newTable.rows.filter(r => !r.isHeader);
  if (dataRows.length === 0) return { table: newTable, changedCells: 0 };

  const numToChange = randInt(1, Math.max(1, Math.min(5, dataRows.length)));
  let changed = 0;

  for (let i = 0; i < numToChange; i++) {
    const row = dataRows[randInt(0, dataRows.length - 1)];
    if (row.cells.length === 0) continue;
    const cellIdx = randInt(0, row.cells.length - 1);
    const cell = row.cells[cellIdx];
    const newValue = `$${randInt(100, 999999).toLocaleString('en-US')}`;
    cell.text = newValue;
    cell.numericValue = parseInt(newValue.replace(/[$,]/g, ''), 10);
    changed++;
  }

  return { table: newTable, changedCells: changed };
}

function addRows(table: Table): { table: Table; addedRows: number } {
  const newTable = cloneTable(table);
  const numToAdd = randInt(1, 3);

  for (let i = 0; i < numToAdd; i++) {
    const colCount = newTable.rows.length > 0 ? newTable.rows[0].cells.length : 2;
    const newCells: TableCell[] = [];
    for (let c = 0; c < colCount; c++) {
      newCells.push({
        text: c === 0 ? `New Item ${randInt(1, 999)}` : `$${randInt(100, 9999)}`,
        colspan: 1,
        rowspan: 1,
        source: { start: 0, end: 1 },
      });
    }
    const newRow: TableRow = {
      cells: newCells,
      isHeader: false,
      source: { start: 0, end: 1 },
    };
    const insertAt = randInt(1, newTable.rows.length);
    newTable.rows.splice(insertAt, 0, newRow);
  }

  return { table: newTable, addedRows: numToAdd };
}

function removeRows(table: Table): { table: Table; removedRows: number } {
  const newTable = cloneTable(table);
  const dataRowIndices = newTable.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.isHeader)
    .map(({ i }) => i);

  if (dataRowIndices.length === 0) return { table: newTable, removedRows: 0 };

  const numToRemove = randInt(1, Math.min(3, dataRowIndices.length));
  const indicesToRemove = new Set<number>();

  while (indicesToRemove.size < numToRemove) {
    indicesToRemove.add(dataRowIndices[randInt(0, dataRowIndices.length - 1)]);
  }

  // Remove in reverse order to preserve indices
  const sorted = [...indicesToRemove].sort((a, b) => b - a);
  for (const idx of sorted) {
    newTable.rows.splice(idx, 1);
  }

  return { table: newTable, removedRows: indicesToRemove.size };
}

function addColumns(table: Table): { table: Table } {
  const newTable = cloneTable(table);
  const numToAdd = randInt(1, 2);

  for (const row of newTable.rows) {
    for (let c = 0; c < numToAdd; c++) {
      row.cells.push({
        text: row.isHeader ? `Col ${randInt(1, 99)}` : `$${randInt(100, 9999)}`,
        colspan: 1,
        rowspan: 1,
        source: { start: 0, end: 1 },
      });
    }
  }

  return { table: newTable };
}

function removeColumns(table: Table): { table: Table } {
  const newTable = cloneTable(table);
  const numToRemove = randInt(1, 2);

  for (const row of newTable.rows) {
    const toRemove = Math.min(numToRemove, row.cells.length - 1);
    if (toRemove > 0) {
      row.cells.splice(row.cells.length - toRemove, toRemove);
    }
  }

  return { table: newTable };
}

// ── Public API ──

/**
 * Generate a pair of tables with a controlled mutation applied.
 */
export function generateTablePair(mutationType: TablePairMutation['type']): GeneratedTablePair {
  const baseTable = generateBaseTable();

  switch (mutationType) {
    case 'none': {
      return {
        oldTable: baseTable,
        newTable: cloneTable(baseTable),
        mutation: { type: 'none' },
      };
    }
    case 'cell-values': {
      const { table: newTable, changedCells } = mutateCellValues(baseTable);
      return {
        oldTable: baseTable,
        newTable,
        mutation: { type: 'cell-values' },
        expectedChangedCells: changedCells,
      };
    }
    case 'add-rows': {
      const { table: newTable, addedRows } = addRows(baseTable);
      return {
        oldTable: baseTable,
        newTable,
        mutation: { type: 'add-rows' },
        expectedAddedRows: addedRows,
      };
    }
    case 'remove-rows': {
      const { table: newTable, removedRows } = removeRows(baseTable);
      return {
        oldTable: baseTable,
        newTable,
        mutation: { type: 'remove-rows' },
        expectedRemovedRows: removedRows,
      };
    }
    case 'add-columns': {
      const { table: newTable } = addColumns(baseTable);
      return {
        oldTable: baseTable,
        newTable,
        mutation: { type: 'add-columns' },
      };
    }
    case 'remove-columns': {
      const { table: newTable } = removeColumns(baseTable);
      return {
        oldTable: baseTable,
        newTable,
        mutation: { type: 'remove-columns' },
      };
    }
    case 'mixed': {
      let table = cloneTable(baseTable);
      const { table: t1 } = mutateCellValues(table);
      table = t1;
      const { table: t2 } = addRows(table);
      table = t2;
      return {
        oldTable: baseTable,
        newTable: table,
        mutation: { type: 'mixed' },
      };
    }
  }
}

/**
 * Generate a pair of table lists for testing matchTables / diffTables.
 */
export function generateTableListPair(scenario: TableListScenario['type']): GeneratedTableListPair {
  const count = randInt(2, 4);
  const tables: Table[] = [];
  for (let i = 0; i < count; i++) {
    tables.push(generateBaseTable());
  }

  switch (scenario) {
    case 'matched': {
      // Same tables, possibly with cell mutations
      const newTables = tables.map(t => {
        const { table } = mutateCellValues(t);
        return table;
      });
      return {
        oldTables: tables,
        newTables,
        scenario: { type: 'matched' },
      };
    }
    case 'shifted': {
      // Insert a new table at position 0 of new list
      const extraTable = generateBaseTable();
      return {
        oldTables: tables,
        newTables: [extraTable, ...tables.map(t => cloneTable(t))],
        scenario: { type: 'shifted' },
      };
    }
    case 'added': {
      // New list has one extra table at the end
      const extraTable = generateBaseTable();
      return {
        oldTables: tables,
        newTables: [...tables.map(t => cloneTable(t)), extraTable],
        scenario: { type: 'added' },
      };
    }
    case 'removed': {
      // Old list has one extra table (remove last from new)
      return {
        oldTables: tables,
        newTables: tables.slice(0, -1).map(t => cloneTable(t)),
        scenario: { type: 'removed' },
      };
    }
    case 'unchanged': {
      return {
        oldTables: tables,
        newTables: tables.map(t => cloneTable(t)),
        scenario: { type: 'unchanged' },
      };
    }
  }
}
