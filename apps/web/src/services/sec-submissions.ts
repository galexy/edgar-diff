import type { Company } from './types';

interface SubmissionsResponse {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
}

/** Fetch full company details from SEC submissions API via Worker proxy. */
export async function fetchCompanySubmissions(
  cik: string,
  signal?: AbortSignal,
): Promise<Company> {
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
    throw new Error('SEC service unavailable. Try again shortly.');
  }

  let data: SubmissionsResponse;
  try {
    data = await response.json();
  } catch {
    throw new Error('Unexpected response from SEC. Try again shortly.');
  }

  return {
    cik: paddedCik,
    name: data.name,
    ticker: data.tickers?.[0] ?? '',
    exchange: data.exchanges?.[0] ?? '',
  };
}
