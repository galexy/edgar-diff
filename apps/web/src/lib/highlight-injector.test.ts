import { describe, it, expect } from 'vitest';
import type { WordChange, ParagraphDiff, SectionDiff, Paragraph, CellDiff, RowDiff, TableDiff, Table, TableRow, TableCell } from '@edgar-diff/lib';
import { wrapParagraph, injectWordHighlights, applyHighlightsToSection, injectClass, escapeHtml, highlightCell } from './highlight-injector';

// ─── 2.7 wrapParagraph ──────────────────────────────────────────

describe('wrapParagraph', () => {
  it('WP-U1: wraps HTML in <ins class="diff-paragraph-added"> for added', () => {
    const html = '<p>New paragraph content</p>';
    const result = wrapParagraph(html, 'added');
    expect(result).toBe('<ins class="diff-paragraph-added"><p>New paragraph content</p></ins>');
  });

  it('WP-U2: wraps HTML in <del class="diff-paragraph-removed"> for removed', () => {
    const html = '<p>Old paragraph content</p>';
    const result = wrapParagraph(html, 'removed');
    expect(result).toBe('<del class="diff-paragraph-removed"><p>Old paragraph content</p></del>');
  });

  it('WP-U3: wraps empty paragraph HTML without error', () => {
    const html = '<p></p>';
    const resultAdded = wrapParagraph(html, 'added');
    const resultRemoved = wrapParagraph(html, 'removed');
    expect(resultAdded).toBe('<ins class="diff-paragraph-added"><p></p></ins>');
    expect(resultRemoved).toBe('<del class="diff-paragraph-removed"><p></p></del>');
  });
});

// ─── 2.1 injectWordHighlights — basic cases ─────────────────────

describe('injectWordHighlights — basic cases', () => {
  it('IW-U1: wraps a removed word in <del class="diff-removed">', () => {
    const html = 'The quick brown fox';
    const text = 'The quick brown fox';
    const changes: WordChange[] = [{ type: 'removed', start: 4, end: 9 }]; // "quick"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toBe('The <del class="diff-removed">quick</del> brown fox');
  });

  it('IW-U2: wraps an added word in <ins class="diff-added">', () => {
    const html = 'The quick brown fox';
    const text = 'The quick brown fox';
    const changes: WordChange[] = [{ type: 'added', start: 4, end: 9 }]; // "quick"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toBe('The <ins class="diff-added">quick</ins> brown fox');
  });

  it('IW-U3: preserves surrounding HTML unchanged', () => {
    const html = 'The quick brown fox';
    const text = 'The quick brown fox';
    const changes: WordChange[] = [{ type: 'removed', start: 10, end: 15 }]; // "brown"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('The quick ');
    expect(result).toContain(' fox');
    expect(result).toContain('<del class="diff-removed">brown</del>');
    // No wrappers on unchanged text ("The quick " is not itself wrapped)
    expect(result).not.toMatch(/<(ins|del)[^>]*>The quick/);
  });

  it('IW-U4: returns original HTML when wordChanges array is empty', () => {
    const html = 'The quick brown fox';
    const text = 'The quick brown fox';
    const result = injectWordHighlights(html, [], text);
    expect(result).toBe('The quick brown fox');
  });
});

// ─── 2.2 injectWordHighlights — multiple changes ────────────────

describe('injectWordHighlights — multiple changes', () => {
  it('IW-U5: multiple non-contiguous changes produce separate wrappers', () => {
    const html = 'The quick brown fox jumps';
    const text = 'The quick brown fox jumps';
    const changes: WordChange[] = [
      { type: 'removed', start: 4, end: 9 },   // "quick"
      { type: 'removed', start: 16, end: 19 },  // "fox"
    ];
    const result = injectWordHighlights(html, changes, text);
    expect(result).toBe(
      'The <del class="diff-removed">quick</del> brown <del class="diff-removed">fox</del> jumps',
    );
  });

  it('IW-U6: adjacent changes (no gap) produce separate wrappers', () => {
    const html = 'AB';
    const text = 'AB';
    const changes: WordChange[] = [
      { type: 'removed', start: 0, end: 1 }, // "A"
      { type: 'added', start: 1, end: 2 },   // "B"
    ];
    const result = injectWordHighlights(html, changes, text);
    expect(result).toBe('<del class="diff-removed">A</del><ins class="diff-added">B</ins>');
  });
});

