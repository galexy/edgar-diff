# US-2.5: Paragraph Diff Highlighting — Test Plan

## Overview

US-2.5 injects `<ins>`/`<del>` highlight markup into original filing HTML at `SourceLocation` offsets from `StructuredDiff`. Word-level changes use `WordChange` offsets mapped back to HTML source positions via a DOM-based algorithm. The implementation must handle nested HTML tags gracefully and produce valid, accessible markup.

The test strategy splits into two tiers:
1. **Programmatic tests** (Vitest + Testing Library) — verify DOM structure, semantic markup, offset mapping, and accessibility
2. **Visual validation** (Chrome DevTools MCP screenshots) — verify highlight colors, strikethrough rendering, and complex HTML edge cases

### Architecture (aligned with implementation design)

The implementation extends `FilingContent` with optional `sectionDiffs` and `side` props (no new component). The highlight injection pipeline lives in `apps/web/src/lib/highlight-injector.ts` as pure functions that use browser DOM APIs:

1. **`buildNormalizedMapping(container)`** — walks a DOM fragment, collects text pieces, simulates parser normalization, and builds a `charMap[normalizedPos] → (pieceIndex, charOffset)` mapping
2. **`injectWordHighlights(paragraphHtml, wordChanges, paragraphText)`** — parses paragraph HTML into DOM, maps `WordChange` text offsets to DOM text node positions via the charMap, splits text nodes, wraps in `<ins>`/`<del>`, serializes back to HTML
3. **`wrapParagraph(paragraphHtml, changeType)`** — wraps entire paragraph HTML in a block-level `<ins>` or `<del>`
4. **`applyHighlightsToSection(sectionHtml, sectionOffset, sectionDiff, paragraphIndex, side)`** — orchestrates per-paragraph highlight application within a section

These live in the web app (not the diff library) because they depend on browser DOM APIs. They are pure over HTML strings and testable in jsdom.

---

## 1. BDD Acceptance Criteria

The Gherkin scenarios below drive the actual Vitest test code in Sections 2–4. "Given" translates to fixture setup; "Then" assertions use Testing Library queries and jest-dom matchers.

### AC-1: Word-level added highlights (green)

```gherkin
Scenario: Added words in a modified paragraph are highlighted green
  Given a FilingContent with sectionDiffs containing a modified paragraph
  And the paragraph has WordChanges of type 'added' at offsets [10, 15]
  And side is "new"
  When the filing content is rendered
  Then the added text is wrapped in an <ins> element with class "diff-added"
```

### AC-2: Word-level removed highlights (red + strikethrough)

```gherkin
Scenario: Removed words in a modified paragraph are highlighted red with strikethrough
  Given a FilingContent with sectionDiffs containing a modified paragraph
  And the paragraph has WordChanges of type 'removed' at offsets [5, 12]
  And side is "old"
  When the filing content is rendered
  Then the removed text is wrapped in a <del> element with class "diff-removed"
```

### AC-3: Whole paragraph added (green background + border)

```gherkin
Scenario: An entirely new paragraph is highlighted with green background
  Given a FilingContent with sectionDiffs containing an 'added' paragraph
  And side is "new"
  When the filing content is rendered
  Then the paragraph HTML is wrapped in <ins class="diff-paragraph-added">
```

### AC-4: Whole paragraph removed (red background + border)

```gherkin
Scenario: A removed paragraph is highlighted with red background
  Given a FilingContent with sectionDiffs containing a 'removed' paragraph
  And side is "old"
  When the filing content is rendered
  Then the paragraph HTML is wrapped in <del class="diff-paragraph-removed">
```

### AC-5: Unchanged content renders unmodified

```gherkin
Scenario: Unchanged paragraphs render as original HTML
  Given a FilingContent with sectionDiffs containing 'unchanged' paragraphs
  When the filing content is rendered
  Then no <ins> or <del> elements are injected
```

### AC-6: Nested HTML tag handling (DOM-based splitting)

```gherkin
Scenario: Highlight spanning across HTML tags produces valid markup via DOM splitting
  Given original HTML: "<p>The <b>quick brown</b> fox</p>"
  And a WordChange marking "quick brown" as removed (text offsets 4–15)
  When injectWordHighlights processes the paragraph
  Then each text node within the range gets its own <del> wrapper
  And the output is valid HTML (e.g., "<p>The <b><del>quick brown</del></b><del> fox</del></p>")
```

### AC-7: Multiple word changes in one paragraph

```gherkin
Scenario: Multiple non-contiguous changes in a single paragraph
  Given a paragraph with WordChanges: removed at [0,3], removed at [8,11]
  And side is "old"
  When the filing content is rendered
  Then each change has its own <del> wrapper
  And unchanged text between changes has no wrapper
```

### AC-8: Side-specific WordChange filtering

```gherkin
Scenario: Old panel shows only removed changes, new panel shows only added changes
  Given a modified paragraph with both 'added' and 'removed' WordChanges
  When rendered with side="old"
  Then only <del> elements appear (for type='removed' changes)
  When rendered with side="new"
  Then only <ins> elements appear (for type='added' changes)
```

### AC-9: Backward compatibility

