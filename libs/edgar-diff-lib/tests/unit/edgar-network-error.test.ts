import { EdgarNetworkError } from '../../src/client/types.js';

describe('EdgarNetworkError', () => {
  it('should be instanceof Error', () => {
    const err = new EdgarNetworkError(429, '0000320193-23-000106');
    expect(err).toBeInstanceOf(Error);
  });

  it('should have name "EdgarNetworkError"', () => {
    const err = new EdgarNetworkError(404, '0000320193-23-000106');
    expect(err.name).toBe('EdgarNetworkError');
  });

  it('should include statusCode and accessionNumber in message', () => {
    const err = new EdgarNetworkError(503, '0000320193-23-000106');
    expect(err.message).toBe('EDGAR returned 503 for 0000320193-23-000106');
  });

  it('should store statusCode and accessionNumber as properties', () => {
    const err = new EdgarNetworkError(429, '0000320193-23-000106');
    expect(err.statusCode).toBe(429);
    expect(err.accessionNumber).toBe('0000320193-23-000106');
  });

  it('should store optional retryAfter', () => {
    const err = new EdgarNetworkError(429, '0000320193-23-000106', 5);
    expect(err.retryAfter).toBe(5);
  });

  it('should have undefined retryAfter when not provided', () => {
    const err = new EdgarNetworkError(429, '0000320193-23-000106');
    expect(err.retryAfter).toBeUndefined();
  });
});
