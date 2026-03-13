import type { StructuredDocument, SectionDiff, Paragraph } from '@edgar-diff/lib';
import { applyHighlightsToSection, type Side } from '../lib/highlight-injector';
import './filing-content.css';
import './highlight.css';

interface FilingContentProps {
  document: StructuredDocument;
  sectionDiffs?: SectionDiff[];
  side?: Side;
}

interface HtmlSection {
  id: string;
  html: string;
}

/** Strip <style> blocks to prevent global CSS leakage from filing HTML. */
function stripStyleBlocks(html: string): string {
  return html.replace(/<style[\s>][\s\S]*?<\/style>/gi, '');
}

/** Build a lookup map from "start:end" → Paragraph for O(1) text retrieval. */
function buildParagraphIndex(document: StructuredDocument): Map<string, Paragraph> {
  const index = new Map<string, Paragraph>();
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.type === 'paragraph') {
        index.set(`${block.source.start}:${block.source.end}`, block);
      }
    }
  }
  return index;
}

function sliceSections(
  document: StructuredDocument,
  sectionDiffs?: SectionDiff[],
  side?: Side,
): HtmlSection[] {
  const { filing, sections } = document;
  const html = filing.html ?? '';
  const result: HtmlSection[] = [];

  // Build diff lookup and paragraph index if diffs provided
  const diffMap = new Map(sectionDiffs?.map((sd) => [sd.id, sd]) ?? []);
  const paragraphIndex = sectionDiffs ? buildParagraphIndex(document) : undefined;

  // Preamble: content before the first section
  if (sections.length > 0 && sections[0].source.start > 0) {
    result.push({
      id: 'preamble',
      html: stripStyleBlocks(html.slice(0, sections[0].source.start)),
    });
  }

  // Each section: slice using source offsets, strip <style> blocks
  for (const section of sections) {
    let sectionHtml = stripStyleBlocks(html.slice(section.source.start, section.source.end));

    // Apply highlights if diff data available for this section
    const sectionDiff = diffMap.get(section.id);
    if (sectionDiff && paragraphIndex && side) {
      sectionHtml = applyHighlightsToSection(
        sectionHtml,
        section.source.start,
        sectionDiff,
        paragraphIndex,
        side,
      );
    }

    result.push({ id: section.id, html: sectionHtml });
  }

  // If no sections, render entire HTML as a single block
  if (sections.length === 0 && html.length > 0) {
    result.push({ id: 'content', html: stripStyleBlocks(html) });
  }

  return result;
}

export function FilingContent({ document, sectionDiffs, side }: FilingContentProps) {
  const sections = sliceSections(document, sectionDiffs, side);

  return (
    <div className="filing-content-root">
      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="filing-section"
          dangerouslySetInnerHTML={{ __html: section.html }}
        />
      ))}
    </div>
  );
}
