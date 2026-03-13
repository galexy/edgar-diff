import { parseFiling } from '@edgar-diff/lib';
import { Temporal } from '@js-temporal/polyfill';
import aaplHtml from './10k-aapl-2024.html?raw';

const rawFiling = {
  accessionNumber: '0000320193-24-000123',
  cik: '0000320193',
  formType: '10-K' as const,
  filingDate: Temporal.PlainDate.from('2024-11-01'),
  primaryDocumentFilename: 'aapl-20240928.htm',
  html: aaplHtml,
  fetchedAt: Temporal.Now.instant(),
};

export const sampleDocument = parseFiling(rawFiling);