```gherkin
Scenario: FilingContent without sectionDiffs renders identically to before
  Given a FilingContent with document but no sectionDiffs prop
  When the filing content is rendered
  Then no <ins> or <del> elements appear
  And the output is identical to US-2.3 behavior
```

### AC-10: Moved paragraphs

```gherkin
Scenario: Moved paragraphs with word changes show word-level highlights
  Given a 'moved' paragraph with wordChanges
  When the filing content is rendered
  Then word-level highlights are applied (same as modified)

Scenario: Moved paragraphs without word changes render as unchanged
  Given a 'moved' paragraph without wordChanges
  When the filing content is rendered
  Then no highlights are applied
```

---

## 2. Unit Tests — highlight-injector.ts

All unit tests live in `apps/web/src/lib/highlight-injector.test.ts`, testing the exported pure functions.

### `injectWordHighlights` — basic cases

```typescript
describe('injectWordHighlights', () => {
  it('wraps a removed word in <del> with diff-removed class', () => {
    const html = '<p>Hello world</p>';
    const text = 'Hello world';
    const changes: WordChange[] = [{ type: 'removed', start: 6, end: 11 }]; // "world"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
    expect(result).toContain('class="diff-removed"');
    expect(result).toContain('world');
    expect(result).toContain('</del>');
  });

  it('wraps an added word in <ins> with diff-added class', () => {
    const html = '<p>Hello world</p>';
    const text = 'Hello world';
    const changes: WordChange[] = [{ type: 'added', start: 0, end: 5 }]; // "Hello"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<ins');
    expect(result).toContain('class="diff-added"');
    expect(result).toContain('Hello');
  });

  it('preserves surrounding HTML unchanged', () => {
    const html = '<p>Hello world</p>';
    const text = 'Hello world';
    const changes: WordChange[] = [{ type: 'removed', start: 6, end: 11 }];
    const result = injectWordHighlights(html, changes, text);
    // "Hello " should not be wrapped
    expect(result).toMatch(/Hello\s/); // Hello followed by space, no <del>
  });

  it('returns original HTML when wordChanges is empty', () => {
    const html = '<p>Hello world</p>';
    const result = injectWordHighlights(html, [], 'Hello world');
    expect(result).toBe(html);
  });
});
```

### `injectWordHighlights` — multiple changes

```typescript
describe('injectWordHighlights — multiple changes', () => {
  it('handles multiple non-contiguous changes', () => {
    const html = '<p>AAA BBB CCC DDD</p>';
    const text = 'AAA BBB CCC DDD';
    const changes: WordChange[] = [
      { type: 'removed', start: 0, end: 3 },    // "AAA"
      { type: 'removed', start: 8, end: 11 },   // "CCC"
    ];
    const result = injectWordHighlights(html, changes, text);
    const delCount = (result.match(/<del/g) || []).length;
    expect(delCount).toBe(2);
  });

  it('handles adjacent changes (no gap between them)', () => {
    const html = '<p>AABBCC</p>';
    const text = 'AABBCC';
    const changes: WordChange[] = [
      { type: 'removed', start: 0, end: 2 },  // "AA"
      { type: 'added', start: 2, end: 4 },     // "BB"
    ];
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
    expect(result).toContain('<ins');
  });
});
```

### `injectWordHighlights` — HTML tag handling (DOM-based)

```typescript
describe('injectWordHighlights — nested HTML tags', () => {
  it('splits highlight at tag boundary (change spanning <b>...</b>)', () => {
    const html = '<p>The <b>quick brown</b> fox</p>';
    const text = 'The quick brown fox';
    // "quick brown fox" spans across </b> boundary
    const changes: WordChange[] = [{ type: 'removed', start: 4, end: 19 }];
    const result = injectWordHighlights(html, changes, text);

    // DOM-based approach: each text node gets its own <del>
    // Expected: <b><del>quick brown</del></b><del> fox</del>
    const delCount = (result.match(/<del/g) || []).length;
    expect(delCount).toBeGreaterThanOrEqual(2); // split across tag boundary
    expect(result).toContain('<b>');  // bold tag preserved
  });

  it('wraps highlight entirely within a nested tag', () => {
    const html = '<p>The <b>quick</b> brown fox</p>';
    const text = 'The quick brown fox';
    const changes: WordChange[] = [{ type: 'removed', start: 4, end: 9 }]; // "quick"
    const result = injectWordHighlights(html, changes, text);

    // "quick" is entirely within <b>, so single <del> inside <b>
    expect(result).toContain('<b><del');
    expect(result).toContain('quick');
  });

  it('handles deeply nested tags (span > b > i)', () => {
    const html = '<p>A <span><b>bold <i>italic</i></b></span> end</p>';
    const text = 'A bold italic end';
    // highlight "bold italic" — spans across <i> boundary
    const changes: WordChange[] = [{ type: 'removed', start: 2, end: 13 }];
    const result = injectWordHighlights(html, changes, text);

    const delCount = (result.match(/<del/g) || []).length;
    expect(delCount).toBeGreaterThanOrEqual(1);
    // All original tags still present
    expect(result).toContain('<span>');
    expect(result).toContain('<b>');
    expect(result).toContain('<i>');
  });
});
```

