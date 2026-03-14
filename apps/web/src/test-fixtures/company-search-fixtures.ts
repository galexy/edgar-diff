import { vi } from 'vitest';

// ─── Mock Worker Tickers Response ────────────────────────────────────────────
// Small subset of /api/tickers response (same shape as SEC company_tickers.json)

/** Small subset of /api/tickers response for unit/integration tests */
export const MOCK_COMPANY_TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.', exchange: 'Nasdaq' },
  '1': { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corporation', exchange: 'Nasdaq' },
  '2': { cik_str: 1652044, ticker: 'GOOGL', title: 'Alphabet Inc.', exchange: 'Nasdaq' },
  '3': { cik_str: 1652044, ticker: 'GOOG', title: 'Alphabet Inc.', exchange: 'Nasdaq' },
  '4': { cik_str: 1318605, ticker: 'TSLA', title: 'Tesla, Inc.', exchange: 'Nasdaq' },
};

export const MOCK_COMPANIES = {
  AAPL: { name: 'Apple Inc.', cik: '0000320193', tickers: ['AAPL'] },
  MSFT: { name: 'Microsoft Corporation', cik: '0000789019', tickers: ['MSFT'] },
  GOOGL: { name: 'Alphabet Inc.', cik: '0001652044', tickers: ['GOOGL', 'GOOG'] },
  TSLA: { name: 'Tesla, Inc.', cik: '0001318605', tickers: ['TSLA'] },
} as const;

// ─── Mock SEC Submissions API Responses ──────────────────────────────────────
// Shape of /api/sec/submissions/CIK{cik}.json (Worker proxies to data.sec.gov)

export const MOCK_AAPL_SUBMISSIONS = {
  cik: '320193',
  entityType: 'operating',
  sic: '3571',
  sicDescription: 'Electronic Computers',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  exchanges: ['Nasdaq'],
  ein: '942404110',
  category: 'Large accelerated filer',
  filings: {
    recent: {
      accessionNumber: [
        '0000320193-23-000106',
        '0000320193-23-000077',
        '0000320193-23-000064',
        '0000320193-22-000108',
        '0000320193-23-000050',
      ],
      filingDate: [
        '2023-11-03',
        '2023-08-04',
        '2023-05-05',
        '2022-10-28',
        '2023-09-15',
      ],
      form: [
        '10-K',
        '10-Q',
        '10-Q',
        '10-K',
        '8-K',
      ],
    },
  },
};

export const MOCK_MSFT_SUBMISSIONS = {
  cik: '789019',
  entityType: 'operating',
  name: 'Microsoft Corporation',
  tickers: ['MSFT'],
  exchanges: ['Nasdaq'],
  filings: {
    recent: {
      accessionNumber: ['0000789019-23-000001'],
      filingDate: ['2023-07-27'],
      form: ['10-K'],
    },
  },
};

/** Company with no supported filings (only 8-K) */
export const MOCK_NO_SUPPORTED_FILINGS = {
  cik: '999999',
  name: 'Only 8K Corp',
  tickers: ['ONLY8K'],
  exchanges: ['NYSE'],
  filings: {
    recent: {
      accessionNumber: ['0000999999-23-000001'],
      filingDate: ['2023-06-15'],
      form: ['8-K'],
    },
  },
};

// ─── Error Response Helpers ──────────────────────────────────────────────────

export function mockResponse(status: number, body: unknown = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function mockTickersResponse(): Response {
  return mockResponse(200, MOCK_COMPANY_TICKERS);
}

export function mockSubmissionsResponse(ticker: keyof typeof MOCK_COMPANIES): Response {
  const submissions =
    ticker === 'AAPL'
      ? MOCK_AAPL_SUBMISSIONS
      : ticker === 'MSFT'
        ? MOCK_MSFT_SUBMISSIONS
        : { cik: MOCK_COMPANIES[ticker].cik.replace(/^0+/, ''), name: MOCK_COMPANIES[ticker].name, tickers: MOCK_COMPANIES[ticker].tickers };
  return mockResponse(200, submissions);
}

export const MOCK_404 = () => mockResponse(404, { error: 'Not Found' });
export const MOCK_429 = () => mockResponse(429, { error: 'Rate limit exceeded' });
export const MOCK_500 = () => mockResponse(500, { error: 'Internal Server Error' });
export const MOCK_NETWORK_ERROR = new TypeError('Failed to fetch');

// ─── Mock Fetch Helper ──────────────────────────────────────────────────────

/** Creates a fetch mock that responds based on URL pattern */
export function createMockFetch(
  responses: Record<string, Response | (() => Response | Promise<Response>)>,
) {
  return vi.fn((url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const match = Object.entries(responses).find(([pattern]) => urlStr.includes(pattern));
    if (!match) return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
    const response = typeof match[1] === 'function' ? match[1]() : match[1];
    return Promise.resolve(response);
  });
}

/**
 * Creates a standard mock fetch for the common search flow:
 * - /api/tickers → returns mock tickers data
 * - /api/sec/submissions/ → returns AAPL submissions by default
 */
export function createStandardMockFetch(
  overrides?: Record<string, Response | (() => Response | Promise<Response>)>,
) {
  return createMockFetch({
    '/api/tickers': () => mockTickersResponse(),
    '/api/sec/submissions/': () => mockSubmissionsResponse('AAPL'),
    ...overrides,
  });
}
