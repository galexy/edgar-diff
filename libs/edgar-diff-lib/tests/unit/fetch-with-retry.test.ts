import { fetchWithRetry } from '../../src/client/fetch-with-retry.js';
import { EdgarNetworkError } from '../../src/client/types.js';

describe('fetchWithRetry', () => {
  const defaultOpts = { maxAttempts: 3, baseDelayMs: 1000 };
  const accession = '0000320193-23-000106';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return response on first attempt success', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const resp = await fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch);
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on 429 and succeed on 2nd attempt', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch);
    await vi.advanceTimersByTimeAsync(1000);
    const resp = await promise;

    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on 503 and succeed on 3rd attempt', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch);
    await vi.advanceTimersByTimeAsync(1000); // 1st retry delay
    await vi.advanceTimersByTimeAsync(2000); // 2nd retry delay
    const resp = await promise;

    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should throw EdgarNetworkError after exhausting retries on 429', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));

    const result = fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
      .then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const err = await result as EdgarNetworkError;
    expect(err).toBeInstanceOf(EdgarNetworkError);
    expect(err.statusCode).toBe(429);
    expect(err.accessionNumber).toBe(accession);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should throw EdgarNetworkError after exhausting retries on 503', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));

    const result = fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
      .then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    const err = await result as EdgarNetworkError;
    expect(err).toBeInstanceOf(EdgarNetworkError);
    expect(err.statusCode).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should NOT retry on 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(
      fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
    ).rejects.toThrow(EdgarNetworkError);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry on 400', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
    await expect(
      fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
    ).rejects.toThrow(EdgarNetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry on 403', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    await expect(
      fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
    ).rejects.toThrow(EdgarNetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry on 500', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    await expect(
      fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
    ).rejects.toThrow(EdgarNetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should honor Retry-After header', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch);

    // Should NOT resolve after 4 seconds
    await vi.advanceTimersByTimeAsync(4000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Should resolve after 5 seconds total
    await vi.advanceTimersByTimeAsync(1000);
    const resp = await promise;
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should use exponential backoff: 1s then 2s', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch);

    // After 999ms, still only 1 call
    await vi.advanceTimersByTimeAsync(999);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // After 1ms more (total 1000ms), 2nd call
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // After 1999ms more (still under 2s backoff for 2nd retry)
    await vi.advanceTimersByTimeAsync(1999);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // After 1ms more (total 2000ms since 2nd call), 3rd call
    await vi.advanceTimersByTimeAsync(1);
    const resp = await promise;
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should propagate network errors (fetch throws)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
    ).rejects.toThrow(TypeError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should propagate abort errors', async () => {
    const mockFetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError')
    );
    await expect(
      fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
    ).rejects.toThrow('aborted');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should pass through request init', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const init = { headers: { 'User-Agent': 'TestCo test@example.com' } };

    await fetchWithRetry('https://example.com', init, defaultOpts, accession, mockFetch);

    expect(mockFetch).toHaveBeenCalledWith('https://example.com', init);
  });

  it('should include retryAfter on EdgarNetworkError when header present', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('', { status: 429, headers: { 'Retry-After': '10' } })
    );

    const promise = fetchWithRetry('https://example.com', {}, defaultOpts, accession, mockFetch)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(10000);

    const err = await promise as EdgarNetworkError;
    expect(err).toBeInstanceOf(EdgarNetworkError);
    expect(err.retryAfter).toBe(10);
  });
});