// ─── 2.3 injectWordHighlights — nested HTML tags ────────────────

describe('injectWordHighlights — nested HTML tags', () => {
  it('IW-U7: change spanning <b> boundary produces multiple <del> elements', () => {
    const html = 'The <b>quick brown</b> fox';
    const text = 'The quick brown fox';
    const changes: WordChange[] = [{ type: 'removed', start: 4, end: 15 }]; // "quick brown"
    const result = injectWordHighlights(html, changes, text);
    // Each text node wrapped independently within its parent
    expect(result).toBe('The <b><del class="diff-removed">quick brown</del></b> fox');
  });

  it('IW-U8: change entirely within a nested tag produces single wrapper', () => {
    const html = 'The <b>quick brown</b> fox';
    const text = 'The quick brown fox';
    const changes: WordChange[] = [{ type: 'removed', start: 4, end: 9 }]; // "quick"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toBe('The <b><del class="diff-removed">quick</del> brown</b> fox');
  });

  it('IW-U9: deeply nested tags — change spanning across <i> boundary', () => {
    const html = 'A <span><b>bold <i>italic</i></b></span> end';
    const text = 'A bold italic end';
    const changes: WordChange[] = [{ type: 'removed', start: 2, end: 13 }]; // "bold italic"
    const result = injectWordHighlights(html, changes, text);
    // "bold " is in one text node under <b>, "italic" is in another under <i>
    expect(result).toContain('<del class="diff-removed">bold </del>');
    expect(result).toContain('<del class="diff-removed">italic</del>');
    expect(result).not.toContain('A <del');
    expect(result).toContain('A ');
    expect(result).toContain(' end');
  });

  it('IW-U10: all original tags preserved in output after injection', () => {
    const html = 'The <b>quick brown</b> fox';
    const text = 'The quick brown fox';
    const changes: WordChange[] = [{ type: 'removed', start: 4, end: 9 }];
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<b>');
    expect(result).toContain('</b>');
  });
});

// ─── 2.4 injectWordHighlights — HTML entities ───────────────────

describe('injectWordHighlights — HTML entities', () => {
  it('IW-U11: &amp; entity — highlight wraps correctly', () => {
    const html = 'Revenue &amp; growth';
    const text = 'Revenue & growth';
    const changes: WordChange[] = [{ type: 'removed', start: 8, end: 9 }]; // "&"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del class="diff-removed">');
    expect(result).toContain('&amp;');
  });

  it('IW-U12: &lt;/&gt; entities — highlight on entity character', () => {
    const html = 'a &lt; b &gt; c';
    const text = 'a < b > c';
    const changes: WordChange[] = [{ type: 'removed', start: 2, end: 3 }]; // "<"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del class="diff-removed">');
  });

  it('IW-U13: &#160; (NBSP) normalized to space — offsets still align', () => {
    const html = 'hello\u00a0world';
    const text = 'hello world';
    const changes: WordChange[] = [{ type: 'removed', start: 6, end: 11 }]; // "world"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del class="diff-removed">world</del>');
  });
});

// ─── 2.5 injectWordHighlights — <br> handling ───────────────────

describe('injectWordHighlights — <br> handling', () => {
  it('IW-U14: change spanning across <br> — text wraps correctly, <br> preserved', () => {
    const html = 'Line one<br>Line two';
    const text = 'Line one Line two';
    const changes: WordChange[] = [{ type: 'removed', start: 5, end: 13 }]; // "one Line"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del class="diff-removed">one</del>');
    expect(result).toContain('<br>');
    expect(result).toContain('<del class="diff-removed">Line</del>');
  });
});

// ─── 2.6 injectWordHighlights — normalization sanity ────────────

