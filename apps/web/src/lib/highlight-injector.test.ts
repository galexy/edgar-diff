import { describe, it, expect } from 'vitest';
import type { WordChange, ParagraphDiff, SectionDiff, Paragraph } from '@edgar-diff/lib';
import { wrapParagraph, injectWordHighlights, applyHighlightsToSection } from './highlight-injector';

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
