import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { createEdgarClient } from '../../src/client/edgar-client.js';
import { EdgarNetworkError } from '../../src/client/types.js';
import { assertDefined } from '../helpers/assert-defined.js';

// --- Mock Data ---

const APPLE_10K_FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><title>APPLE INC - 10-K</title></head>
<body>
<div style="font-weight:bold">UNITED STATES SECURITIES AND EXCHANGE COMMISSION</div>
<div>Washington, D.C. 20549</div>
<div>FORM 10-K</div>
<div>Apple Inc.</div>
<div>One Apple Park Way, Cupertino, California 95014</div>
<h2>Item 1. Business</h2>
<p>Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables and accessories, and sells a variety of related services.</p>
<h2>Item 1A. Risk Factors</h2>
<p>The Company's business, reputation, results of operations, financial condition, and stock price can be affected by a number of factors.</p>
</body>
</html>`;

// --- Factory Functions ---

function createMockFetchSequence(
  responses: Array<{ status: number; body: string; headers?: Record<string, string> }>,
): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    assertDefined(resp);
    return Promise.resolve(
      new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      }),
    );
  }) as typeof globalThis.fetch;
}

function createEftsMockFetch(opts?: {
  accession?: string;
  cik?: string;
  formType?: string;
  filingDate?: string;
  primaryDocument?: string;
  html?: string;
  additionalHits?: Array<Record<string, unknown>>;
}): typeof globalThis.fetch {
  const accession = opts?.accession ?? '0000320193-23-000106';
  const cik = opts?.cik ?? '0000320193';
  const primaryDoc = opts?.primaryDocument ?? 'aapl-20230930.htm';

  const eftsResponse = {
    hits: {
      total: { value: 1 + (opts?.additionalHits?.length ?? 0), relation: 'eq' },
      hits: [
        {
          _id: `${accession}:${primaryDoc}`,
          _source: {
            ciks: [cik],
            root_forms: [opts?.formType ?? '10-K'],
            form: opts?.formType ?? '10-K',
            file_date: opts?.filingDate ?? '2023-11-03',
            adsh: accession,
            sequence: 1,
          },
        },
        ...(opts?.additionalHits ?? []),
      ],
    },
  };

  return createMockFetchSequence([
    { status: 200, body: JSON.stringify(eftsResponse), headers: { 'Content-Type': 'application/json' } },
    { status: 200, body: opts?.html ?? APPLE_10K_FIXTURE_HTML, headers: { 'Content-Type': 'text/html' } },
  ]);
}

function createEftsResponseData(opts?: {
  accession?: string;
  cik?: string;
  formType?: string;
  filingDate?: string;
  primaryDocument?: string;
}) {
  const accession = opts?.accession ?? '0000320193-23-000106';
  const cik = opts?.cik ?? '0000320193';
  const primaryDoc = opts?.primaryDocument ?? 'aapl-20230930.htm';

  return {
    hits: {
      total: { value: 1, relation: 'eq' },
      hits: [
        {
          _id: `${accession}:${primaryDoc}`,
          _source: {
            ciks: [cik],
            root_forms: [opts?.formType ?? '10-K'],
            form: opts?.formType ?? '10-K',
            file_date: opts?.filingDate ?? '2023-11-03',
            adsh: accession,
            sequence: 1,
          },
        },
      ],
    },
  };
}

// --- E2E Tests ---

describe('e2e: fetch Apple 10-K', () => {
  it('should fetch Apple 10-K 0000320193-23-000106 with realistic EFTS mock', async () => {
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: createEftsMockFetch({
        accession: '0000320193-23-000106',
        cik: '0000320193',
        formType: '10-K',
        filingDate: '2023-11-03',
        primaryDocument: 'aapl-20230930.htm',
        html: APPLE_10K_FIXTURE_HTML,
      }),
    });

    const beforeFetch = Temporal.Now.instant();
    const filing = await client.fetchFiling('0000320193-23-000106');

    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    expect(filing.cik).toBe('0000320193');
    expect(filing.formType).toBe('10-K');
    expect(filing.filingDate.toString()).toBe('2023-11-03');
    expect(filing.filingDate).toBeInstanceOf(Temporal.PlainDate);
    expect(filing.primaryDocumentFilename).toBe('aapl-20230930.htm');
    expect(filing.html).toContain('Apple');
    expect(filing.html).toBe(APPLE_10K_FIXTURE_HTML);
    expect(filing.fetchedAt).toBeInstanceOf(Temporal.Instant);
    expect(
      Temporal.Instant.compare(filing.fetchedAt, beforeFetch),
    ).toBeGreaterThanOrEqual(0);
    expect(
      Temporal.Instant.compare(filing.fetchedAt, Temporal.Now.instant()),
    ).toBeLessThanOrEqual(0);
  });

  it('should handle different form types (10-Q)', async () => {
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: createEftsMockFetch({
        accession: '0000320193-23-000077',
        cik: '0000320193',
        formType: '10-Q',
        filingDate: '2023-08-04',
        primaryDocument: 'aapl-20230701.htm',
        html: '<html><body>Apple 10-Q</body></html>',
      }),
    });

    const filing = await client.fetchFiling('0000320193-23-000077');
    expect(filing.formType).toBe('10-Q');
    expect(filing.html).toContain('Apple 10-Q');
  });
});

describe('e2e: filing-agent CIK mismatch', () => {
  it('should handle filing where accession CIK differs from company CIK', async () => {
    // Filing agent CIK: 0000950170 (Donnelley Financial Solutions)
    // Company CIK: 0000320193 (Apple)
    const filingAgentMock = createEftsMockFetch({
      accession: '0000950170-23-035122',
      cik: '0000320193', // Apple's CIK from EFTS, not the filing agent's
      formType: '10-Q',
      filingDate: '2023-08-04',
      primaryDocument: 'aapl-20230701.htm',
      html: '<html><body>Apple 10-Q filed via agent</body></html>',
    });

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: filingAgentMock,
    });

    const filing = await client.fetchFiling('0000950170-23-035122');

    // CIK should be from EFTS (Apple), not from accession prefix (filing agent)
    expect(filing.cik).toBe('0000320193');
    expect(filing.accessionNumber).toBe('0000950170-23-035122');
    expect(filing.formType).toBe('10-Q');
    expect(filing.primaryDocumentFilename).toBe('aapl-20230701.htm');
    expect(filing.html).toContain('Apple 10-Q filed via agent');

    // Verify the HTML fetch URL used Apple's CIK, not the filing agent's
    const secondCall = (filingAgentMock as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[0]).toContain('/data/320193/');
    expect(secondCall[0]).not.toContain('/data/950170/');
  });
});

describe('e2e: error scenarios', () => {
  it('should reject invalid accession numbers without making HTTP calls', async () => {
    const mockFetch = vi.fn();
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch as typeof globalThis.fetch,
    });

    await expect(client.fetchFiling('')).rejects.toThrow();
    await expect(client.fetchFiling('not-an-accession')).rejects.toThrow();
    await expect(client.fetchFiling('abc')).rejects.toThrow();

    // No HTTP requests should have been made for invalid accessions
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should throw EdgarNetworkError for non-existent filings', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }),
        { status: 200 },
      ),
    );
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch as typeof globalThis.fetch,
    });

    const err = await client
      .fetchFiling('9999999999-99-999999')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EdgarNetworkError);
    expect((err as EdgarNetworkError).statusCode).toBe(404);
    expect((err as EdgarNetworkError).accessionNumber).toBe('9999999999-99-999999');
  });
});

describe('e2e: rate limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fetch multiple filings with default rate limiter (no throttle under capacity)', async () => {
    // 3 fetchFiling calls = 6 HTTP calls, all under default capacity=10
    const mockFetch = createMockFetchSequence([
      ...[ // filing 1
        { status: 200, body: JSON.stringify(createEftsResponseData()), headers: { 'Content-Type': 'application/json' } },
        { status: 200, body: APPLE_10K_FIXTURE_HTML, headers: { 'Content-Type': 'text/html' } },
      ],
      ...[ // filing 2
        { status: 200, body: JSON.stringify(createEftsResponseData()), headers: { 'Content-Type': 'application/json' } },
        { status: 200, body: APPLE_10K_FIXTURE_HTML, headers: { 'Content-Type': 'text/html' } },
      ],
      ...[ // filing 3
        { status: 200, body: JSON.stringify(createEftsResponseData()), headers: { 'Content-Type': 'application/json' } },
        { status: 200, body: APPLE_10K_FIXTURE_HTML, headers: { 'Content-Type': 'text/html' } },
      ],
    ]);

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    const f1 = await client.fetchFiling('0000320193-23-000106');
    const f2 = await client.fetchFiling('0000320193-23-000106');
    const f3 = await client.fetchFiling('0000320193-23-000106');

    expect(f1.accessionNumber).toBe('0000320193-23-000106');
    expect(f2.accessionNumber).toBe('0000320193-23-000106');
    expect(f3.accessionNumber).toBe('0000320193-23-000106');
    expect(mockFetch).toHaveBeenCalledTimes(6);

    client.dispose();
  });

  it('should handle rate limiting under 429 error scenario end-to-end', async () => {
    // Mock: EFTS returns 429 on first call, then succeeds
    const mockFetch = createMockFetchSequence([
      { status: 429, body: '', headers: { 'Retry-After': '1' } },
      { status: 200, body: JSON.stringify(createEftsResponseData()), headers: { 'Content-Type': 'application/json' } },
      { status: 200, body: APPLE_10K_FIXTURE_HTML, headers: { 'Content-Type': 'text/html' } },
    ]);

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    const promise = client.fetchFiling('0000320193-23-000106');
    await vi.advanceTimersByTimeAsync(3000);
    const filing = await promise;

    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    expect(filing.html).toBe(APPLE_10K_FIXTURE_HTML);

    client.dispose();
  });

  it('should work with default rate limiter (no explicit injection)', async () => {
    const mockFetch = createEftsMockFetch();

    // No rateLimiter option => default TokenBucketRateLimiter created internally
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    const filing = await client.fetchFiling('0000320193-23-000106');
    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    expect(filing.html).toContain('Apple');

    client.dispose();
  });

  it('should clean up via client.dispose() after use', async () => {
    const mockFetch = createEftsMockFetch();

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    await client.fetchFiling('0000320193-23-000106');
    client.dispose();

    // No leaked timers after dispose
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Live EDGAR tests have been moved to tests/e2e-live/edgar-client.live.test.ts
// Run with: npx vitest run --config vitest.live.config.ts