describe('injectWordHighlights — normalization', () => {
  it('IW-U15: NBSP in HTML is normalized to space — word change at correct offset', () => {
    const html = 'hello\u00a0world';
    const text = 'hello world';
    const changes: WordChange[] = [{ type: 'added', start: 0, end: 5 }]; // "hello"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<ins class="diff-added">hello</ins>');
  });

  it('IW-U16: multiple consecutive spaces collapsed — offset mapping accounts for collapse', () => {
    const html = 'hello   world';
    const text = 'hello world';
    const changes: WordChange[] = [{ type: 'removed', start: 6, end: 11 }]; // "world"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del class="diff-removed">world</del>');
  });

  it('IW-U17: leading/trailing whitespace trimmed — offsets relative to trimmed text', () => {
    const html = '  hello world  ';
    const text = 'hello world';
    const changes: WordChange[] = [{ type: 'removed', start: 0, end: 5 }]; // "hello"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del class="diff-removed">hello</del>');
  });

  it('IW-U18: normalized text mismatch — returns original HTML as safety fallback', () => {
    const html = 'hello world';
    const text = 'COMPLETELY DIFFERENT TEXT';
    const changes: WordChange[] = [{ type: 'removed', start: 0, end: 5 }];
    const result = injectWordHighlights(html, changes, text);
    expect(result).toBe('hello world');
  });
});

// ─── 2.8 applyHighlightsToSection ───────────────────────────────

function makeParagraph(text: string, start: number, end: number): Paragraph {
  return { type: 'paragraph', text, source: { start, end } };
}

function makeParagraphDiff(
  changeType: ParagraphDiff['changeType'],
  oldLoc?: { start: number; end: number },
  newLoc?: { start: number; end: number },
  wordChanges?: WordChange[],
): ParagraphDiff {
  return {
    changeType,
    wordChanges,
    sourceMapping: {
      old: oldLoc ? { start: oldLoc.start, end: oldLoc.end } : undefined,
      new: newLoc ? { start: newLoc.start, end: newLoc.end } : undefined,
    },
  };
}

function makeSectionDiff(
  id: string,
  paragraphDiffs: ParagraphDiff[],
  changeType: SectionDiff['changeType'] = 'modified',
): SectionDiff {
  return {
    id,
    heading: id,
    changeType,
    paragraphDiffs,
    tableDiffs: [],
    subsectionDiffs: [],
    sourceMapping: { old: { start: 0, end: 100 }, new: { start: 0, end: 100 } },
  };
}

