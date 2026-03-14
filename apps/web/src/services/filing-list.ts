import type { AvailableFiling } from './types';

/** Supported form types for the filing selector. */
export const SUPPORTED_FORM_TYPES = ['10-K', '10-K/A', '10-Q', '10-Q/A'] as const;

interface SubmissionsFilings {
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
    };
  };
}

/**
 * Fetch and parse available filings for a company.
 * Hits the same submissions endpoint as fetchCompanySubmissions,
 * but extracts the filings.recent parallel arrays.
 */
export async function fetchFilingList(
  cik: string,
  signal?: AbortSignal,
): Promise<AvailableFiling[]> {
  const paddedCik = cik.replace(/^0+/, '').padStart(10, '0');
  const url = `/api/sec/submissions/CIK${paddedCik}.json`;

  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(30_000) });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Company not found. Check the CIK and try again.');
    }
    if (response.status === 429) {
      throw new Error('SEC rate limit reached. Please wait a moment and try again.');
    }
    throw new Error('Unable to load filings. Try again shortly.');
  }

  let data: SubmissionsFilings;
  try {
    data = await response.json();
  } catch {
    throw new Error('Unexpected response from SEC. Try again shortly.');
  }

  const recent = data?.filings?.recent;
  if (!recent) return [];

  const { accessionNumber = [], filingDate = [], form = [] } = recent;
  const len = Math.min(accessionNumber.length, filingDate.length, form.length);

  const filings: AvailableFiling[] = [];
  for (let i = 0; i < len; i++) {
    if ((SUPPORTED_FORM_TYPES as readonly string[]).includes(form[i])) {
      filings.push({
        accessionNumber: accessionNumber[i],
        formType: form[i],
        filingDate: filingDate[i],
      });
    }
  }

  filings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

  return filings;
}
