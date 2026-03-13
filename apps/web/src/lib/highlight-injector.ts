import type { WordChange, ParagraphDiff, SectionDiff } from '@edgar-diff/lib';
import type { SourceLocation, Paragraph } from '@edgar-diff/lib';

export type Side = 'old' | 'new';

/**
 * Wrap an entire paragraph's HTML in a block-level <ins> or <del>.
 */
export function wrapParagraph(
  paragraphHtml: string,
  changeType: 'added' | 'removed',
): string {
  if (changeType === 'added') {
    return `<ins class="diff-paragraph-added">${paragraphHtml}</ins>`;
  }
  return `<del class="diff-paragraph-removed">${paragraphHtml}</del>`;
}