describe('applyHighlightsToSection', () => {
  it('AS-U1: added paragraph on new side gets <ins class="diff-paragraph-added"> wrapping', () => {
    // Section HTML: <p>Hello world</p>
    // The paragraph source in the filing is at absolute offsets 100..119
    // Section starts at offset 100, so relative offset is 0..19
    const sectionHtml = '<p>Hello world</p>';
    const sectionOffset = 100;

    const paragraphDiff = makeParagraphDiff(
      'added',
      undefined, // no old source (it's new)
      { start: 100, end: 118 }, // new source
    );

    const sectionDiff = makeSectionDiff('item-1', [paragraphDiff]);

    const paragraphIndex = new Map<string, Paragraph>();
    paragraphIndex.set('100:118', makeParagraph('Hello world', 100, 118));

    const result = applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, 'new');
    expect(result).toContain('<ins class="diff-paragraph-added">');
    expect(result).toContain('Hello world');
  });

  it('AS-U2: unchanged paragraphs pass through unmodified', () => {
    const sectionHtml = '<p>Unchanged text</p>';
    const sectionOffset = 0;

    const paragraphDiff = makeParagraphDiff(
      'unchanged',
      { start: 0, end: 21 },
      { start: 0, end: 21 },
    );

    const sectionDiff = makeSectionDiff('item-1', [paragraphDiff]);

    const paragraphIndex = new Map<string, Paragraph>();
    paragraphIndex.set('0:21', makeParagraph('Unchanged text', 0, 21));

    const result = applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, 'old');
    expect(result).toBe(sectionHtml);
  });

  it('AS-U3: multiple paragraphs in section processed correctly', () => {
    const sectionHtml = '<p>First para</p><p>Second para</p>';
    const sectionOffset = 0;

    const p1End = '<p>First para</p>'.length;

    const paragraphDiffs: ParagraphDiff[] = [
      makeParagraphDiff('removed', { start: 0, end: p1End }, undefined),
      makeParagraphDiff('added', undefined, { start: p1End, end: sectionHtml.length }),
    ];

    const sectionDiff = makeSectionDiff('item-1', paragraphDiffs);

    const paragraphIndex = new Map<string, Paragraph>();
    paragraphIndex.set(`0:${p1End}`, makeParagraph('First para', 0, p1End));
    paragraphIndex.set(`${p1End}:${sectionHtml.length}`, makeParagraph('Second para', p1End, sectionHtml.length));

    const resultOld = applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, 'old');
    expect(resultOld).toContain('<del class="diff-paragraph-removed">');
    expect(resultOld).toContain('First para');
    // Added paragraph should not show on old side (no old source)
    expect(resultOld).not.toContain('<ins');

    const resultNew = applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, 'new');
    expect(resultNew).toContain('<ins class="diff-paragraph-added">');
    expect(resultNew).toContain('Second para');
    // Removed paragraph should not show on new side (no new source)
    expect(resultNew).not.toContain('<del');
  });

  it('AS-U4: sectionOffset > 0 — absolute SourceLocation offsets converted to relative', () => {
    const sectionHtml = '<p>Content here</p>';
    const sectionOffset = 500; // Section starts at byte 500 in the filing HTML

    const paragraphDiff = makeParagraphDiff(
      'removed',
      { start: 500, end: 519 }, // absolute offsets
      undefined,
    );

    const sectionDiff = makeSectionDiff('item-1', [paragraphDiff]);

    const paragraphIndex = new Map<string, Paragraph>();
    paragraphIndex.set('500:519', makeParagraph('Content here', 500, 519));

    const result = applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, 'old');
    expect(result).toContain('<del class="diff-paragraph-removed">');
  });

  it('AS-U5: WordChanges filtered by side — old shows removed, new shows added', () => {
    const sectionHtml = '<p>The quick brown fox</p>';
    const sectionOffset = 0;

    const paragraphDiff = makeParagraphDiff(
      'modified',
      { start: 0, end: 25 },
      { start: 0, end: 25 },
      [
        { type: 'removed', start: 4, end: 9 },  // "quick" removed from old
        { type: 'added', start: 4, end: 8 },     // "fast" added in new
      ],
    );

    const sectionDiff = makeSectionDiff('item-1', [paragraphDiff]);

    const paragraphIndex = new Map<string, Paragraph>();
    paragraphIndex.set('0:25', makeParagraph('The quick brown fox', 0, 25));

    // Old side should only show removals
    const resultOld = applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, 'old');
    expect(resultOld).toContain('<del class="diff-removed">');
    expect(resultOld).not.toContain('<ins');

    // New side should only show additions
    const resultNew = applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, 'new');
    expect(resultNew).toContain('<ins class="diff-added">');
    expect(resultNew).not.toContain('<del');
  });
});

// ─── 3.1 injectClass — CSS class injection ──────────────────────

describe('injectClass', () => {
  it('IC-U1: injects class into <tr> without existing class attribute', () => {
    expect(injectClass('<tr>', 'diff-row-added')).toBe('<tr class="diff-row-added">');
  });

  it('IC-U2: appends class to <td class="existing">', () => {
    expect(injectClass('<td class="existing">', 'diff-cell-modified')).toBe(
      '<td class="existing diff-cell-modified">',
    );
  });

  it('IC-U3: injects class into <th> tag correctly', () => {
    expect(injectClass('<th>', 'diff-cell-added')).toBe('<th class="diff-cell-added">');
  });

  it('IC-U4: preserves other attributes (style, colspan, rowspan, id)', () => {
    const tag = '<td style="color:red" colspan="2" rowspan="3" id="c1">';
    const result = injectClass(tag, 'diff-cell-modified');
    expect(result).toContain('class="diff-cell-modified"');
    expect(result).toContain('style="color:red"');
    expect(result).toContain('colspan="2"');
    expect(result).toContain('rowspan="3"');
    expect(result).toContain('id="c1"');
  });

  it("IC-U5: handles single-quoted class attribute: <td class='num'>", () => {
    expect(injectClass("<td class='num'>", 'diff-cell-added')).toBe(
      "<td class='num diff-cell-added'>",
    );
  });

  it('IC-U6: handles tag with no attributes: <td>', () => {
    expect(injectClass('<td>', 'diff-cell-removed')).toBe('<td class="diff-cell-removed">');
  });

  it('IC-U7: handles tag with only style attribute', () => {
    const result = injectClass('<td style="color:red">', 'diff-cell-modified');
    expect(result).toContain('class="diff-cell-modified"');
    expect(result).toContain('style="color:red"');
  });

  it('IC-U8: case-insensitive tag matching: <TR>, <TD>, <TH>', () => {
    expect(injectClass('<TR>', 'diff-row-added')).toBe('<TR class="diff-row-added">');
    expect(injectClass('<TD>', 'diff-cell-added')).toBe('<TD class="diff-cell-added">');
    expect(injectClass('<TH>', 'diff-cell-added')).toBe('<TH class="diff-cell-added">');
  });
});

