import { Temporal } from '@js-temporal/polyfill';
import { createEdgarClient } from '../../src/client/edgar-client.js';
import { EdgarNetworkError } from '../../src/client/types.js';

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
    { status: 200, body: opts?.html ?? APPLE_10K_FIXTURE_HTML, headers: { 'Content-Type': 'text/html' } },
  ]);
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

describe.skip('live EDGAR e2e (manual only)', () => {
  // WARNING: Hits real SEC EDGAR APIs (efts.sec.gov + www.sec.gov)
  // Run manually: npx vitest run tests/e2e/ --grep "live EDGAR"
  //
  // Prerequisites:
  //   - Network access to efts.sec.gov and www.sec.gov
  //   - Proper User-Agent: "Company email@domain"
  //   - Respect 10 req/s rate limit
  //   - Not in CI (skip by default)

  it('should fetch a real filing from SEC EDGAR', async () => {
    const client = createEdgarClient({
      userAgent: 'EdgarDiffTest admin@example.com',
    });
    const filing = await client.fetchFiling('0000320193-23-000106');

    expect(filing.accessionNumber).toBe('0000320193-23-000106');
    expect(filing.cik).toBe('0000320193');
    expect(filing.formType).toBe('10-K');
    expect(filing.filingDate.toString()).toBe('2023-11-03');
    expect(filing.primaryDocumentFilename).toMatch(/\.htm$/);
    expect(filing.html.length).toBeGreaterThan(10_000);
  }, 30_000);

  it('should fetch a filing-agent-submitted filing', async () => {
    const client = createEdgarClient({
      userAgent: 'EdgarDiffTest admin@example.com',
    });
    // Use an accession where the submitter CIK ≠ company CIK
    const filing = await client.fetchFiling('0000950170-23-035122');

    // CIK in result should be the company CIK, not the agent CIK
    expect(filing.cik).not.toBe('0000950170');
    expect(filing.accessionNumber).toBe('0000950170-23-035122');
    expect(filing.html.length).toBeGreaterThan(1000);
  }, 30_000);
});
