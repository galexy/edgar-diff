import { describe, it, expect, vi } from 'vitest';
import { assertDefined } from '../helpers/assert-defined.js';
import { Temporal } from '@js-temporal/polyfill';
import { createEdgarClient } from '../../src/client/edgar-client.js';
import { EdgarNetworkError } from '../../src/client/types.js';

// --- Test Data ---

const MOCK_EFTS_RESPONSE = {
  hits: {
    total: { value: 7, relation: 'eq' },
    hits: [
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
      {
        _id: '0000320193-23-000106:aapl-20230930_g1.jpg',
        _source: {
          ciks: ['0000320193'],
          root_forms: ['10-K'],
          form: '10-K',
          file_date: '2023-11-03',
          adsh: '0000320193-23-000106',
          sequence: 2,
        },
      },
    ],
  },
};

const MOCK_EFTS_JSON = JSON.stringify(MOCK_EFTS_RESPONSE);

const MOCK_FILING_HTML = `<!DOCTYPE html>
<html>
<head><title>APPLE INC - 10-K</title></head>
<body>
<div style="font-weight:bold">UNITED STATES SECURITIES AND EXCHANGE COMMISSION</div>
<div>FORM 10-K</div>
<div>Apple Inc.</div>
<h2>Item 1. Business</h2>
<p>Apple Inc. designs, manufactures, and markets smartphones...</p>
</body>
</html>`;

function createMockFetchSequence(
  responses: Array<{ status: number; body: string; headers?: Record<string, string> }>
): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    assertDefined(resp);
    callIndex++;
    return Promise.resolve(new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    }));
  }) as typeof globalThis.fetch;
}

// --- Tests ---

