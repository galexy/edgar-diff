import { parseDocument } from 'htmlparser2';
import type { RawFiling } from '../client/types.js';
import type { StructuredDocument, FilingSection, Logger } from '../types.js';
import type { ExtractionContext } from './types.js';
import { extractSections, normalizeHeading } from './section-extractor.js';
import { extractContentBlocks } from './content-extractor.js';

export interface ParseOptions {
  includeSourceHtml?: boolean;
  logger?: Logger;
}

/**
 * Parse a raw filing into a structured document with sections and content blocks.
 */
export function parseFiling(
  raw: RawFiling,
  options?: ParseOptions,
): StructuredDocument {
  const context: ExtractionContext = {
    html: raw.html,
    warnings: [],
    includeSourceHtml: options?.includeSourceHtml ?? false,
    logger: options?.logger,
  };

  try {
    const boundaries = extractSections(raw.html, context);

    if (boundaries.length === 0) {
      return {
        filing: raw,
        sections: [],
        parseWarnings: context.warnings,
      };
    }

    // Parse the DOM once for content extraction
    const doc = parseDocument(raw.html, {
      withStartIndices: true,
      withEndIndices: true,
    });

    const sections: FilingSection[] = boundaries.map(boundary => {
      const blocks = extractContentBlocks(boundary, doc, context);
      const section: FilingSection = {
        id: `item-${boundary.heading.itemNumber}`,
        heading: boundary.heading.text,
        level: 1,
        blocks,
        subsections: [],
        source: {
          start: boundary.heading.source.start,
          end: boundary.contentEnd,
        },
      };
      if (context.includeSourceHtml) {
        section.sourceHtml = raw.html.slice(section.source.start, section.source.end);
      }
      return section;
    });

    return {
      filing: raw,
      sections,
      parseWarnings: context.warnings,
    };
  } catch (error) {
    const msg = `Parser error: ${error instanceof Error ? error.message : String(error)}`;
    context.warnings.push(msg);
    context.logger?.warn(msg);
    return {
      filing: raw,
      sections: [],
      parseWarnings: context.warnings,
    };
  }
}
