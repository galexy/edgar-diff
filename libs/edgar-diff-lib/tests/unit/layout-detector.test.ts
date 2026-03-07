import { describe, it, expect } from 'vitest';
import { parseDocument } from 'htmlparser2';
import type { Element } from 'domhandler';
import { isTag } from 'domhandler';
import { isLayoutTable } from '../../src/parser/layout-detector.js';

/** Find the first <table> element in a parsed document. */
function findTable(node: import('domhandler').Node): Element | null {
  if (isTag(node) && node.name.toLowerCase() === 'table') return node;
  if ('children' in node) {
    for (const child of (node as Element).children) {
      const result = findTable(child);
      if (result) return result;
    }
  }
  return null;
}

describe('isLayoutTable', () => {
  it('simple data table (no nested tables) returns false', () => {
    const doc = parseDocument(
      '<table><tr><td>Revenue</td><td>$100B</td></tr></table>',
      { withStartIndices: true, withEndIndices: true },
    );
    const table = findTable(doc)!;
    expect(table).not.toBeNull();
    expect(isLayoutTable(table)).toBe(false);
  });

  it('table with nested table inside a cell returns true', () => {
    const doc = parseDocument(
      '<table><tr><td><table><tr><td>Inner</td></tr></table></td></tr></table>',
      { withStartIndices: true, withEndIndices: true },
    );
    const table = findTable(doc)!;
    expect(isLayoutTable(table)).toBe(true);
  });

  it('table with deeply nested table (table > tbody > tr > td > div > table) returns true', () => {
    const doc = parseDocument(
      '<table><tbody><tr><td><div><table><tr><td>Deep</td></tr></table></div></td></tr></tbody></table>',
      { withStartIndices: true, withEndIndices: true },
    );
    const table = findTable(doc)!;
    expect(isLayoutTable(table)).toBe(true);
  });

  it('empty table returns false', () => {
    const doc = parseDocument(
      '<table></table>',
      { withStartIndices: true, withEndIndices: true },
    );
    const table = findTable(doc)!;
    expect(table).not.toBeNull();
    expect(isLayoutTable(table)).toBe(false);
  });

  it('table with non-table elements only returns false', () => {
    const doc = parseDocument(
      '<table><tr><td><div><p>Text</p><span>More</span></div></td></tr></table>',
      { withStartIndices: true, withEndIndices: true },
    );
    const table = findTable(doc)!;
    expect(isLayoutTable(table)).toBe(false);
  });
});
