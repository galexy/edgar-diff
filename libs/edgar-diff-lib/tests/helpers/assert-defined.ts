import { expect } from 'vitest';

/**
 * Assert that a value is defined (not null/undefined) and narrow its type.
 * Use in tests instead of non-null assertions (`!`).
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
  expect(value, message).toBeDefined();
  expect(value, message).not.toBeNull();
}
