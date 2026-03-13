import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenBucketRateLimiter } from '../../src/client/rate-limiter.js';

// ============================================================
// Property-based tests: rate limiter throughput invariant
//
// For N acquires at rate R tokens/s with capacity C (where N > C),
// elapsed time >= (N - C) * 1000 / R ms.
// This tests the fundamental contract of the token bucket.
// ============================================================

const TEST_COUNT = Number(process.env['RATE_LIMITER_TEST_COUNT'] ?? 50);

interface ThroughputCase {
  label: string;
  capacity: number;
  refillRate: number;
  totalAcquires: number;
  expectedMinMs: number;
}

const throughputCases: ThroughputCase[] = Array.from({ length: TEST_COUNT }, (_, i) => {
  // Random parameters within reasonable ranges
  const capacity = Math.floor(Math.random() * 15) + 1;       // 1-15
  const refillRate = Math.floor(Math.random() * 19) + 2;     // 2-20 tokens/s
  // N must exceed C so some acquires must wait
  const extra = Math.floor(Math.random() * 10) + 1;          // 1-10 extra beyond capacity
  const totalAcquires = capacity + extra;
  const expectedMinMs = extra * 1000 / refillRate;

  return {
    label: `#${i} C=${capacity} R=${refillRate}/s N=${totalAcquires} min=${expectedMinMs.toFixed(0)}ms`,
    capacity,
    refillRate,
    totalAcquires,
    expectedMinMs,
  };
});

describe('property: rate limiter throughput invariant', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(throughputCases)(
    'case $label',
    async ({ capacity, refillRate, totalAcquires, expectedMinMs }) => {
      const limiter = new TokenBucketRateLimiter({ capacity, refillRate });

      // Drain the bucket (first C acquires are immediate)
      for (let i = 0; i < capacity; i++) {
        await limiter.acquire();
      }

      // Queue the remaining acquires
      const extra = totalAcquires - capacity;
      let resolved = 0;
      const promises: Promise<void>[] = [];
      for (let i = 0; i < extra; i++) {
        promises.push(limiter.acquire().then(() => { resolved++; }));
      }

      // None should have resolved yet (bucket was drained)
      expect(resolved).toBe(0);

      // Advance to just before the theoretical minimum — not all should be done
      // Use a small epsilon to account for timer interval granularity
      const intervalMs = Math.ceil(1000 / refillRate);
      const justBefore = expectedMinMs - intervalMs;
      if (justBefore > 0) {
        await vi.advanceTimersByTimeAsync(justBefore);
        expect(resolved).toBeLessThan(extra);
      }

      // Advance well past the minimum — all should resolve
      // Add enough buffer for timer granularity (one extra interval per acquire)
      const buffer = extra * intervalMs;
      await vi.advanceTimersByTimeAsync(expectedMinMs + buffer);
      expect(resolved).toBe(extra);

      await Promise.all(promises);
      limiter.dispose();
    },
  );
});