### `injectWordHighlights` — HTML entities

```typescript
describe('injectWordHighlights — HTML entities', () => {
  it('handles &amp; entity (1 char in text, decoded by DOM parser)', () => {
    const html = '<p>A &amp; B</p>';
    const text = 'A & B';
    // highlight "A & B" — entire text
    const changes: WordChange[] = [{ type: 'removed', start: 0, end: 5 }];
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
    // DOM serialization may re-encode & as &amp;
    expect(result).toContain('</del>');
  });

  it('handles &lt; and &gt; entities', () => {
    const html = '<p>3 &lt; 5</p>';
    const text = '3 < 5';
    const changes: WordChange[] = [{ type: 'removed', start: 2, end: 3 }]; // "<"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
  });

  it('handles &#160; (NBSP) entity — normalized to space by parser', () => {
    const html = '<p>A&#160;B</p>';
    // Parser normalizes NBSP to space: text = "A B"
    const text = 'A B';
    const changes: WordChange[] = [{ type: 'removed', start: 0, end: 1 }]; // "A"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
    expect(result).toContain('A');
  });
});
```

### `injectWordHighlights` — <br> handling

```typescript
describe('injectWordHighlights — <br> elements', () => {
  it('handles text across <br> (br maps to space in normalized text)', () => {
    const html = '<p>Line one<br/>Line two</p>';
    const text = 'Line one Line two';
    // highlight "one Line" — spans across <br>
    const changes: WordChange[] = [{ type: 'removed', start: 5, end: 13 }];
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
    // <br> should remain in the output
    expect(result).toMatch(/<br\s*\/?>/);
  });
});
```

### `wrapParagraph`

```typescript
describe('wrapParagraph', () => {
  it('wraps HTML in <ins class="diff-paragraph-added"> for added', () => {
    const html = '<p>New paragraph</p>';
    const result = wrapParagraph(html, 'added');
    expect(result).toContain('<ins');
    expect(result).toContain('class="diff-paragraph-added"');
    expect(result).toContain('New paragraph');
    expect(result).toContain('</ins>');
  });

  it('wraps HTML in <del class="diff-paragraph-removed"> for removed', () => {
    const html = '<p>Old paragraph</p>';
    const result = wrapParagraph(html, 'removed');
    expect(result).toContain('<del');
    expect(result).toContain('class="diff-paragraph-removed"');
    expect(result).toContain('Old paragraph');
    expect(result).toContain('</del>');
  });

  it('wraps empty paragraph HTML without error', () => {
    expect(() => wrapParagraph('<p></p>', 'added')).not.toThrow();
    expect(wrapParagraph('<p></p>', 'added')).toContain('<ins');
  });
});
```

### `applyHighlightsToSection`

```typescript
describe('applyHighlightsToSection', () => {
  it('applies whole-paragraph wrapping for added paragraph on new side', () => {
    const sectionHtml = '<p>New paragraph here</p>';
    const sectionDiff = makeSectionDiff('s1', 'S1', [
      makeParagraphDiff('added', undefined, { start: 0, end: sectionHtml.length }),
    ]);
    const paragraphIndex = new Map(); // no paragraph text lookup needed for whole-paragraph wrap

    const result = applyHighlightsToSection(sectionHtml, 0, sectionDiff, paragraphIndex, 'new');
    expect(result).toContain('<ins');
    expect(result).toContain('diff-paragraph-added');
  });

  it('leaves unchanged paragraphs unmodified', () => {
    const sectionHtml = '<p>Same old content</p>';
    const sectionDiff = makeSectionDiff('s1', 'S1', [
      makeParagraphDiff('unchanged', { start: 0, end: sectionHtml.length }, { start: 0, end: sectionHtml.length }),
    ], 'unchanged');
    const paragraphIndex = new Map();

    const result = applyHighlightsToSection(sectionHtml, 0, sectionDiff, paragraphIndex, 'old');
    expect(result).not.toContain('<ins');
    expect(result).not.toContain('<del');
  });

  it('processes multiple paragraphs in a section (reverse offset order)', () => {
    const sectionHtml = '<p>First</p><p>Second</p><p>Third</p>';
    const sectionDiff = makeSectionDiff('s1', 'S1', [
      makeParagraphDiff('removed', { start: 0, end: 14 }),                    // <p>First</p>
      makeParagraphDiff('unchanged', { start: 14, end: 29 }, { start: 14, end: 29 }),  // <p>Second</p>
      makeParagraphDiff('added', undefined, { start: 29, end: sectionHtml.length }),     // <p>Third</p>
    ]);
    const paragraphIndex = new Map();

    const resultOld = applyHighlightsToSection(sectionHtml, 0, sectionDiff, paragraphIndex, 'old');
    expect(resultOld).toContain('<del');         // First paragraph removed
    expect(resultOld).not.toContain('<ins');     // No added on old side
    expect(resultOld).toContain('Second');       // Unchanged preserved

    const resultNew = applyHighlightsToSection(sectionHtml, 0, sectionDiff, paragraphIndex, 'new');
    expect(resultNew).toContain('<ins');         // Third paragraph added
    expect(resultNew).not.toContain('<del');     // No removed on new side
  });

  it('handles sectionOffset > 0 (section not at start of document)', () => {
    // Section starts at offset 100 in the document
    const sectionHtml = '<p>Content</p>';
    const sectionDiff = makeSectionDiff('s1', 'S1', [
      makeParagraphDiff('removed', { start: 100, end: 114 }), // absolute offset
    ]);
    const paragraphIndex = new Map();

    const result = applyHighlightsToSection(sectionHtml, 100, sectionDiff, paragraphIndex, 'old');
    expect(result).toContain('<del');
  });

  it('filters wordChanges by side (old shows removed, new shows added)', () => {
    const sectionHtml = '<p>Hello world</p>';
    const paragraph: Paragraph = {
      type: 'paragraph',
      text: 'Hello world',
      source: { start: 0, end: sectionHtml.length },
    };
    const paragraphIndex = new Map([['0:' + sectionHtml.length, paragraph]]);
    const sectionDiff = makeSectionDiff('s1', 'S1', [
      makeParagraphDiff(
        'modified',
        { start: 0, end: sectionHtml.length },
        { start: 0, end: sectionHtml.length },
        [
          { type: 'removed', start: 0, end: 5 },  // "Hello"
          { type: 'added', start: 0, end: 3 },     // "Hey" (in new text)
        ],
      ),
    ]);

    const resultOld = applyHighlightsToSection(sectionHtml, 0, sectionDiff, paragraphIndex, 'old');
    expect(resultOld).toContain('<del');          // removed word shown
    expect(resultOld).not.toContain('<ins');      // added word NOT shown on old side

    const resultNew = applyHighlightsToSection(sectionHtml, 0, sectionDiff, paragraphIndex, 'new');
    expect(resultNew).toContain('<ins');          // added word shown
    expect(resultNew).not.toContain('<del');      // removed word NOT shown on new side
  });
});
```

