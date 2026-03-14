/** A resolved SEC company identity. */
export interface Company {
  /** Central Index Key (zero-padded to 10 digits for API calls) */
  cik: string;
  /** Official company name from SEC */
  name: string;
  /** Stock ticker symbol (may be empty for private filers) */
  ticker: string;
  /** Stock exchange code (e.g., "NYSE", "Nasdaq") */
  exchange: string;
}

/** A candidate match from the tickers data. */
export interface CompanyMatch {
  cik: string;
  name: string;
  ticker: string;
  exchange: string;
}

/** States the search can be in. */
export type SearchStatus = 'idle' | 'searching' | 'resolved' | 'error';
