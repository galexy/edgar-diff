import { Temporal } from '@js-temporal/polyfill';
import { parseAccessionNumber } from './accession-number.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import type { EdgarClientOptions, FilingMetadata, FormType, RawFiling } from './types.js';
import { EdgarNetworkError } from './types.js';

const EFTS_SEARCH_URL = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';

const DEFAULT_RETRY_OPTIONS = { maxAttempts: 3, baseDelayMs: 1000 };

export function createEdgarClient(options: EdgarClientOptions) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const userAgent = options.userAgent;

  async function resolveFilingMetadata(accessionNumber: string): Promise<FilingMetadata> {
    const url = `${EFTS_SEARCH_URL}?q=%22${accessionNumber}%22`;
    const response = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': userAgent } },
      DEFAULT_RETRY_OPTIONS,
      accessionNumber,
      fetchFn,
    );

    const data = await response.json();
    const hits = data?.hits?.hits;

    if (!hits || hits.length === 0) {
      throw new EdgarNetworkError(404, accessionNumber);
    }

    const primaryHit = hits.find((h: any) => h._source?.sequence === 1);
    if (!primaryHit) {
      throw new Error(
        `No primary document (sequence 1) found in EFTS response for ${accessionNumber}`
      );
    }

    const id: string = primaryHit._id;
    const colonIndex = id.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Malformed EFTS _id (no colon separator): "${id}"`);
    }

    const filename = id.substring(colonIndex + 1);
    if (!filename) {
      throw new Error(`Empty filename in EFTS _id: "${id}"`);
    }

    const source = primaryHit._source;
    const ciks: string[] | undefined = source?.ciks;
    if (!ciks || ciks.length === 0) {
      throw new Error(`Missing or empty ciks array in EFTS response for ${accessionNumber}`);
    }

    const form: string | undefined = source?.form;
    if (!form) {
      throw new Error(`Missing form field in EFTS response for ${accessionNumber}`);
    }

    const fileDate: string | undefined = source?.file_date;
    if (!fileDate) {
      throw new Error(`Missing file_date field in EFTS response for ${accessionNumber}`);
    }

    return {
      cik: ciks[0],
      formType: form,
      filingDate: fileDate,
      primaryDocumentFilename: filename,
    };
  }

  async function fetchFiling(accessionNumber: string): Promise<RawFiling> {
    const parsed = parseAccessionNumber(accessionNumber);
    const metadata = await resolveFilingMetadata(parsed.raw);

    const cikNoLeadingZeros = metadata.cik.replace(/^0+/, '');
    const documentUrl = `${EDGAR_ARCHIVES_BASE}/${cikNoLeadingZeros}/${parsed.noDashes}/${metadata.primaryDocumentFilename}`;

    const htmlResponse = await fetchWithRetry(
      documentUrl,
      { headers: { 'User-Agent': userAgent } },
      DEFAULT_RETRY_OPTIONS,
      parsed.raw,
      fetchFn,
    );

    const html = await htmlResponse.text();

    return {
      accessionNumber: parsed.raw,
      cik: metadata.cik,
      formType: metadata.formType as FormType,
      filingDate: Temporal.PlainDate.from(metadata.filingDate),
      primaryDocumentFilename: metadata.primaryDocumentFilename,
      html,
      fetchedAt: Temporal.Now.instant(),
    };
  }

  return { fetchFiling };
}
