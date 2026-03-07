import type { Element } from 'domhandler';
import { isTag, isText } from 'domhandler';
import type { Table, TableRow, TableCell, SourceLocation } from '../types.js';
import type { ExtractionContext } from './types.js';

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