// ─── 3.2 escapeHtml ─────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes & to &amp;', () => {
    expect(escapeHtml('AT&T')).toBe('AT&amp;T');
  });

  it('escapes < and > to &lt; and &gt;', () => {
    expect(escapeHtml('a < b > c')).toBe('a &lt; b &gt; c');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes all special characters together', () => {
    expect(escapeHtml('a & b < c > d " e \' f')).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('$1,234')).toBe('$1,234');
  });
});

// ─── 3.3 highlightCell — single cell highlighting ───────────────

function makeCellDiff(
  changeType: CellDiff['changeType'],
  opts: {
    oldSource?: { start: number; end: number };
    newSource?: { start: number; end: number };
    oldValue?: string;
    newValue?: string;
  } = {},
): CellDiff {
  return {
    row: 0,
    col: 0,
    changeType,
    oldValue: opts.oldValue,
    newValue: opts.newValue,
    sourceMapping: {
      old: opts.oldSource,
      new: opts.newSource,
    },
  };
}

describe('highlightCell', () => {
  it('HC-U1: added cell injects diff-cell-added class, preserves inner content', () => {
    const html = '<td>$1,234</td>';
    const result = highlightCell(html, makeCellDiff('added'), 'new');
    expect(result).toBe('<td class="diff-cell-added">$1,234</td>');
  });

  it('HC-U2: removed cell injects diff-cell-removed class, preserves inner content', () => {
    const html = '<td>$1,000</td>';
    const result = highlightCell(html, makeCellDiff('removed'), 'old');
    expect(result).toBe('<td class="diff-cell-removed">$1,000</td>');
  });

  it('HC-U3: modified cell on new side gets diff-cell-added (green), preserves content', () => {
    const cd = makeCellDiff('modified', { oldValue: '$1,000', newValue: '$1,234' });
    const html = '<td>$1,234</td>';
    const result = highlightCell(html, cd, 'new');
    expect(result).toBe('<td class="diff-cell-added">$1,234</td>');
    expect(result).not.toContain('<del');
    expect(result).not.toContain('<ins');
  });

  it('HC-U4: modified cell on old side gets diff-cell-removed (red), preserves content', () => {
    const cd = makeCellDiff('modified', { oldValue: '$1,000', newValue: '$1,234' });
    const html = '<td>$1,000</td>';
    const result = highlightCell(html, cd, 'old');
    expect(result).toBe('<td class="diff-cell-removed">$1,000</td>');
    expect(result).not.toContain('<del');
    expect(result).not.toContain('<ins');
  });

  it('HC-U5: modified cell preserves original inner content unchanged', () => {
    const cd = makeCellDiff('modified', { oldValue: '$1,000', newValue: '$1,234' });
    const html = '<td>$1,234</td>';
    const result = highlightCell(html, cd, 'new');
    expect(result).toContain('$1,234</td>');
    expect(result).not.toContain('→');
  });

  it('HC-U7: modified cell with <th> tag on old side — correct class and tag preserved', () => {
    const cd = makeCellDiff('modified', { oldValue: 'Revenue', newValue: 'Net Revenue' });
    const html = '<th>Revenue</th>';
    const result = highlightCell(html, cd, 'old');
    expect(result).toBe('<th class="diff-cell-removed">Revenue</th>');
  });

  it('HC-U9: unchanged cell returns original HTML unmodified', () => {
    const html = '<td>$1,234</td>';
    const result = highlightCell(html, makeCellDiff('unchanged'), 'new');
    expect(result).toBe(html);
  });

  it('HC-U10: cell with existing class — diff-cell-* class appended via injectClass', () => {
    const html = '<td class="num">$1,234</td>';
    const result = highlightCell(html, makeCellDiff('added'), 'new');
    expect(result).toBe('<td class="num diff-cell-added">$1,234</td>');
  });
});

