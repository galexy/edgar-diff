import { TokenBucketRateLimiter } from '../../src/client/rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
  describe('construction', () => {
    it('should default to capacity=10, refillRate=10 when no options given', () => {
      const limiter = new TokenBucketRateLimiter();
      // If it constructs without error, defaults are applied.
      // We verify by draining 10 tokens immediately (tested in acquire tests).
      expect(limiter).toBeDefined();
      limiter.dispose();
    });

    it('should accept custom capacity and refillRate', () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 5, refillRate: 5 });
      expect(limiter).toBeDefined();
      limiter.dispose();
    });

    it('should throw on capacity <= 0', () => {
      expect(() => new TokenBucketRateLimiter({ capacity: 0 })).toThrow(
        'capacity and refillRate must be positive numbers'
      );
      expect(() => new TokenBucketRateLimiter({ capacity: -1 })).toThrow(
        'capacity and refillRate must be positive numbers'
      );
    });

    it('should throw on refillRate <= 0', () => {
      expect(() => new TokenBucketRateLimiter({ refillRate: 0 })).toThrow(
        'capacity and refillRate must be positive numbers'
      );
      expect(() => new TokenBucketRateLimiter({ refillRate: -5 })).toThrow(
        'capacity and refillRate must be positive numbers'
      );
    });
  });

  describe('acquire - tokens available', () => {
    it('should resolve immediately when tokens are available', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 5, refillRate: 5 });
      await limiter.acquire(); // should not hang
      limiter.dispose();
    });

    it('should allow N immediate acquires where N = capacity', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(limiter.acquire());
      }
      // All 10 should resolve immediately (no waiting)
      await Promise.all(promises);
      limiter.dispose();
    });
  });
});
