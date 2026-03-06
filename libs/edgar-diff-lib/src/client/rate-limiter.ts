/**
 * Minimal interface for rate limiting. Callers can inject their own
 * implementation (e.g., a shared limiter across multiple client instances).
 */
export interface RateLimiter {
  /** Wait until a request is allowed, then consume one token. */
  acquire(): Promise<void>;
  /** Clean up any internal timers. */
  dispose(): void;
}

export interface TokenBucketOptions {
  /** Max tokens (burst capacity). Default: 10 */
  capacity?: number;
  /** Tokens added per second. Default: 10 */
  refillRate?: number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per ms
  private lastRefillTimestamp: number;
  private waitQueue: Array<() => void>;
  private refillTimer: ReturnType<typeof setInterval> | null;
  private disposed = false;

  constructor(options: TokenBucketOptions = {}) {
    const { capacity = 10, refillRate = 10 } = options;
    if (capacity <= 0 || refillRate <= 0) {
      throw new Error('capacity and refillRate must be positive numbers');
    }
    this.capacity = capacity;
    this.tokens = capacity; // start full
    this.refillRate = refillRate / 1000; // tokens per ms
    this.lastRefillTimestamp = Date.now();
    this.waitQueue = [];
    this.refillTimer = null;
  }

  async acquire(): Promise<void> {
    if (this.disposed) {
      throw new Error('RateLimiter has been disposed');
    }
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // No tokens available --- wait for next refill
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
      this.ensureRefillTimer();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.refillTimer !== null) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
    // Resolve any remaining waiters so they don't hang
    for (const resolve of this.waitQueue) {
      resolve();
    }
    this.waitQueue = [];
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.lastRefillTimestamp);
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefillTimestamp = now;
  }

  private ensureRefillTimer(): void {
    if (this.refillTimer !== null) return;
    const intervalMs = Math.ceil(1000 / this.capacity);
    this.refillTimer = setInterval(() => {
      this.refill();
      while (this.tokens >= 1 && this.waitQueue.length > 0) {
        this.tokens -= 1;
        const resolve = this.waitQueue.shift()!;
        resolve();
      }
      if (this.waitQueue.length === 0 && this.refillTimer !== null) {
        clearInterval(this.refillTimer);
        this.refillTimer = null;
      }
    }, intervalMs);
  }
}