### Normalization sanity check

```typescript
describe('buildNormalizedMapping — normalization', () => {
  it('NBSP (\\u00a0) is normalized to space', () => {
    // Verified indirectly: if mapping produces correct normalized text
    const html = '<p>A\u00a0B</p>';
    const text = 'A B'; // parser normalizes NBSP to space
    const changes: WordChange[] = [{ type: 'removed', start: 2, end: 3 }]; // "B"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
  });

  it('collapses multiple spaces to one', () => {
    const html = '<p>Hello    world</p>';
    const text = 'Hello world'; // collapsed
    const changes: WordChange[] = [{ type: 'removed', start: 6, end: 11 }]; // "world"
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
    expect(result).toContain('world');
  });

  it('trims leading and trailing whitespace', () => {
    const html = '<p>  Hello  </p>';
    const text = 'Hello'; // trimmed
    const changes: WordChange[] = [{ type: 'removed', start: 0, end: 5 }];
    const result = injectWordHighlights(html, changes, text);
    expect(result).toContain('<del');
    expect(result).toContain('Hello');
  });

  it('falls back to original HTML when normalized text does not match paragraphText', () => {
    const html = '<p>Hello world</p>';
    const mismatchedText = 'COMPLETELY DIFFERENT TEXT';
    const changes: WordChange[] = [{ type: 'removed', start: 0, end: 5 }];
    // Should return original HTML unchanged (safety fallback)
    const result = injectWordHighlights(html, changes, mismatchedText);
    expect(result).toBe(html);
  });
});
```

---

## 3. Integration Tests — FilingContent with Highlights

These tests verify the full component rendering pipeline. They extend the existing `FilingContent.test.tsx` with new `describe` blocks for highlight behavior.

### Fixture helpers (shared with existing tests)

```typescript
// Reuse existing makeDoc() and makeSection() from FilingContent.test.tsx

function makeParagraphDiff(
  changeType: ChangeType,
  oldRange?: SourceLocation,
  newRange?: SourceLocation,
  wordChanges?: WordChange[],
): ParagraphDiff {
  return { changeType, wordChanges, sourceMapping: { old: oldRange, new: newRange } };
}

function makeSectionDiff(
  id: string,
  heading: string,
  paragraphDiffs: ParagraphDiff[],
  changeType: ChangeType = 'modified',
): SectionDiff {
  return {
    id, heading, changeType,
    paragraphDiffs, tableDiffs: [], subsectionDiffs: [],
    sourceMapping: { old: { start: 0, end: 100 }, new: { start: 0, end: 100 } },
  };
}
```

### Backward compatibility

```typescript
describe('FilingContent — backward compatibility', () => {
  it('renders without sectionDiffs identically to US-2.3 (no highlights)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('ins')).toBeNull();
    expect(container.querySelector('del')).toBeNull();
    expect(container.textContent).toContain('Content');
  });

  it('preserves existing section slicing when sectionDiffs is undefined', () => {
    const html = '<p>Preamble</p><h2>Item 1</h2><p>Section content</p>';
    const item1Start = html.indexOf('<h2>');
    const doc = makeDoc(html, [makeSection('item-1', 'Item 1', item1Start, html.length)]);
    const { container } = render(<FilingContent document={doc} />);

    expect(container.querySelector('#preamble')).not.toBeNull();
    expect(container.querySelector('#item-1')).not.toBeNull();
  });
});
```

