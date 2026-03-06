import { TokenBucketRateLimiter } from '../../src/client/rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
  describe('construction', () => {
    it('should default to capacity=10: 10 acquires succeed, 11th blocks', async () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter();

      // All 10 should resolve immediately
      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
      }

      // 11th should block
      let resolved = false;
      const p = limiter.acquire().then(() => { resolved = true; });
      expect(resolved).toBe(false);

      // After 100ms (ceil(1000/10)), 1 token refills
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(true);

      await p;
      limiter.dispose();
      vi.useRealTimers();
    });

    it('should accept custom capacity: 5 acquires succeed, 6th blocks', async () => {
      vi.useFakeTimers();
      const limiter = new TokenBucketRateLimiter({ capacity: 5, refillRate: 5 });

      for (let i = 0; i < 5; i++) {
        await limiter.acquire();
      }

      let resolved = false;
      const p = limiter.acquire().then(() => { resolved = true; });
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(200); // ceil(1000/5) = 200ms
      expect(resolved).toBe(true);

      await p;
      limiter.dispose();
      vi.useRealTimers();
    });

    it('should throw on capacity <= 0', () => {
      expect(() => new TokenBucketRateLimiter({ capacity: 0 })).toThrow(
        'capacity and refillRate must be finite positive numbers'
      );
      expect(() => new TokenBucketRateLimiter({ capacity: -1 })).toThrow(
        'capacity and refillRate must be finite positive numbers'
      );
    });

    it('should throw on refillRate <= 0', () => {
      expect(() => new TokenBucketRateLimiter({ refillRate: 0 })).toThrow(
        'capacity and refillRate must be finite positive numbers'
      );
      expect(() => new TokenBucketRateLimiter({ refillRate: -5 })).toThrow(
        'capacity and refillRate must be finite positive numbers'
      );
    });

    it('should throw on NaN capacity or refillRate', () => {
      expect(() => new TokenBucketRateLimiter({ capacity: NaN })).toThrow(
        'capacity and refillRate must be finite positive numbers'
      );
      expect(() => new TokenBucketRateLimiter({ refillRate: NaN })).toThrow(
        'capacity and refillRate must be finite positive numbers'
      );
    });

    it('should throw on Infinity capacity or refillRate', () => {
      expect(() => new TokenBucketRateLimiter({ capacity: Infinity })).toThrow(
        'capacity and refillRate must be finite positive numbers'
      );
      expect(() => new TokenBucketRateLimiter({ refillRate: Infinity })).toThrow(
        'capacity and refillRate must be finite positive numbers'
      );
    });

    it('should use refillRate for timer interval, not capacity', async () => {
      vi.useFakeTimers();
      // capacity=2 (small burst), refillRate=10 (fast refill)
      // Timer interval should be ceil(1000/10) = 100ms, not ceil(1000/2) = 500ms
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 10 });

      await limiter.acquire();
      await limiter.acquire();

      let resolved = false;
      const p = limiter.acquire().then(() => { resolved = true; });

      // At 100ms (refillRate-based interval), 1 token should refill
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(true);

      await p;
      limiter.dispose();
      vi.useRealTimers();
    });
  });

  describe('acquire - bucket empty (queuing and refill)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should block (capacity+1)th acquire until refill', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });

      // Drain bucket
      await limiter.acquire();
      await limiter.acquire();

      // 3rd acquire should block
      let resolved = false;
      const p = limiter.acquire().then(() => { resolved = true; });

      // Not resolved yet
      expect(resolved).toBe(false);

      // After 500ms (ceil(1000/2) = 500ms interval), 1 token refills
      await vi.advanceTimersByTimeAsync(500);
      expect(resolved).toBe(true);

      await p;
      limiter.dispose();
    });

    it('should resolve multiple blocked acquires in FIFO order', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });

      await limiter.acquire();
      await limiter.acquire();

      const order: number[] = [];
      const p3 = limiter.acquire().then(() => order.push(3));
      const p4 = limiter.acquire().then(() => order.push(4));

      // After 500ms, 1 token refills -> p3 resolves
      await vi.advanceTimersByTimeAsync(500);
      expect(order).toEqual([3]);

      // After another 500ms, 1 more token -> p4 resolves
      await vi.advanceTimersByTimeAsync(500);
      expect(order).toEqual([3, 4]);

      await Promise.all([p3, p4]);
      limiter.dispose();
    });

    it('should refill based on elapsed time', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });

      // Drain all 10 tokens
      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
      }

      // Queue up 5 more acquires
      const order: number[] = [];
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(limiter.acquire().then(() => order.push(i)));
      }

      // After 500ms at rate 10/s, ~5 tokens should refill
      await vi.advanceTimersByTimeAsync(500);
      expect(order.length).toBe(5);

      await Promise.all(promises);
      limiter.dispose();
    });

    it('should not exceed capacity when idle', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRate: 3 });

      // Wait a long time (should cap at capacity=3)
      await vi.advanceTimersByTimeAsync(10000);

      // Should be able to acquire exactly 3 immediately
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();

      // 4th should block
      let resolved = false;
      const p = limiter.acquire().then(() => { resolved = true; });
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(334); // ceil(1000/3) = 334ms
      expect(resolved).toBe(true);
      await p;
      limiter.dispose();
    });

    it('should stop refill timer when wait queue drains', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });

      await limiter.acquire();
      await limiter.acquire();

      const p = limiter.acquire();
      // Timer should be running now
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(500);
      await p;

      // Timer should stop after queue drains
      expect(vi.getTimerCount()).toBe(0);
      limiter.dispose();
    });
  });

  describe('acquire - tokens available', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve immediately when tokens are available', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 5, refillRate: 5 });
      await limiter.acquire();
      // No refill timer was started — acquire resolved synchronously
      expect(vi.getTimerCount()).toBe(0);
      limiter.dispose();
    });

    it('should allow N immediate acquires where N = capacity', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(limiter.acquire());
      }
      await Promise.all(promises);
      // All 10 resolved without starting a refill timer
      expect(vi.getTimerCount()).toBe(0);

      // The (N+1)th acquire should start a timer (proving capacity was exhausted)
      const p11 = limiter.acquire();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(100);
      await p11;
      limiter.dispose();
    });

    it('should enforce throughput: 15 acquires at rate=10 take at least 500ms', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 10 });

      // Drain all 10 tokens
      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
      }

      // Queue 5 more acquires (need 5 tokens at 10/s = 500ms)
      const resolvedAt: number[] = [];
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(limiter.acquire().then(() => { resolvedAt.push(Date.now()); }));
      }

      // At time 0, none should have resolved yet
      expect(resolvedAt.length).toBe(0);

      // After 400ms, only 4 should have resolved (4 tokens at 10/s)
      await vi.advanceTimersByTimeAsync(400);
      expect(resolvedAt.length).toBe(4);

      // After another 100ms (total 500ms), all 5 should resolve
      await vi.advanceTimersByTimeAsync(100);
      expect(resolvedAt.length).toBe(5);

      await Promise.all(promises);
      limiter.dispose();
    });
  });

  describe('dispose', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should clear the refill interval timer on dispose()', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });

      await limiter.acquire();
      await limiter.acquire();

      // Start a blocked acquire to trigger the timer
      const p = limiter.acquire();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      limiter.dispose();
      expect(vi.getTimerCount()).toBe(0);

      await p; // should resolve from dispose
    });

    it('should resolve all pending waiters on dispose() (not reject)', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });

      await limiter.acquire();
      await limiter.acquire();

      const results: string[] = [];
      const p1 = limiter.acquire().then(
        () => results.push('resolved'),
        () => results.push('rejected'),
      );
      const p2 = limiter.acquire().then(
        () => results.push('resolved'),
        () => results.push('rejected'),
      );

      limiter.dispose();

      await Promise.all([p1, p2]);
      expect(results).toEqual(['resolved', 'resolved']);
    });

    it('should throw on acquire() after dispose()', async () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });
      limiter.dispose();

      await expect(limiter.acquire()).rejects.toThrow('RateLimiter has been disposed');
    });

    it('should be safe to call dispose() multiple times (idempotent)', () => {
      const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 2 });
      limiter.dispose();
      limiter.dispose(); // should not throw
      limiter.dispose();
    });
  });
});
