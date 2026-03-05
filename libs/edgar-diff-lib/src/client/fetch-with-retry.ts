import { EdgarNetworkError } from './types.js';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 503]);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions,
  accessionNumber: string,
  fetchFn: typeof globalThis.fetch,
): Promise<Response> {
  let lastStatusCode = 0;
  let lastRetryAfter: number | undefined;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const response = await fetchFn(url, init);

    if (response.ok) {
      return response;
    }

    lastStatusCode = response.status;

    if (!RETRYABLE_STATUS_CODES.has(response.status)) {
      throw new EdgarNetworkError(response.status, accessionNumber);
    }

    const retryAfterHeader = response.headers.get('Retry-After');
    const parsed = retryAfterHeader != null ? parseInt(retryAfterHeader, 10) : NaN;
    lastRetryAfter = Number.isNaN(parsed) ? undefined : parsed;

    if (attempt < options.maxAttempts) {
      const waitMs = lastRetryAfter != null
        ? lastRetryAfter * 1000
        : options.baseDelayMs * Math.pow(2, attempt - 1);
      await delay(waitMs);
    }
  }

  throw new EdgarNetworkError(lastStatusCode, accessionNumber, lastRetryAfter);
}