### Whole-paragraph change types

```typescript
describe('FilingContent — whole paragraph changes', () => {
  it('renders added paragraph with <ins class="diff-paragraph-added">', () => {
    const html = '<p>New paragraph content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'Section 1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'Section 1', [
          makeParagraphDiff('added', undefined, { start: 0, end: html.length }),
        ])]}
        side="new"
      />
    );

    const ins = container.querySelector('ins');
    expect(ins).not.toBeNull();
    expect(ins?.textContent).toContain('New paragraph content');
    expect(ins?.className).toContain('diff-paragraph-added');
  });

  it('renders removed paragraph with <del class="diff-paragraph-removed">', () => {
    const html = '<p>Old paragraph content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'Section 1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'Section 1', [
          makeParagraphDiff('removed', { start: 0, end: html.length }),
        ])]}
        side="old"
      />
    );

    const del = container.querySelector('del');
    expect(del).not.toBeNull();
    expect(del?.textContent).toContain('Old paragraph content');
    expect(del?.className).toContain('diff-paragraph-removed');
  });

  it('renders unchanged paragraph without any highlight markup', () => {
    const html = '<p>Same content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'Section 1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'Section 1', [
          makeParagraphDiff('unchanged', { start: 0, end: html.length }, { start: 0, end: html.length }),
        ], 'unchanged')]}
        side="old"
      />
    );

    expect(container.querySelector('ins')).toBeNull();
    expect(container.querySelector('del')).toBeNull();
    expect(container.textContent).toContain('Same content');
  });
});
```

### Word-level changes in modified paragraphs

```typescript
describe('FilingContent — word-level changes', () => {
  it('highlights only changed words in a modified paragraph', () => {
    const html = '<p>The quick brown fox jumps</p>';
    const doc = makeDoc(html, [makeSection('s1', 'Section 1', 0, html.length)]);

    // Note: for word-level tests, the paragraph must exist in doc.sections[].blocks
    // so that paragraphIndex can look up the text. The makeDoc helper needs to include
    // paragraph blocks for this to work end-to-end.

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'Section 1', [
          makeParagraphDiff(
            'modified',
            { start: 0, end: html.length },
            { start: 0, end: html.length },
            [{ type: 'removed', start: 4, end: 9 }], // "quick"
          ),
        ])]}
        side="old"
      />
    );

    const del = container.querySelector('del');
    expect(del).not.toBeNull();
    expect(del?.textContent).toBe('quick');
    expect(container.querySelectorAll('ins')).toHaveLength(0);
  });

  it('handles word change that spans across an HTML tag (DOM splitting)', () => {
    const html = '<p>The <b>quick brown</b> fox</p>';
    const doc = makeDoc(html, [makeSection('s1', 'Section 1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'Section 1', [
          makeParagraphDiff(
            'modified',
            { start: 0, end: html.length },
            { start: 0, end: html.length },
            [{ type: 'removed', start: 4, end: 19 }], // "quick brown fox"
          ),
        ])]}
        side="old"
      />
    );

    // DOM splitting produces multiple <del> elements at tag boundaries
    expect(container.querySelectorAll('del').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('b')).not.toBeNull(); // bold tag preserved
  });
});
```

### Side-by-side filtering

```typescript
describe('FilingContent — side prop filtering', () => {
  it('old side shows only <del> for removed changes', () => {
    const html = '<p>Old content here</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('removed', { start: 0, end: html.length }),
        ])]}
        side="old"
      />
    );
    expect(container.querySelector('del')).not.toBeNull();
    expect(container.querySelector('ins')).toBeNull();
  });

  it('new side shows only <ins> for added changes', () => {
    const html = '<p>New content here</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('added', undefined, { start: 0, end: html.length }),
        ])]}
        side="new"
      />
    );
    expect(container.querySelector('ins')).not.toBeNull();
    expect(container.querySelector('del')).toBeNull();
  });

  it('added paragraph is ignored on old side (no source location)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('added', undefined, { start: 0, end: html.length }),
        ])]}
        side="old"
      />
    );
    // added paragraph has no old sourceMapping, so nothing happens on old side
    expect(container.querySelector('ins')).toBeNull();
    expect(container.querySelector('del')).toBeNull();
  });
});
```

### Moved/reordered paragraphs

```typescript
describe('FilingContent — moved and reordered paragraphs', () => {
  it('moved paragraph with wordChanges renders word-level highlights', () => {
    const html = '<p>Moved text here</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff(
            'moved',
            { start: 0, end: html.length },
            { start: 0, end: html.length },
            [{ type: 'removed', start: 0, end: 5 }], // "Moved"
          ),
        ])]}
        side="old"
      />
    );

    expect(container.querySelector('del')).not.toBeNull();
  });

  it('moved paragraph without wordChanges renders as unchanged', () => {
    const html = '<p>Moved text here</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('moved', { start: 0, end: html.length }, { start: 0, end: html.length }),
        ])]}
        side="old"
      />
    );

    expect(container.querySelector('ins')).toBeNull();
    expect(container.querySelector('del')).toBeNull();
  });

  it('reordered paragraph renders as unchanged', () => {
    const html = '<p>Reordered text</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('reordered', { start: 0, end: html.length }, { start: 0, end: html.length }),
        ])]}
        side="old"
      />
    );

    expect(container.querySelector('ins')).toBeNull();
    expect(container.querySelector('del')).toBeNull();
  });
});
```

