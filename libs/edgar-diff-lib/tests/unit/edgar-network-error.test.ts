import { describe, it, expect } from 'vitest';
import { EdgarNetworkError } from '../../src/client/types.js';

describe('EdgarNetworkError', () => {
  it('EdgarNetworkError: can construct and has correct error type', () => {
    const err = new EdgarNetworkError(429, '0000320193-23-000106', 5);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(429);
    expect(err.accessionNumber).toBe('0000320193-23-000106');
    expect(err.retryAfter).toBe(5);
  });
});