// ─── 3.4 Backward Compatibility — MX-U tests ────────────────────

describe('applyHighlightsToSection — backward compatibility (MX-U)', () => {
  it('MX-U4: existing paragraph highlight tests still pass without tableIndex parameter', () => {
    // Verify that the 5-argument signature still works (tableIndex defaults to empty Map)
    const sectionHtml = '<p>Hello world</p>';
    const sectionOffset = 0;

    const paragraphDiff = makeParagraphDiff(
      'added',
      undefined,
      { start: 0, end: 18 },
    );

    const sectionDiff = makeSectionDiff('item-1', [paragraphDiff]);

    const paragraphIndex = new Map<string, Paragraph>();
    paragraphIndex.set('0:18', makeParagraph('Hello world', 0, 18));

    // Call with 5 args (no tableIndex) — should still work
    const result = applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, 'new');
    expect(result).toContain('<ins class="diff-paragraph-added">');
    expect(result).toContain('Hello world');
  });
});

// ─── 3.5 applyHighlightsToSection — table processing (AT-U) ────

function makeTableRow(cells: TableCell[], start: number, end: number, isHeader = false): TableRow {
  return { cells, isHeader, source: { start, end } };
}

function makeTableCell(text: string, start: number, end: number): TableCell {
  return { text, colspan: 1, rowspan: 1, source: { start, end } };
}

function makeTable(rows: TableRow[], start: number, end: number): Table {
  return { type: 'table', rows, source: { start, end } };
}

function makeRowDiff(
  changeType: RowDiff['changeType'],
  cellDiffs: CellDiff[],
  oldRowIndex?: number,
  newRowIndex?: number,
): RowDiff {
  return { changeType, cellDiffs, oldRowIndex, newRowIndex };
}

function makeTableDiff(
  changeType: TableDiff['changeType'],
  rowDiffs: RowDiff[],
  oldSource?: { start: number; end: number },
  newSource?: { start: number; end: number },
): TableDiff {
  return {
    changeType,
    rowDiffs,
    cellDiffs: rowDiffs.flatMap((rd) => rd.cellDiffs),
    sourceMapping: { old: oldSource, new: newSource },
    summary: { rowsAdded: 0, rowsRemoved: 0, rowsModified: 0, rowsUnchanged: 0, cellsChanged: 0 },
  };
}

function makeSectionDiffWithTables(
  id: string,
  paragraphDiffs: ParagraphDiff[],
  tableDiffs: TableDiff[],
  changeType: SectionDiff['changeType'] = 'modified',
): SectionDiff {
  return {
    id,
    heading: id,
    changeType,
    paragraphDiffs,
    tableDiffs,
    subsectionDiffs: [],
    sourceMapping: { old: { start: 0, end: 1000 }, new: { start: 0, end: 1000 } },
  };
}