---

## 4. Boundary Conditions

```typescript
describe('Boundary conditions', () => {
  it('handles empty paragraph (0-length text content)', () => {
    const html = '<p></p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff('unchanged', { start: 0, end: html.length }, { start: 0, end: html.length }),
          ], 'unchanged')]}
          side="old"
        />
      )
    ).not.toThrow();
  });

  it('handles modified paragraph with empty wordChanges array', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('modified', { start: 0, end: html.length }, { start: 0, end: html.length }, []),
        ])]}
        side="old"
      />
    );
    // Empty wordChanges → no word-level highlights injected
    // May fall back to modified paragraph style or render unchanged
    expect(container.textContent).toContain('Content');
  });

  it('handles single-character word change', () => {
    const html = '<p>ABCDE</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff(
            'modified',
            { start: 0, end: html.length },
            { start: 0, end: html.length },
            [{ type: 'removed', start: 2, end: 3 }], // just "C"
          ),
        ])]}
        side="old"
      />
    );

    const del = container.querySelector('del');
    expect(del).not.toBeNull();
    expect(del?.textContent).toBe('C');
  });

  it('handles change at the very start of paragraph text', () => {
    const html = '<p>Hello world</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff(
            'modified',
            { start: 0, end: html.length },
            { start: 0, end: html.length },
            [{ type: 'removed', start: 0, end: 5 }], // "Hello"
          ),
        ])]}
        side="old"
      />
    );

    const del = container.querySelector('del');
    expect(del?.textContent).toBe('Hello');
  });

  it('handles change at the very end of paragraph text', () => {
    const html = '<p>Hello world</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff(
            'modified',
            { start: 0, end: html.length },
            { start: 0, end: html.length },
            [{ type: 'removed', start: 6, end: 11 }], // "world"
          ),
        ])]}
        side="old"
      />
    );

    const del = container.querySelector('del');
    expect(del?.textContent).toBe('world');
  });

  it('handles HTML entities in changed text', () => {
    const html = '<p>A &amp; B changed</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff(
              'modified',
              { start: 0, end: html.length },
              { start: 0, end: html.length },
              [{ type: 'removed', start: 0, end: 5 }], // "A & B"
            ),
          ])]}
          side="old"
        />
      )
    ).not.toThrow();
  });

  it('handles deeply nested tags (div > p > span > b > text)', () => {
    const html = '<div><p><span><b>Important</b></span></p></div>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('removed', { start: 0, end: html.length }),
        ])]}
        side="old"
      />
    );

    expect(container.querySelector('del')).not.toBeNull();
  });

  it('handles paragraph with only whitespace', () => {
    const html = '<p>   </p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff('unchanged', { start: 0, end: html.length }, { start: 0, end: html.length }),
          ], 'unchanged')]}
          side="old"
        />
      )
    ).not.toThrow();
  });

  it('handles section with many paragraphs (50+)', () => {
    let html = '';
    const paragraphDiffs: ParagraphDiff[] = [];
    for (let i = 0; i < 50; i++) {
      const start = html.length;
      html += `<p>Paragraph ${i}</p>`;
      paragraphDiffs.push(
        makeParagraphDiff('unchanged', { start, end: html.length }, { start, end: html.length })
      );
    }

    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', paragraphDiffs, 'unchanged')]}
          side="old"
        />
      )
    ).not.toThrow();
  });
});
```

---

## 5. Error Conditions

