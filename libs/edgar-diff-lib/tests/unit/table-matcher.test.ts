import { describe, it, expect } from 'vitest';
import { matchTables } from '../../src/diff/table-matcher.js';
import { makeTable, makeTableRow, makeTableCell, makeFinancialTable } from '../helpers/table-diff-helpers.js';

describe('matchTables', () => {
  it('same-count tables with identical headers matched by position, similarity=1.0', () => {
    const old1 = makeFinancialTable({ headers: ['Metric', '2023'], rows: [{ label: 'Revenue', values: ['$100'] }] });
    const old2 = makeFinancialTable({ headers: ['Item', 'Amount'], rows: [{ label: 'Cost', values: ['$50'] }] });
    const new1 = makeFinancialTable({ headers: ['Metric', '2023'], rows: [{ label: 'Revenue', values: ['$120'] }] });
    const new2 = makeFinancialTable({ headers: ['Item', 'Amount'], rows: [{ label: 'Cost', values: ['$60'] }] });

    const result = matchTables([old1, old2], [new1, new2]);
    expect(result.matched).toHaveLength(2);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.matched[0].similarity).toBe(1.0);
    expect(result.matched[1].similarity).toBe(1.0);
  });

  it('same-count tables with similar headers matched (e.g., year column change)', () => {
    const oldT = makeFinancialTable({ headers: ['Metric', '2023', '2022'], rows: [{ label: 'Rev', values: ['$100', '$90'] }] });
    const newT = makeFinancialTable({ headers: ['Metric', '2024', '2023'], rows: [{ label: 'Rev', values: ['$120', '$100'] }] });

    const result = matchTables([oldT], [newT]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].similarity).toBeGreaterThanOrEqual(0.70);
  });

  it('position-weighted: same-ordinal match preferred over higher-similarity non-ordinal', () => {
    // Table A at pos 0, Table B at pos 1 in both old and new
    const oldA = makeFinancialTable({ headers: ['Balance Sheet', '2023'], rows: [{ label: 'Assets', values: ['$500'] }] });
    const oldB = makeFinancialTable({ headers: ['Income Statement', '2023'], rows: [{ label: 'Revenue', values: ['$100'] }] });
    const newA = makeFinancialTable({ headers: ['Balance Sheet', '2024'], rows: [{ label: 'Assets', values: ['$600'] }] });
    const newB = makeFinancialTable({ headers: ['Income Statement', '2024'], rows: [{ label: 'Revenue', values: ['$120'] }] });

    const result = matchTables([oldA, oldB], [newA, newB]);
    expect(result.matched).toHaveLength(2);
    // Each should match its positional counterpart
    expect(result.matched[0].oldTable).toBe(oldA);
    expect(result.matched[0].newTable).toBe(newA);
    expect(result.matched[1].oldTable).toBe(oldB);
    expect(result.matched[1].newTable).toBe(newB);
  });

  it('different-count tables: extra new table in added[], extra old in removed[]', () => {
    const old1 = makeFinancialTable({ headers: ['Metric', '2023'], rows: [{ label: 'Rev', values: ['$100'] }] });
    const new1 = makeFinancialTable({ headers: ['Metric', '2023'], rows: [{ label: 'Rev', values: ['$100'] }] });
    const new2 = makeFinancialTable({ headers: ['New Table', 'Data'], rows: [{ label: 'X', values: ['$10'] }] });

    const result = matchTables([old1], [new1, new2]);
    expect(result.matched).toHaveLength(1);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toBe(new2);
    expect(result.removed).toHaveLength(0);
  });

  it('no-header tables matched by position only', () => {
    const old1 = makeTable([makeTableRow([makeTableCell('A'), makeTableCell('B')])]);
    const new1 = makeTable([makeTableRow([makeTableCell('C'), makeTableCell('D')])]);

    const result = matchTables([old1], [new1]);
    expect(result.matched).toHaveLength(1);
  });

  it('completely different headers (below 0.70 threshold) => all added + removed', () => {
    const old1 = makeFinancialTable({ headers: ['Alpha', 'Beta', 'Gamma'], rows: [{ label: 'X', values: ['1', '2'] }] });
    const new1 = makeFinancialTable({ headers: ['Delta', 'Epsilon', 'Zeta'], rows: [{ label: 'Y', values: ['3', '4'] }] });

    const result = matchTables([old1], [new1]);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
  });

  it('custom similarityThreshold option is respected', () => {
    const old1 = makeFinancialTable({ headers: ['Revenue', '2023'], rows: [{ label: 'A', values: ['$1'] }] });
    const new1 = makeFinancialTable({ headers: ['Revenue', '2024'], rows: [{ label: 'A', values: ['$2'] }] });

    // Very high threshold should prevent matching
    const result = matchTables([old1], [new1], { similarityThreshold: 0.99 });
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
  });

  it('empty old tables => all new tables are added', () => {
    const new1 = makeFinancialTable({ headers: ['A'], rows: [{ label: 'X', values: [] }] });
    const result = matchTables([], [new1]);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
  });

  it('empty new tables => all old tables are removed', () => {
    const old1 = makeFinancialTable({ headers: ['A'], rows: [{ label: 'X', values: [] }] });
    const result = matchTables([old1], []);
    expect(result.matched).toHaveLength(0);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
  });

  it('single table in each list with matching headers => one match', () => {
    const old1 = makeFinancialTable({ headers: ['Revenue', '2023'], rows: [{ label: 'Total', values: ['$100'] }] });
    const new1 = makeFinancialTable({ headers: ['Revenue', '2023'], rows: [{ label: 'Total', values: ['$120'] }] });

    const result = matchTables([old1], [new1]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].oldTable).toBe(old1);
    expect(result.matched[0].newTable).toBe(new1);
  });

  it('header text is concatenated from all header rows for similarity', () => {
    const old1 = makeTable([
      makeTableRow([makeTableCell('Financial'), makeTableCell('Data')], { isHeader: true }),
      makeTableRow([makeTableCell('2023'), makeTableCell('2022')], { isHeader: true }),
      makeTableRow([makeTableCell('$100'), makeTableCell('$90')]),
    ]);
    const new1 = makeTable([
      makeTableRow([makeTableCell('Financial'), makeTableCell('Data')], { isHeader: true }),
      makeTableRow([makeTableCell('2024'), makeTableCell('2023')], { isHeader: true }),
      makeTableRow([makeTableCell('$120'), makeTableCell('$100')]),
    ]);

    const result = matchTables([old1], [new1]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].similarity).toBeGreaterThanOrEqual(0.70);
  });
});
