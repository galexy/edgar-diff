import type { StructuredDocument } from '@edgar-diff/lib';
import './filing-content.css';

interface FilingContentProps {
  document: StructuredDocument;
}

interface HtmlSection {
  id: string;
  html: string;
}

/** Strip <style> blocks to prevent global CSS leakage from filing HTML. */
function stripStyleBlocks(html: string): string {
  return html.replace(/<style[\s>][\s\S]*?<\/style>/gi, '');
}

function sliceSections(document: StructuredDocument): HtmlSection[] {
  const { filing, sections } = document;
  const html = filing.html;
  const result: HtmlSection[] = [];

  // Preamble: content before the first section
  if (sections.length > 0 && sections[0].source.start > 0) {
    result.push({
      id: 'preamble',
      html: stripStyleBlocks(html.slice(0, sections[0].source.start)),
    });
  }

  // Each section: slice using source offsets, strip <style> blocks
  for (const section of sections) {
    result.push({
      id: section.id,
      html: stripStyleBlocks(html.slice(section.source.start, section.source.end)),
    });
  }

  // If no sections, render entire HTML as a single block
  if (sections.length === 0 && html.length > 0) {
    result.push({ id: 'content', html: stripStyleBlocks(html) });
  }

  return result;
}

export function FilingContent({ document }: FilingContentProps) {
  const sections = sliceSections(document);

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