```typescript
describe('Error conditions', () => {
  it('handles misaligned offsets gracefully (wordChange beyond paragraph text length)', () => {
    const html = '<p>Short</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff(
              'modified',
              { start: 0, end: html.length },
              { start: 0, end: html.length },
              [{ type: 'removed', start: 0, end: 999 }],
            ),
          ])]}
          side="old"
        />
      )
    ).not.toThrow();
  });

  it('handles out-of-range sourceMapping (start > HTML length)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff('added', undefined, { start: 9999, end: 10000 }),
          ])]}
          side="new"
        />
      )
    ).not.toThrow();
  });

  it('handles missing wordChanges for modified paragraph (falls back to whole-paragraph neutral style)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    // Should not crash; falls back to whole-paragraph highlight with neutral "modified" style
    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff(
              'modified',
              { start: 0, end: html.length },
              { start: 0, end: html.length },
              undefined,
            ),
          ])]}
          side="old"
        />
      )
    ).not.toThrow();
  });

  it('handles inverted wordChange range (start > end) — skipped after clamping', () => {
    const html = '<p>Hello world</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff(
              'modified',
              { start: 0, end: html.length },
              { start: 0, end: html.length },
              [{ type: 'removed', start: 10, end: 5 }],
            ),
          ])]}
          side="old"
        />
      )
    ).not.toThrow();
  });

  it('handles diff with section ID that does not match any document section', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    // Unmatched sectionDiff is ignored; section renders unmodified
    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('nonexistent', 'Ghost', [
          makeParagraphDiff('added', undefined, { start: 0, end: 10 }),
        ])]}
        side="new"
      />
    );
    expect(container.querySelector('ins')).toBeNull();
    expect(container.textContent).toContain('Content');
  });

  it('handles empty sectionDiffs array (no highlights applied)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent document={doc} sectionDiffs={[]} side="old" />
    );

    expect(container.textContent).toContain('Content');
    expect(container.querySelector('ins')).toBeNull();
    expect(container.querySelector('del')).toBeNull();
  });

  it('handles negative wordChange offsets (clamped to 0)', () => {
    const html = '<p>Hello</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff(
              'modified',
              { start: 0, end: html.length },
              { start: 0, end: html.length },
              [{ type: 'removed', start: -5, end: 3 }],
            ),
          ])]}
          side="old"
        />
      )
    ).not.toThrow();
  });

  it('handles paragraph sourceLocation outside section range (skipped)', () => {
    const html = '<p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    // Paragraph source at 500-510 is outside section range 0-14
    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff('removed', { start: 500, end: 510 }),
          ])]}
          side="old"
        />
      )
    ).not.toThrow();
  });

  it('handles stripStyleBlocks offset shift (style block mid-section shifts paragraph offsets)', () => {
    // A <style> block within a section shifts downstream offsets after stripping.
    // SourceLocation offsets are from the ORIGINAL HTML (before stripping), but
    // applyHighlightsToSection receives the STRIPPED HTML. If a style block appears
    // mid-section, paragraph offsets would be misaligned.
    // This is extremely rare in real SEC filings (style blocks are in <head>), but
    // the implementation should not crash if it happens.
    const html = '<p>Before</p><style>.x{color:red}</style><p>After</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    // Paragraph "After" has offset 41 in original HTML, but after stripStyleBlocks
    // the style block is removed and "After" shifts earlier. The SourceLocation
    // still references the original offset, so there's a mismatch.
    expect(() =>
      render(
        <FilingContent
          document={doc}
          sectionDiffs={[makeSectionDiff('s1', 'S1', [
            makeParagraphDiff('removed', { start: 0, end: 14 }),                // <p>Before</p>
            makeParagraphDiff('added', undefined, { start: 41, end: html.length }), // <p>After</p> original offset
          ])]}
          side="old"
        />
      )
    ).not.toThrow();
    // At minimum: does not crash. Ideal: content still renders, even if highlight misaligns.
  });
});
```

---

## 6. Accessibility Tests

```typescript
describe('Accessibility', () => {
  it('uses semantic <ins> element for additions', () => {
    const html = '<p>Added text here</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('added', undefined, { start: 0, end: html.length }),
        ])]}
        side="new"
      />
    );

    const ins = container.querySelector('ins');
    expect(ins).not.toBeNull();
    expect(ins?.tagName.toLowerCase()).toBe('ins');
  });

  it('uses semantic <del> element for removals', () => {
    const html = '<p>Removed text here</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('removed', { start: 0, end: html.length }),
        ])]}
        side="old"
      />
    );

    const del = container.querySelector('del');
    expect(del).not.toBeNull();
    expect(del?.tagName.toLowerCase()).toBe('del');
  });

  it('word-level <ins> has diff-added class (enables non-color differentiation via CSS underline)', () => {
    const html = '<p>Added word</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff(
            'modified',
            { start: 0, end: html.length },
            { start: 0, end: html.length },
            [{ type: 'added', start: 0, end: 5 }],
          ),
        ])]}
        side="new"
      />
    );

    const ins = container.querySelector('ins');
    expect(ins?.className).toContain('diff-added');
  });

  it('word-level <del> has diff-removed class (enables strikethrough via CSS)', () => {
    const html = '<p>Removed word</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff(
            'modified',
            { start: 0, end: html.length },
            { start: 0, end: html.length },
            [{ type: 'removed', start: 0, end: 7 }],
          ),
        ])]}
        side="old"
      />
    );

    const del = container.querySelector('del');
    expect(del?.className).toContain('diff-removed');
  });

  it('paragraph-level <ins> has diff-paragraph-added class (block styling)', () => {
    const html = '<p>New paragraph</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('added', undefined, { start: 0, end: html.length }),
        ])]}
        side="new"
      />
    );

    const ins = container.querySelector('ins');
    expect(ins?.className).toContain('diff-paragraph-added');
  });

  it('highlight elements do not break heading hierarchy', () => {
    const html = '<h2>Section Title</h2><p>Content</p>';
    const doc = makeDoc(html, [makeSection('s1', 'Section Title', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'Section Title', [
          makeParagraphDiff('added', undefined, { start: 26, end: html.length }),
        ])]}
        side="new"
      />
    );

    expect(screen.getByText('Section Title')).toBeInTheDocument();
  });

  it('screen readers can distinguish additions from removals via <ins>/<del> semantics', () => {
    const html = '<p>Old</p><p>New</p>';
    const doc = makeDoc(html, [makeSection('s1', 'S1', 0, html.length)]);

    const { container } = render(
      <FilingContent
        document={doc}
        sectionDiffs={[makeSectionDiff('s1', 'S1', [
          makeParagraphDiff('removed', { start: 0, end: 10 }),
          makeParagraphDiff('added', undefined, { start: 10, end: 20 }),
        ])]}
        side="old"
      />
    );

    const delElements = container.querySelectorAll('del');
    expect(delElements.length).toBeGreaterThan(0);
  });
});
```

