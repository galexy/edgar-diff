import { describe, it, expect, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { createEdgarClient } from '../../src/client/edgar-client.js';
import { EdgarNetworkError } from '../../src/client/types.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// --- Fixtures ---

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

const AAPL_EFTS_JSON = readFileSync(join(FIXTURES_DIR, 'efts-10k-aapl-2023.json'), 'utf-8');
const TSLA_EFTS_JSON = readFileSync(join(FIXTURES_DIR, 'efts-10k-tsla-2023.json'), 'utf-8');
const AAPL_HTML = readFileSync(join(FIXTURES_DIR, '10k-aapl-2023.html'), 'utf-8');
const TSLA_HTML = readFileSync(join(FIXTURES_DIR, '10k-tsla-2023.html'), 'utf-8');

// --- Mock EFTS for filing-agent CIK mismatch scenario ---
const FILING_AGENT_EFTS_RESPONSE = JSON.stringify({
  hits: {
    total: { value: 1, relation: 'eq' },
    hits: [
      {
        _id: '0000950170-23-035122:aapl-20230701.htm',
        _source: {
          ciks: ['0000320193'],
          root_forms: ['10-Q'],
          form: '10-Q',
          file_date: '2023-08-04',
          adsh: '0000950170-23-035122',
          sequence: 1,
        },
      },
    ],
  },
});

// --- Factory Functions ---

function createMockFetchSequence(
  responses: Array<{ status: number; body: string; headers?: Record<string, string> }>,
): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve(
      new Response(resp!.body, {
        status: resp!.status,
        headers: resp!.headers,
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
    { status: 200, body: opts?.html ?? AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
  ]);
}

// --- Integration Tests ---

describe('fetchFiling integration', () => {
  // 3.1 Full fetchFiling Flow (Happy Path)
  it('should query EFTS, then fetch HTML document, returning complete RawFiling', async () => {
    const mockFetch = createMockFetchSequence([
      { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
      { status: 200, body: AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
    ]);
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    const beforeFetch = Temporal.Now.instant();
    const filing = await client.fetchFiling('0000320193-23-000106');
    const afterFetch = Temporal.Now.instant();

    // Verify RawFiling fields
    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    expect(filing.cik).toBe('0000320193');
    expect(filing.formType).toBe('10-K');
    expect(filing.filingDate.toString()).toBe('2023-11-03');
    expect(filing.filingDate).toBeInstanceOf(Temporal.PlainDate);
    expect(filing.primaryDocumentFilename).toBe('aapl-20230930.htm');
    expect(filing.html).toBe(AAPL_HTML);
    expect(filing.fetchedAt).toBeInstanceOf(Temporal.Instant);
    expect(
      Temporal.Instant.compare(filing.fetchedAt, beforeFetch),
    ).toBeGreaterThanOrEqual(0);
    expect(
      Temporal.Instant.compare(filing.fetchedAt, afterFetch),
    ).toBeLessThanOrEqual(0);

    // Verify fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // 1st call: EFTS search-index
    const firstCall = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toContain('efts.sec.gov/LATEST/search-index');
    expect(firstCall[0]).toContain('q=%220000320193-23-000106%22');

    // 2nd call: HTML document from Archives
    const secondCall = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[0]).toBe(
      'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm',
    );

    // User-Agent sent on both requests
    for (const call of (mockFetch as ReturnType<typeof vi.fn>).mock.calls) {
      const headers = call[1]?.headers;
      const ua =
        headers instanceof Headers
          ? headers.get('User-Agent')
          : headers?.['User-Agent'];
      expect(ua).toBe('TestCo test@example.com');
    }
  });

  // 3.2 EFTS → URL Construction → HTML Pipeline
  it('should construct correct Archives URL from EFTS metadata', async () => {
    const mockFetch = createEftsMockFetch();
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });
    await client.fetchFiling('0000320193-23-000106');

    const secondCall = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[0]).toBe(
      'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm',
    );
  });

  it('should use CIK from EFTS response, not from accession prefix', async () => {
    const mockFetch = createMockFetchSequence([
      { status: 200, body: FILING_AGENT_EFTS_RESPONSE, headers: { 'Content-Type': 'application/json' } },
      { status: 200, body: AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
    ]);
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    const filing = await client.fetchFiling('0000950170-23-035122');

    // CIK should come from EFTS (Apple's CIK), not accession prefix (filing agent)
    expect(filing.cik).toBe('0000320193');

    // HTML fetch URL should use Apple's CIK (320193), not the filing agent's (950170)
    const secondCall = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[0]).toContain('/data/320193/');
    expect(secondCall[0]).not.toContain('/data/950170/');
  });

  // 3.3 Retry Behavior on Transient Failures
  describe('retry behavior', () => {
    it('should retry EFTS 429 and succeed on second attempt', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 429, body: '', headers: { 'Retry-After': '1' } },
        { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
        { status: 200, body: AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
      ]);
      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      vi.useFakeTimers();
      const promise = client.fetchFiling('0000320193-23-000106');
      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(2000);
      const filing = await promise;
      vi.useRealTimers();

      expect(filing.accessionNumber).toBe('0000320193-23-000106');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should retry EFTS 503 and succeed on third attempt', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 503, body: 'Service Unavailable' },
        { status: 503, body: 'Service Unavailable' },
        { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
        { status: 200, body: AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
      ]);
      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      vi.useFakeTimers();
      const promise = client.fetchFiling('0000320193-23-000106');
      await vi.advanceTimersByTimeAsync(5000);
      const filing = await promise;
      vi.useRealTimers();

      expect(filing.accessionNumber).toBe('0000320193-23-000106');
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should retry HTML fetch 503 independently from EFTS', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
        { status: 503, body: 'Service Unavailable' },
        { status: 200, body: AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
      ]);
      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      vi.useFakeTimers();
      const promise = client.fetchFiling('0000320193-23-000106');
      await vi.advanceTimersByTimeAsync(3000);
      const filing = await promise;
      vi.useRealTimers();

      expect(filing.accessionNumber).toBe('0000320193-23-000106');
      expect(filing.html).toBe(AAPL_HTML);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should exhaust EFTS retries on persistent 429 and throw', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 429, body: '', headers: { 'Retry-After': '1' } },
        { status: 429, body: '', headers: { 'Retry-After': '1' } },
        { status: 429, body: '' },
      ]);
      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      vi.useFakeTimers();
      const result = client.fetchFiling('0000320193-23-000106')
        .then(() => null, (e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10000);
      const err = await result;
      vi.useRealTimers();

      expect(err).toBeInstanceOf(EdgarNetworkError);
      expect((err as EdgarNetworkError).statusCode).toBe(429);
      // Only EFTS calls, no HTML fetch attempted
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should exhaust HTML retries independently after EFTS succeeds', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
        { status: 503, body: 'Service Unavailable' },
        { status: 503, body: 'Service Unavailable' },
        { status: 503, body: 'Service Unavailable' },
      ]);
      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      vi.useFakeTimers();
      const result = client.fetchFiling('0000320193-23-000106')
        .then(() => null, (e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10000);
      const err = await result;
      vi.useRealTimers();

      expect(err).toBeInstanceOf(EdgarNetworkError);
      expect((err as EdgarNetworkError).statusCode).toBe(503);
      // 1 EFTS + 3 HTML attempts
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  // 3.4 Multiple Sequential Fetches
  it('should handle multiple sequential fetchFiling calls with different accessions', async () => {
    // First fetch: Apple
    const appleMockFetch = createMockFetchSequence([
      { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
      { status: 200, body: AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
      // Second fetch sequence: Tesla
      { status: 200, body: TSLA_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
      { status: 200, body: TSLA_HTML, headers: { 'Content-Type': 'text/html' } },
    ]);

    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: appleMockFetch,
    });

    const appleFiling = await client.fetchFiling('0000320193-23-000106');
    expect(appleFiling.accessionNumber).toBe('0000320193-23-000106');
    expect(appleFiling.cik).toBe('0000320193');
    expect(appleFiling.formType).toBe('10-K');
    expect(appleFiling.html).toBe(AAPL_HTML);

    const teslaFiling = await client.fetchFiling('0001318605-24-000046');
    expect(teslaFiling.accessionNumber).toBe('0001318605-24-000046');
    expect(teslaFiling.cik).toBe('0001318605');
    expect(teslaFiling.formType).toBe('10-K');
    expect(teslaFiling.html).toBe(TSLA_HTML);

    expect(appleMockFetch).toHaveBeenCalledTimes(4);
  });

  // 3.5 EFTS Edge Cases in Integration Context
  it('should handle EFTS response with multiple hits selecting sequence-1', async () => {
    // Using the full Apple EFTS fixture which has 7 hits
    const mockFetch = createMockFetchSequence([
      { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
      { status: 200, body: AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
    ]);
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    const filing = await client.fetchFiling('0000320193-23-000106');
    // Should have selected the sequence-1 hit's filename
    expect(filing.primaryDocumentFilename).toBe('aapl-20230930.htm');
  });

  it('should handle EFTS response where sequence-1 is not the first hit', async () => {
    // Reorder hits so sequence-1 is last
    const reorderedEfts = JSON.stringify({
      hits: {
        total: { value: 3, relation: 'eq' },
        hits: [
          {
            _id: '0000320193-23-000106:exhibit1.htm',
            _source: {
              ciks: ['0000320193'],
              root_forms: ['10-K'],
              form: 'EX-4.1',
              file_date: '2023-11-03',
              adsh: '0000320193-23-000106',
              sequence: 3,
            },
          },
          {
            _id: '0000320193-23-000106:exhibit2.htm',
            _source: {
              ciks: ['0000320193'],
              root_forms: ['10-K'],
              form: 'EX-21.1',
              file_date: '2023-11-03',
              adsh: '0000320193-23-000106',
              sequence: 2,
            },
          },
          {
            _id: '0000320193-23-000106:aapl-20230930.htm',
            _source: {
              ciks: ['0000320193'],
              root_forms: ['10-K'],
              form: '10-K',
              file_date: '2023-11-03',
              adsh: '0000320193-23-000106',
              sequence: 1,
            },
          },
        ],
      },
    });

    const mockFetch = createMockFetchSequence([
      { status: 200, body: reorderedEfts, headers: { 'Content-Type': 'application/json' } },
      { status: 200, body: AAPL_HTML, headers: { 'Content-Type': 'text/html' } },
    ]);
    const client = createEdgarClient({
      userAgent: 'TestCo test@example.com',
      fetch: mockFetch,
    });

    const filing = await client.fetchFiling('0000320193-23-000106');
    expect(filing.primaryDocumentFilename).toBe('aapl-20230930.htm');
  });

  // Error Conditions (section 6)
  describe('error conditions', () => {
    it('should propagate fetch abort errors (not wrapped in EdgarNetworkError)', async () => {
      const mockFetch = vi.fn().mockRejectedValue(
        new DOMException('The operation was aborted', 'AbortError'),
      );
      const client = createEdgarClient({
        userAgent: 'Test test@test.com',
        fetch: mockFetch as typeof globalThis.fetch,
      });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow(
        'aborted',
      );
    });

    it('should throw EdgarNetworkError on EFTS 404', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Not Found', { status: 404 }),
      );
      const client = createEdgarClient({
        userAgent: 'Test test@test.com',
        fetch: mockFetch as typeof globalThis.fetch,
      });
      const err = await client
        .fetchFiling('9999999999-99-999999')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EdgarNetworkError);
      expect((err as EdgarNetworkError).statusCode).toBe(404);
      expect((err as EdgarNetworkError).accessionNumber).toBe('9999999999-99-999999');
    });

    it('should throw EdgarNetworkError(404) when EFTS returns zero hits', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }),
          { status: 200 },
        ),
      );
      const client = createEdgarClient({
        userAgent: 'Test test@test.com',
        fetch: mockFetch as typeof globalThis.fetch,
      });
      const err = await client
        .fetchFiling('9999999999-99-999999')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EdgarNetworkError);
      expect((err as EdgarNetworkError).statusCode).toBe(404);
    });

    it('should exhaust retries on persistent EFTS 503', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Service Unavailable', { status: 503 }),
      );
      const client = createEdgarClient({
        userAgent: 'Test test@test.com',
        fetch: mockFetch as typeof globalThis.fetch,
      });

      vi.useFakeTimers();
      const result = client.fetchFiling('0000320193-23-000106')
        .then(() => null, (e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10000);
      const err = await result;
      vi.useRealTimers();

      expect(err).toBeInstanceOf(EdgarNetworkError);
      expect((err as EdgarNetworkError).statusCode).toBe(503);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw EdgarNetworkError when HTML document returns 404', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
        { status: 404, body: 'Not Found' },
      ]);
      const client = createEdgarClient({
        userAgent: 'Test test@test.com',
        fetch: mockFetch,
      });
      const err = await client
        .fetchFiling('0000320193-23-000106')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EdgarNetworkError);
      expect((err as EdgarNetworkError).statusCode).toBe(404);
    });

    it('should throw on malformed EFTS JSON response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('not valid json {{{', { status: 200 }),
      );
      const client = createEdgarClient({
        userAgent: 'Test test@test.com',
        fetch: mockFetch as typeof globalThis.fetch,
      });
      await expect(
        client.fetchFiling('0000320193-23-000106'),
      ).rejects.toThrow();
    });

    it('should throw when EFTS returns hits but none with sequence 1', async () => {
      const noSeq1Response = JSON.stringify({
        hits: {
          total: { value: 2 },
          hits: [
            {
              _id: '0000320193-23-000106:exhibit1.htm',
              _source: {
                ciks: ['0000320193'],
                form: '10-K',
                file_date: '2023-11-03',
                sequence: 2,
              },
            },
            {
              _id: '0000320193-23-000106:exhibit2.htm',
              _source: {
                ciks: ['0000320193'],
                form: '10-K',
                file_date: '2023-11-03',
                sequence: 3,
              },
            },
          ],
        },
      });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(noSeq1Response, { status: 200 }),
      );
      const client = createEdgarClient({
        userAgent: 'Test test@test.com',
        fetch: mockFetch as typeof globalThis.fetch,
      });
      await expect(
        client.fetchFiling('0000320193-23-000106'),
      ).rejects.toThrow();
    });

    it('should return non-HTML content in html field without error', async () => {
      const xmlContent =
        '<?xml version="1.0"?><filing><data>test</data></filing>';
      const mockFetch = createMockFetchSequence([
        { status: 200, body: AAPL_EFTS_JSON, headers: { 'Content-Type': 'application/json' } },
        {
          status: 200,
          body: xmlContent,
          headers: { 'Content-Type': 'application/xml' },
        },
      ]);
      const client = createEdgarClient({
        userAgent: 'Test test@test.com',
        fetch: mockFetch,
      });
      const filing = await client.fetchFiling('0000320193-23-000106');
      expect(filing.html).toBe(xmlContent);
    });
  });
});