describe('createEdgarClient', () => {
  describe('fetchFiling happy path', () => {
    it('should return a complete RawFiling for a valid accession number', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.accessionNumber).toBe('0000320193-23-000106');
      expect(filing.cik).toBe('0000320193');
      expect(filing.formType).toBe('10-K');
      expect(filing.filingDate.toString()).toBe('2023-11-03');
      expect(filing.primaryDocumentFilename).toBe('aapl-20230930.htm');
      expect(filing.html).toBe(MOCK_FILING_HTML);
      expect(filing.fetchedAt).toBeInstanceOf(Temporal.Instant);
    });

    it('should send User-Agent header on all requests', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({
        userAgent: 'MyCorp admin@mycorp.com',
        fetch: mockFetch,
      });

      await client.fetchFiling('0000320193-23-000106');

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      for (const [, init] of calls) {
        expect((init as RequestInit).headers).toEqual(
          expect.objectContaining({ 'User-Agent': 'MyCorp admin@mycorp.com' })
        );
      }
    });
  });

  describe('EFTS URL construction', () => {
    it('should query EFTS with quoted accession number', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      await client.fetchFiling('0000320193-23-000106');

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      const eftsUrl = calls[0][0] as string;
      expect(eftsUrl).toBe(
        'https://efts.sec.gov/LATEST/search-index?q=%220000320193-23-000106%22'
      );
    });
  });

  describe('document URL construction', () => {
    it('should construct correct Archives URL with CIK leading zeros stripped', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      await client.fetchFiling('0000320193-23-000106');

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      const htmlUrl = calls[1][0] as string;
      expect(htmlUrl).toBe(
        'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm'
      );
    });

    it('should strip CIK leading zeros for single-digit CIK', async () => {
      const singleDigitCikResponse = {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{
            _id: '0000000001-24-000001:filing.htm',
            _source: {
              ciks: ['0000000001'],
              form: '10-K',
              file_date: '2024-01-01',
              adsh: '0000000001-24-000001',
              sequence: 1,
            },
          }],
        },
      };

      const mockFetch = createMockFetchSequence([
        { status: 200, body: JSON.stringify(singleDigitCikResponse) },
        { status: 200, body: '<html></html>' },
      ]);

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      await client.fetchFiling('0000000001-24-000001');

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      const htmlUrl = calls[1][0] as string;
      expect(htmlUrl).toContain('/data/1/');
    });
  });

  describe('EFTS response parsing', () => {
    it('should select hit with sequence === 1 even if not first', async () => {
      const response = {
        hits: {
          total: { value: 3, relation: 'eq' },
          hits: [
            {
              _id: '0000320193-23-000106:exhibit1.htm',
              _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', adsh: '0000320193-23-000106', sequence: 3 },
            },
            {
              _id: '0000320193-23-000106:exhibit2.htm',
              _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', adsh: '0000320193-23-000106', sequence: 2 },
            },
            {
              _id: '0000320193-23-000106:primary.htm',
              _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', adsh: '0000320193-23-000106', sequence: 1 },
            },
          ],
        },
      };

      const mockFetch = createMockFetchSequence([
        { status: 200, body: JSON.stringify(response) },
        { status: 200, body: '<html></html>' },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.primaryDocumentFilename).toBe('primary.htm');
    });

    it('should use ciks[0] from EFTS, not accession prefix', async () => {
      const agentResponse = {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{
            _id: '0000950170-23-035122:filing.htm',
            _source: {
              ciks: ['0000320193'],
              form: '10-K',
              file_date: '2023-11-03',
              adsh: '0000950170-23-035122',
              sequence: 1,
            },
          }],
        },
      };

      const mockFetch = createMockFetchSequence([
        { status: 200, body: JSON.stringify(agentResponse) },
        { status: 200, body: '<html></html>' },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000950170-23-035122');

      expect(filing.cik).toBe('0000320193');
      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      const htmlUrl = calls[1][0] as string;
      expect(htmlUrl).toContain('/data/320193/');
      expect(htmlUrl).not.toContain('/data/950170/');
    });

    it('should handle multi-CIK response using ciks[0]', async () => {
      const multiCikResponse = {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{
            _id: '0000320193-23-000106:filing.htm',
            _source: {
              ciks: ['0000320193', '0000950170'],
              form: '10-K',
              file_date: '2023-11-03',
              adsh: '0000320193-23-000106',
              sequence: 1,
            },
          }],
        },
      };

      const mockFetch = createMockFetchSequence([
        { status: 200, body: JSON.stringify(multiCikResponse) },
        { status: 200, body: '<html></html>' },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.cik).toBe('0000320193');
    });

    it('should accept amendment form types', async () => {
      const amendmentResponse = {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{
            _id: '0000320193-23-000106:filing.htm',
            _source: {
              ciks: ['0000320193'],
              form: '10-K/A',
              file_date: '2023-11-03',
              adsh: '0000320193-23-000106',
              sequence: 1,
            },
          }],
        },
      };

      const mockFetch = createMockFetchSequence([
        { status: 200, body: JSON.stringify(amendmentResponse) },
        { status: 200, body: '<html></html>' },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.formType).toBe('10-K/A');
    });

    it('should extract filename with colon using substring(indexOf) not split', async () => {
      const colonFilenameResponse = {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{
            _id: '0000320193-23-000106:file:with:colons.htm',
            _source: {
              ciks: ['0000320193'],
              form: '10-K',
              file_date: '2023-11-03',
              adsh: '0000320193-23-000106',
              sequence: 1,
            },
          }],
        },
      };

      const mockFetch = createMockFetchSequence([
        { status: 200, body: JSON.stringify(colonFilenameResponse) },
        { status: 200, body: '<html></html>' },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.primaryDocumentFilename).toBe('file:with:colons.htm');
    });

    it('should pass through unrecognized form types', async () => {
      const unknownFormResponse = {
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{
            _id: '0000320193-23-000106:filing.htm',
            _source: {
              ciks: ['0000320193'],
              form: '4',
              file_date: '2023-11-03',
              adsh: '0000320193-23-000106',
              sequence: 1,
            },
          }],
        },
      };

      const mockFetch = createMockFetchSequence([
        { status: 200, body: JSON.stringify(unknownFormResponse) },
        { status: 200, body: '<html></html>' },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.formType).toBe('4');
    });
  });

  describe('EFTS error handling', () => {
    it('should throw EdgarNetworkError(404) when EFTS returns zero hits', async () => {
      const emptyResponse = { hits: { total: { value: 0 }, hits: [] } };
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(emptyResponse), { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const err = await client.fetchFiling('9999999999-99-999999').catch((e: unknown) => e) as EdgarNetworkError;

      expect(err).toBeInstanceOf(EdgarNetworkError);
      expect(err.statusCode).toBe(404);
      expect(err.accessionNumber).toBe('9999999999-99-999999');
    });

    it('should throw when EFTS returns hits but none with sequence 1', async () => {
      const noSeq1Response = {
        hits: {
          total: { value: 2 },
          hits: [
            { _id: 'acc:exhibit1.htm', _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', sequence: 2 } },
            { _id: 'acc:exhibit2.htm', _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', sequence: 3 } },
          ],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(noSeq1Response), { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
    });

    it('should throw on malformed EFTS JSON response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('not valid json {{{', { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
    });

    it('should throw when _id has no colon separator', async () => {
      const malformedIdResponse = {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: 'malformed-no-colon',
            _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', sequence: 1 },
          }],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(malformedIdResponse), { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
    });

    it('should throw when _id has empty filename after colon', async () => {
      const emptyFilenameResponse = {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: '0000320193-23-000106:',
            _source: { ciks: ['0000320193'], form: '10-K', file_date: '2023-11-03', sequence: 1 },
          }],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(emptyFilenameResponse), { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
    });

    it('should throw when ciks array is missing', async () => {
      const noCiksResponse = {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: '0000320193-23-000106:filing.htm',
            _source: { form: '10-K', file_date: '2023-11-03', sequence: 1 },
          }],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(noCiksResponse), { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
    });

    it('should throw when ciks array is empty', async () => {
      const emptyCiksResponse = {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: '0000320193-23-000106:filing.htm',
            _source: { ciks: [], form: '10-K', file_date: '2023-11-03', sequence: 1 },
          }],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(emptyCiksResponse), { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
    });

    it('should throw when form field is missing', async () => {
      const noFormResponse = {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: '0000320193-23-000106:filing.htm',
            _source: { ciks: ['0000320193'], file_date: '2023-11-03', sequence: 1 },
          }],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(noFormResponse), { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
    });

    it('should throw when file_date is missing', async () => {
      const noDateResponse = {
        hits: {
          total: { value: 1 },
          hits: [{
            _id: '0000320193-23-000106:filing.htm',
            _source: { ciks: ['0000320193'], form: '10-K', sequence: 1 },
          }],
        },
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(noDateResponse), { status: 200 })
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow();
    });
  });

  describe('RawFiling assembly', () => {
    it('should create filingDate as Temporal.PlainDate', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.filingDate).toBeInstanceOf(Temporal.PlainDate);
      expect(filing.filingDate.year).toBe(2023);
      expect(filing.filingDate.month).toBe(11);
      expect(filing.filingDate.day).toBe(3);
    });

    it('should set fetchedAt as a recent Temporal.Instant', async () => {
      const before = Temporal.Now.instant();

      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      const after = Temporal.Now.instant();
      expect(Temporal.Instant.compare(filing.fetchedAt, before)).toBeGreaterThanOrEqual(0);
      expect(Temporal.Instant.compare(filing.fetchedAt, after)).toBeLessThanOrEqual(0);
    });

    it('should preserve full html content', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.html).toBe(MOCK_FILING_HTML);
    });
  });

  describe('accession number validation', () => {
    it('should throw on invalid accession number without making requests', async () => {
      const mockFetch = vi.fn<typeof globalThis.fetch>();
      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });

      await expect(client.fetchFiling('invalid')).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should trim whitespace from accession number', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('  0000320193-23-000106  ');

      expect(filing.accessionNumber).toBe('0000320193-23-000106');
    });
  });

  describe('HTML fetch errors', () => {
    it('should throw EdgarNetworkError when HTML document returns 404', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 404, body: 'Not Found' },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const err = await client.fetchFiling('0000320193-23-000106').catch((e: unknown) => e) as EdgarNetworkError;

      expect(err).toBeInstanceOf(EdgarNetworkError);
      expect(err.statusCode).toBe(404);
    });

    it('should return non-HTML content in html field without error', async () => {
      const xmlContent = '<?xml version="1.0"?><filing><data>test</data></filing>';
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: xmlContent },
      ]);

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.html).toBe(xmlContent);
    });
  });

  describe('network errors', () => {
    it('should propagate fetch abort errors unwrapped', async () => {
      const mockFetch = vi.fn().mockRejectedValue(
        new DOMException('The operation was aborted', 'AbortError')
      );

      const client = createEdgarClient({ userAgent: 'TestCo test@example.com', fetch: mockFetch });
      await expect(client.fetchFiling('0000320193-23-000106')).rejects.toThrow('aborted');
    });
  });

  describe('rate limiter integration', () => {
    function createMockRateLimiter() {
      return {
        acquire: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      };
    }

    it('should call rateLimiter.acquire() exactly twice for a fetchFiling call (EFTS + HTML)', async () => {
      const mockRateLimiter = createMockRateLimiter();
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
        rateLimiter: mockRateLimiter,
      });

      await client.fetchFiling('0000320193-23-000106');
      expect(mockRateLimiter.acquire).toHaveBeenCalledTimes(2);
    });

    it('should create a default TokenBucketRateLimiter when none provided', async () => {
      vi.useFakeTimers();

      // URL-aware mock that handles concurrent requests correctly
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('efts.sec.gov')) {
          return Promise.resolve(new Response(MOCK_EFTS_JSON, { status: 200 }));
        }
        return Promise.resolve(new Response(MOCK_FILING_HTML, { status: 200 }));
      }) as typeof globalThis.fetch;

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      // 6 fetchFiling calls = 12 acquires, exceeding default capacity of 10
      const fetchTimestamps: number[] = [];
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 6; i++) {
        promises.push(
          client.fetchFiling('0000320193-23-000106').then(() => {
            fetchTimestamps.push(Date.now());
          }),
        );
      }

      // Advance time enough for all queued acquires to resolve
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.all(promises);

      // Some filings should have been delayed, proving a real rate limiter is active
      const startTime = fetchTimestamps[0];
      assertDefined(startTime);
      const delayedFilings = fetchTimestamps.filter((ts) => ts > startTime);
      expect(delayedFilings.length).toBeGreaterThan(0);

      client.dispose();
      vi.useRealTimers();
    });

    it('should use the injected rateLimiter when provided in options', async () => {
      const mockRateLimiter = createMockRateLimiter();
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
        rateLimiter: mockRateLimiter,
      });

      await client.fetchFiling('0000320193-23-000106');
      expect(mockRateLimiter.acquire).toHaveBeenCalled();
    });

    it('should call acquire() before each fetch call (ordering)', async () => {
      const callOrder: string[] = [];
      const mockRateLimiter = {
        acquire: vi.fn().mockImplementation(() => {
          callOrder.push('acquire');
          return Promise.resolve();
        }),
        dispose: vi.fn(),
      };

      let fetchCallIndex = 0;
      const responses = [
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ];
      const mockFetch = vi.fn().mockImplementation(() => {
        callOrder.push('fetch');
        const resp = responses[fetchCallIndex++];
        assertDefined(resp);
        return Promise.resolve(new Response(resp.body, { status: resp.status }));
      }) as typeof globalThis.fetch;

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
        rateLimiter: mockRateLimiter,
      });

      await client.fetchFiling('0000320193-23-000106');
      expect(callOrder).toEqual(['acquire', 'fetch', 'acquire', 'fetch']);
    });

    it('should only dispose rate limiter if client created it (ownsLimiter)', async () => {
      const mockFetch = createMockFetchSequence([
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      // Client creates its own limiter — dispose should clean up
      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
      });

      // dispose() should not throw
      client.dispose();
    });

    it('should NOT dispose an injected rate limiter when client.dispose() is called', async () => {
      const mockRateLimiter = createMockRateLimiter();

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: vi.fn() as typeof globalThis.fetch,
        rateLimiter: mockRateLimiter,
      });

      client.dispose();
      expect(mockRateLimiter.dispose).not.toHaveBeenCalled();
    });

    it('should NOT call acquire() again when fetchWithRetry retries on 429', async () => {
      vi.useFakeTimers();

      const mockRateLimiter = createMockRateLimiter();
      const mockFetch = createMockFetchSequence([
        { status: 429, body: '', headers: { 'Retry-After': '1' } },
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
        rateLimiter: mockRateLimiter,
      });

      const promise = client.fetchFiling('0000320193-23-000106');
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      // acquire called 2 times (EFTS + HTML), NOT 3 (retry does not re-acquire)
      expect(mockRateLimiter.acquire).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should NOT call acquire() again when fetchWithRetry retries on 503', async () => {
      vi.useFakeTimers();

      const mockRateLimiter = createMockRateLimiter();
      const mockFetch = createMockFetchSequence([
        { status: 503, body: '' },
        { status: 200, body: MOCK_EFTS_JSON },
        { status: 200, body: MOCK_FILING_HTML },
      ]);

      const client = createEdgarClient({
        userAgent: 'TestCo test@example.com',
        fetch: mockFetch,
        rateLimiter: mockRateLimiter,
      });

      const promise = client.fetchFiling('0000320193-23-000106');
      // 503 without Retry-After uses exponential backoff: baseDelayMs * 2^0 = 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      // acquire called 2 times (EFTS + HTML), NOT 3 (retry does not re-acquire)
      expect(mockRateLimiter.acquire).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });
});
