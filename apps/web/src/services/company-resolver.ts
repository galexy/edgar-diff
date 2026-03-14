import type { CompanyMatch } from './types';

interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
  exchange: string;
}

type TickersResponse = Record<string, TickerEntry>;

const MAX_RESULTS = 10;

let tickerMap: Map<string, CompanyMatch> | null = null;
let cikMap: Map<string, CompanyMatch> | null = null;
let allEntries: CompanyMatch[] | null = null;

async function loadTickers(): Promise<void> {
  if (tickerMap) return;

  const response = await fetch('/api/tickers');
  if (!response.ok) {
    throw new Error('Unable to load company data. Ticker and name search unavailable.');
  }

  const data: TickersResponse = await response.json();

  // Build into local vars first — only assign to module-level on success
  const localTickerMap = new Map<string, CompanyMatch>();
  const localCikMap = new Map<string, CompanyMatch>();
  const localEntries: CompanyMatch[] = [];

  for (const entry of Object.values(data)) {
    const match: CompanyMatch = {
      cik: String(entry.cik_str),
      ticker: entry.ticker,
      name: entry.title,
      exchange: entry.exchange,
    };
    localTickerMap.set(entry.ticker.toUpperCase(), match);
    if (!localCikMap.has(String(entry.cik_str))) {
      localCikMap.set(String(entry.cik_str), match);
    }
    localEntries.push(match);
  }

  tickerMap = localTickerMap;
  cikMap = localCikMap;
  allEntries = localEntries;
}

/** Find exact match by ticker (case-insensitive). */
export async function findByTicker(ticker: string): Promise<CompanyMatch | null> {
  await loadTickers();
  return tickerMap!.get(ticker.toUpperCase()) ?? null;
}

/** Find by CIK number (strips leading zeros). */
export async function findByCik(cik: string): Promise<CompanyMatch | null> {
  await loadTickers();
  const normalized = cik.replace(/^0+/, '');
  return cikMap!.get(normalized) ?? null;
}

/** Search companies by query — ticker exact match, CIK lookup, or name substring. */
export async function searchCompanies(query: string): Promise<CompanyMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  await loadTickers();

  const results: CompanyMatch[] = [];
  const seen = new Set<string>();

  // Try exact ticker match first
  const tickerMatch = tickerMap!.get(trimmed.toUpperCase());
  if (tickerMatch && !seen.has(`${tickerMatch.cik}-${tickerMatch.ticker}`)) {
    results.push(tickerMatch);
    seen.add(`${tickerMatch.cik}-${tickerMatch.ticker}`);
  }

  // Try CIK lookup if all digits
  if (/^\d+$/.test(trimmed)) {
    const normalized = trimmed.replace(/^0+/, '');
    const cikMatch = cikMap!.get(normalized);
    if (cikMatch && !seen.has(`${cikMatch.cik}-${cikMatch.ticker}`)) {
      results.push(cikMatch);
      seen.add(`${cikMatch.cik}-${cikMatch.ticker}`);
    }
  }

  // Name search (case-insensitive substring)
  const lowerQuery = trimmed.toLowerCase();
  for (const entry of allEntries!) {
    if (results.length >= MAX_RESULTS) break;
    const key = `${entry.cik}-${entry.ticker}`;
    if (seen.has(key)) continue;
    if (entry.name.toLowerCase().includes(lowerQuery)) {
      results.push(entry);
      seen.add(key);
    }
  }

  return results.slice(0, MAX_RESULTS);
}

/** Reset cache — for testing only. */
export function _resetCache(): void {
  tickerMap = null;
  cikMap = null;
  allEntries = null;
}
