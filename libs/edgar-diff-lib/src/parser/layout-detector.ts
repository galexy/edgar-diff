import type { Element } from 'domhandler';
import { isTag } from 'domhandler';

/**
 * Detect whether a <table> element is a layout wrapper rather than a data table.
 *
 * iXBRL filings commonly wrap the entire document (or large sections) in a
 * single outer <table> for layout purposes.  These wrapper tables contain
 * nested <table> elements that hold the actual financial data.  Treating the
 * outer wrapper as a single data table collapses all nested tables into one
 * monolithic block, hiding the real structure.
 *
 * Heuristic: a table is a layout wrapper when it contains at least one
 * descendant <table> element.  Real data tables in SEC filings virtually
 * never nest another <table> inside a cell.
 */
export function isLayoutTable(tableNode: Element): boolean {
  return hasNestedTable(tableNode);
}

function hasNestedTable(node: Element): boolean {
  for (const child of node.children) {
    if (!isTag(child)) continue;
    if (child.name.toLowerCase() === 'table') return true;
    if (hasNestedTable(child)) return true;
  }
  return false;
}