describe('applyHighlightsToSection — table processing', () => {
  it('AT-U1: single modified cell on new side gets diff-cell-added class, preserves content', () => {
    const html = '<table><tr><td>$1,000</td><td>$2,000</td></tr></table>';
    const tdStart = html.indexOf('<td>$1,000');
    const tdEnd = html.indexOf('</td>') + 5;

    const cd = makeCellDiff('modified', {
      oldValue: '$900',
      newValue: '$1,000',
      newSource: { start: tdStart, end: tdEnd },
    });
    const rd = makeRowDiff('modified', [cd], 0, 0);
    const td = makeTableDiff('modified', [rd],
      { start: 0, end: html.length },
      { start: 0, end: html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);

    const table = makeTable(
      [makeTableRow(
        [makeTableCell('$1,000', tdStart, tdEnd), makeTableCell('$2,000', tdEnd, html.indexOf('</tr>'))],
        html.indexOf('<tr>'), html.indexOf('</tr>') + 5,
      )],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'new', tableIndex);
    expect(result).toContain('diff-cell-added');
    expect(result).toContain('$1,000</td>');
    expect(result).not.toContain('<del');
    expect(result).not.toContain('<ins');
  });

  it('AT-U2: multiple modified cells each get class, original content preserved', () => {
    const html = '<table><tr><td>A</td><td>B</td></tr></table>';
    const td1Start = html.indexOf('<td>A');
    const td1End = html.indexOf('</td>') + 5;
    const td2Start = html.indexOf('<td>B');
    const td2End = html.indexOf('</td>', td2Start) + 5;

    const cd1 = makeCellDiff('modified', {
      oldValue: 'X', newValue: 'A',
      newSource: { start: td1Start, end: td1End },
    });
    const cd2 = makeCellDiff('modified', {
      oldValue: 'Y', newValue: 'B',
      newSource: { start: td2Start, end: td2End },
    });
    const rd = makeRowDiff('modified', [cd1, cd2], 0, 0);
    const td = makeTableDiff('modified', [rd],
      { start: 0, end: html.length },
      { start: 0, end: html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow(
        [makeTableCell('A', td1Start, td1End), makeTableCell('B', td2Start, td2End)],
        html.indexOf('<tr>'), html.indexOf('</tr>') + 5,
      )],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'new', tableIndex);
    expect(result).toContain('diff-cell-added');
    expect(result).toContain('A</td>');
    expect(result).toContain('B</td>');
    expect(result).not.toContain('<del');
    expect(result).not.toContain('<ins');
  });

  it('AT-U3: added row on new side gets diff-row-added class', () => {
    const html = '<table><tr><td>Row1</td></tr></table>';
    const trStart = html.indexOf('<tr>');
    const trEnd = html.indexOf('</tr>') + 5;

    const rd = makeRowDiff('added', [], undefined, 0);
    const td = makeTableDiff('modified', [rd],
      undefined,
      { start: 0, end: html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow([makeTableCell('Row1', html.indexOf('<td>'), html.indexOf('</td>') + 5)], trStart, trEnd)],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'new', tableIndex);
    expect(result).toContain('diff-row-added');
  });

  it('AT-U4: removed row on old side gets diff-row-removed class', () => {
    const html = '<table><tr><td>OldRow</td></tr></table>';
    const trStart = html.indexOf('<tr>');
    const trEnd = html.indexOf('</tr>') + 5;

    const rd = makeRowDiff('removed', [], 0, undefined);
    const td = makeTableDiff('modified', [rd],
      { start: 0, end: html.length },
      undefined,
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow([makeTableCell('OldRow', html.indexOf('<td>'), html.indexOf('</td>') + 5)], trStart, trEnd)],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'old', tableIndex);
    expect(result).toContain('diff-row-removed');
  });

  it('AT-U5: added row does NOT also get cell-level classes (no double-highlighting)', () => {
    const html = '<table><tr><td>A</td><td>B</td></tr></table>';
    const trStart = html.indexOf('<tr>');
    const trEnd = html.indexOf('</tr>') + 5;
    const td1Start = html.indexOf('<td>A');
    const td1End = html.indexOf('</td>') + 5;
    const td2Start = html.indexOf('<td>B');
    const td2End = html.indexOf('</td>', td2Start) + 5;

    // Row is 'added' but cellDiffs also have 'added' cells — cell diffs should be ignored
    const cd1 = makeCellDiff('added', { newSource: { start: td1Start, end: td1End } });
    const cd2 = makeCellDiff('added', { newSource: { start: td2Start, end: td2End } });
    const rd = makeRowDiff('added', [cd1, cd2], undefined, 0);
    const td = makeTableDiff('modified', [rd],
      undefined,
      { start: 0, end: html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow([
        makeTableCell('A', td1Start, td1End),
        makeTableCell('B', td2Start, td2End),
      ], trStart, trEnd)],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'new', tableIndex);
    // Row-level class should be present
    expect(result).toContain('diff-row-added');
    // Cell-level classes should NOT be present (no double-highlighting)
    expect(result).not.toContain('diff-cell-added');
    expect(result).not.toContain('diff-cell-removed');
  });

  it('AT-U6: sectionOffset > 0 — absolute offsets converted to relative', () => {
    const html = '<table><tr><td>Val</td></tr></table>';
    const sectionOffset = 500;
    const tdStart = html.indexOf('<td>') + sectionOffset;
    const tdEnd = html.indexOf('</td>') + 5 + sectionOffset;

    const cd = makeCellDiff('added', {
      newSource: { start: tdStart, end: tdEnd },
    });
    const rd = makeRowDiff('modified', [cd], 0, 0);
    const td = makeTableDiff('modified', [rd],
      { start: sectionOffset, end: sectionOffset + html.length },
      { start: sectionOffset, end: sectionOffset + html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow(
        [makeTableCell('Val', tdStart, tdEnd)],
        html.indexOf('<tr>') + sectionOffset,
        html.indexOf('</tr>') + 5 + sectionOffset,
      )],
      sectionOffset, sectionOffset + html.length,
    );
    const tableIndex = new Map<string, Table>([
      [`${sectionOffset}:${sectionOffset + html.length}`, table],
    ]);

    const result = applyHighlightsToSection(html, sectionOffset, sd, new Map(), 'new', tableIndex);
    expect(result).toContain('diff-cell-added');
  });

  it('AT-U8: added row ignored on old side', () => {
    const html = '<table><tr><td>Row1</td></tr></table>';
    const rd = makeRowDiff('added', [], undefined, 0);
    const td = makeTableDiff('modified', [rd],
      undefined,
      { start: 0, end: html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow([makeTableCell('Row1', html.indexOf('<td>'), html.indexOf('</td>') + 5)],
        html.indexOf('<tr>'), html.indexOf('</tr>') + 5)],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    // old side — no old source on TableDiff, should skip entirely
    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'old', tableIndex);
    expect(result).not.toContain('diff-row-added');
    expect(result).not.toContain('diff-cell');
  });

  it('AT-U9: removed row ignored on new side', () => {
    const html = '<table><tr><td>Row1</td></tr></table>';
    const rd = makeRowDiff('removed', [], 0, undefined);
    const td = makeTableDiff('modified', [rd],
      { start: 0, end: html.length },
      undefined,
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow([makeTableCell('Row1', html.indexOf('<td>'), html.indexOf('</td>') + 5)],
        html.indexOf('<tr>'), html.indexOf('</tr>') + 5)],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    // new side — no new source on TableDiff, should skip entirely
    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'new', tableIndex);
    expect(result).not.toContain('diff-row-removed');
  });

  it('AT-U10: unchanged TableDiff — no classes injected', () => {
    const html = '<table><tr><td>Val</td></tr></table>';
    const rd = makeRowDiff('unchanged', [], 0, 0);
    const td = makeTableDiff('unchanged', [rd],
      { start: 0, end: html.length },
      { start: 0, end: html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow([makeTableCell('Val', html.indexOf('<td>'), html.indexOf('</td>') + 5)],
        html.indexOf('<tr>'), html.indexOf('</tr>') + 5)],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'new', tableIndex);
    expect(result).toBe(html);
  });

  it('AT-U11: tableIndex lookup failure — table diff skipped gracefully', () => {
    const html = '<table><tr><td>Val</td></tr></table>';
    const cd = makeCellDiff('modified', {
      oldValue: 'X', newValue: 'Val',
      newSource: { start: html.indexOf('<td>'), end: html.indexOf('</td>') + 5 },
    });
    const rd = makeRowDiff('modified', [cd], 0, 0);
    const td = makeTableDiff('modified', [rd],
      { start: 0, end: html.length },
      { start: 0, end: html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);

    // Empty tableIndex — lookup will fail
    const tableIndex = new Map<string, Table>();
    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'new', tableIndex);
    expect(result).toBe(html);
  });

  it('AT-U12: rowIndex out of bounds — row diff skipped gracefully', () => {
    const html = '<table><tr><td>Val</td></tr></table>';
    const rd = makeRowDiff('added', [], undefined, 99);
    const td = makeTableDiff('modified', [rd],
      { start: 0, end: html.length },
      { start: 0, end: html.length },
    );
    const sd = makeSectionDiffWithTables('s1', [], [td]);
    const table = makeTable(
      [makeTableRow([makeTableCell('Val', html.indexOf('<td>'), html.indexOf('</td>') + 5)],
        html.indexOf('<tr>'), html.indexOf('</tr>') + 5)],
      0, html.length,
    );
    const tableIndex = new Map<string, Table>([[`0:${html.length}`, table]]);

    const result = applyHighlightsToSection(html, 0, sd, new Map(), 'new', tableIndex);
    expect(result).toBe(html);
  });
});
