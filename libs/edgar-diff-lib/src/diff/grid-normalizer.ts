import type { Table } from '../types.js';
import type { NormalizedCell, NormalizedGrid } from './types.js';

/**
 * Expand colspan/rowspan into a flat rectangular grid so that every
 * (row, col) coordinate maps to exactly one logical cell.
 */
export function normalizeGrid(table: Table): NormalizedGrid {
  const rowCount = table.rows.length;
  if (rowCount === 0) {
    return { cells: [], rowCount: 0, colCount: 0, table };
  }

  // First pass: determine grid dimensions by simulating placement
  // We need to know colCount before we can build the grid, but colCount
  // depends on colspan expansion. Do a two-pass approach.
  const grid: (NormalizedCell | null)[][] = [];
  for (let r = 0; r < rowCount; r++) {
    grid[r] = [];
  }

  let maxCol = 0;

  for (let r = 0; r < rowCount; r++) {
    let col = 0;
    for (const cell of table.rows[r].cells) {
      // Find next unoccupied column
      while (grid[r][col] !== undefined && grid[r][col] !== null) {
        col++;
      }
      // Wait — grid[r][col] could be undefined (not yet set) which means free

      const rs = Math.min(cell.rowspan, rowCount - r); // clamp rowspan
      const cs = cell.colspan;

      // Fill the span block
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          const targetRow = r + dr;
          const targetCol = col + dc;
          if (targetRow < rowCount) {
            // Ensure array is wide enough
            while (grid[targetRow].length <= targetCol) {
              grid[targetRow].push(null);
            }
            // Skip if already occupied (malformed HTML)
            if (grid[targetRow][targetCol] === null || grid[targetRow][targetCol] === undefined) {
              grid[targetRow][targetCol] = {
                cell,
                isOrigin: dr === 0 && dc === 0,
              };
            }
          }
        }
      }

      if (col + cs > maxCol) {
        maxCol = col + cs;
      }

      col += cs;
    }
  }

  // Pad all rows to maxCol width with null
  const colCount = maxCol;
  for (let r = 0; r < rowCount; r++) {
    while (grid[r].length < colCount) {
      grid[r].push(null);
    }
    // Also ensure any undefined slots become null
    for (let c = 0; c < colCount; c++) {
      if (grid[r][c] === undefined) {
        grid[r][c] = null;
      }
    }
  }

  return { cells: grid, rowCount, colCount, table };
}
