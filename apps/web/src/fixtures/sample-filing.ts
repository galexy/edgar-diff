import type { StructuredDocument } from '@edgar-diff/lib';
import { Temporal } from '@js-temporal/polyfill';

// A minimal synthetic filing for US-2.3 development.
// NOT a real SEC filing — just enough HTML to validate rendering.

const SAMPLE_HTML = [
  '<html><body>',
  '<h1>SAMPLE CORP</h1><p>Annual Report (Form 10-K)</p>',
  '<h2>Item 1. Business</h2>',
  '<p>Sample Corp is a technology company.</p>',
  '<table><tr><th>Year</th><th>Revenue</th></tr>',
  '<tr><td>2024</td><td>$1,000,000</td></tr></table>',
  '<h2>Item 1A. Risk Factors</h2>',
  '<p>The company faces various risks including:</p>',
  '<ul><li>Market risk</li><li>Operational risk</li></ul>',
  '<h2>Item 2. Properties</h2>',
  '<p>The company leases office space in San Francisco.</p>',
  '</body></html>',
].join('\n');

const item1Start = SAMPLE_HTML.indexOf('<h2>Item 1. Business</h2>');
const item1aStart = SAMPLE_HTML.indexOf('<h2>Item 1A. Risk Factors</h2>');
const item2Start = SAMPLE_HTML.indexOf('<h2>Item 2. Properties</h2>');

export const sampleDocument: StructuredDocument = {
  filing: {
    accessionNumber: '0000000000-00-000000',
    cik: '0000000000',
    formType: '10-K',
    filingDate: Temporal.PlainDate.from('2024-01-15'),
    primaryDocumentFilename: 'sample-10k.htm',
    html: SAMPLE_HTML,
    fetchedAt: Temporal.Now.instant(),
  },
  sections: [
    {
      id: 'item-1',
      heading: 'Item 1. Business',
      level: 1,
      blocks: [],
      subsections: [],
      source: { start: item1Start, end: item1aStart },
    },
    {
      id: 'item-1a',
      heading: 'Item 1A. Risk Factors',
      level: 1,
      blocks: [],
      subsections: [],
      source: { start: item1aStart, end: item2Start },
    },
    {
      id: 'item-2',
      heading: 'Item 2. Properties',
      level: 1,
      blocks: [],
      subsections: [],
      source: { start: item2Start, end: SAMPLE_HTML.length },
    },
  ],
  parseWarnings: [],
};
