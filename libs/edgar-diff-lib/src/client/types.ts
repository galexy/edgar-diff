import { Temporal } from '@js-temporal/polyfill';
import type { RateLimiter } from './rate-limiter.js';

// --- Form Types ---

export type FormType =
  | '10-K' | '10-K/A'
  | '10-Q' | '10-Q/A'
  | '8-K'  | '8-K/A'
  | '20-F' | '20-F/A'
  | 'S-1'  | 'S-1/A'
  | 'DEF 14A'
  | 'SC 13D' | 'SC 13D/A';

// --- Client Options ---

export interface EdgarClientOptions {
  /** User-Agent string. Format: "CompanyName email@domain.com" */
  userAgent: string;
  /**
   * Optional rate limiter. Defaults to a TokenBucketRateLimiter at 10 req/s.
   * Inject a shared instance to coordinate rate limiting across multiple
   * client instances hitting the same EDGAR endpoints.
   */
  rateLimiter?: RateLimiter;
  /** Injectable fetch for testing. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

// --- Raw Filing ---

export interface RawFiling {
  accessionNumber: string;
  cik: string;
  formType: FormType;
  filingDate: Temporal.PlainDate;
  primaryDocumentFilename: string;
  html: string;
  fetchedAt: Temporal.Instant;
}

// --- Errors ---

export class EdgarNetworkError extends Error {
  readonly name = 'EdgarNetworkError' as const;

  constructor(
    public readonly statusCode: number,
    public readonly accessionNumber: string,
    public readonly retryAfter?: number,
  ) {
    super(`EDGAR returned ${statusCode} for ${accessionNumber}`);
  }
}

// --- Internal Types ---

/** Parsed accession number components. */
export interface ParsedAccession {
  /** Raw accession number string (e.g., "0000320193-23-000106") */
  raw: string;
  /** Accession number with dashes removed (e.g., "000032019323000106") */
  noDashes: string;
  /** Submitter CIK from accession prefix (NOT necessarily the company CIK) */
  submitterCik: string;
}

/** Metadata resolved from EFTS search. */
export interface FilingMetadata {
  cik: string;
  formType: string;
  filingDate: string;
  primaryDocumentFilename: string;
}
