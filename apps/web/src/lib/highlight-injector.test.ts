import { describe, it, expect } from 'vitest';
import { wrapParagraph } from './highlight-injector';

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