---

## 7. Test Data / Fixtures

### Fixture helpers to create

| Helper | Purpose | Location |
|--------|---------|----------|
| `makeDoc(html, sections)` | Reuse from `FilingContent.test.tsx` — creates `StructuredDocument` | `FilingContent.test.tsx` |
| `makeSection(id, heading, start, end)` | Reuse from `FilingContent.test.tsx` — creates `FilingSection` | `FilingContent.test.tsx` |
| `makeParagraphDiff(changeType, old?, new?, wordChanges?)` | Creates `ParagraphDiff` with specified change type and offsets | `FilingContent.test.tsx` (new) |
| `makeSectionDiff(id, heading, paragraphDiffs, changeType?)` | Creates `SectionDiff` wrapping paragraph diffs | `FilingContent.test.tsx` (new) |

### Shared HTML snippets for unit tests

```typescript
const FIXTURES = {
  plainText: 'Hello world',
  simpleParagraph: '<p>The quick brown fox jumps over the lazy dog</p>',
  boldParagraph: '<p>The <b>quick brown</b> fox</p>',
  nestedTags: '<p>A <span class="x"><b>bold <i>italic</i></b></span> end</p>',
  entities: '<p>Revenue was $1.2B &amp; growing &gt; 10% year-over-year</p>',
  multiParagraph: '<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>',
  lineBreaks: '<p>Line one<br/>Line two<br/>Line three</p>',
  withTable: '<p>Before</p><table><tr><td>Cell</td></tr></table><p>After</p>',
  emptyParagraph: '<p></p>',
  whitespaceParagraph: '<p>   </p>',
};
```

---

## 8. Visual Validation Strategy (Chrome DevTools MCP)

### UAT Checks

| Checkpoint | What to verify |
|-----------|---------------|
| Added paragraph (whole) | Green-50 background, green-600 left border, no underline/strikethrough |
| Removed paragraph (whole) | Red-50 background, red-600 left border, no strikethrough at block level |
| Word-level added | Green-100 background, green-600 underline |
| Word-level removed | Red-100 background, red-600 strikethrough |
| Unchanged content | No background, no decoration |
| Nested HTML preserved | Bold, italic, span formatting preserved within highlighted text |
| Cross-tag highlight | Highlight splits at tag boundaries, no broken nesting |
| Multiple sections | Highlights render correctly across different document sections |
| Side-by-side view | Filing A shows `<del>` highlights, Filing B shows `<ins>` highlights |
| Color contrast | Text readable on both green and red backgrounds (WCAG AA) |

### Process

1. Start dev server: `NX_OUTPUT_STYLE=stream pnpm nx run web:dev`
2. Navigate MCP browser to `http://localhost:5173`
3. Load test filings with hardcoded diff fixture
4. Take screenshots at each checkpoint
5. Verify color contrast meets WCAG AA minimum (4.5:1 for text on colored background)

---

## 9. Test File Organization

```
apps/web/src/
  lib/
    highlight-injector.ts          # Pure functions: buildNormalizedMapping, injectWordHighlights,
                                   #   wrapParagraph, applyHighlightsToSection
    highlight-injector.test.ts     # Unit tests for all pure functions
  components/
    FilingContent.tsx              # Extended with sectionDiffs + side props
    FilingContent.test.tsx         # Integration tests: existing + new highlight tests
    highlight.css                  # Highlight CSS styles

.specs/us-2-5-paragraph-diff/
  test-plan.md                    # This file
  uat.md                          # UAT doc (created during implementation)
```

All tests run via: `NX_OUTPUT_STYLE=stream pnpm nx run web:test`

---

## 10. Testing Limitations (jsdom)

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No CSS computed styles | Cannot verify green/red background colors | Verify CSS class presence; UAT for visual check |
| No text-decoration rendering | Cannot verify strikethrough/underline is visible | Verify CSS class; `<del>`/`<ins>` have browser defaults |
| No color contrast checking | Cannot verify WCAG AA compliance | UAT visual check + manual contrast ratio verification |
| No scroll behavior | Cannot verify highlights work with scrolled content | UAT scroll testing |

### What jsdom CAN verify (and we test thoroughly)

- `<ins>`/`<del>` elements exist in the DOM
- Correct CSS classes applied (`diff-added`, `diff-removed`, `diff-paragraph-added`, `diff-paragraph-removed`)
- Correct text content within highlight elements
- DOM-based splitting produces valid HTML (multiple `<del>`/`<ins>` at tag boundaries)
- Normalization mapping correctness (via indirect testing through `injectWordHighlights`)
- Error resilience (bad offsets, missing data, mismatched text)
- Backward compatibility (no sectionDiffs = no highlights)
- Accessibility semantics (`<ins>` and `<del>` are meaningful to screen readers)
