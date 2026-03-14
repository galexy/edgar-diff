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
  const data: TickersResponse = await response.json();

  tickerMap = new Map();
  cikMap = new Map();
  allEntries = [];

  for (const entry of Object.values(data)) {
    const match: CompanyMatch = {
      cik: String(entry.cik_str),
      ticker: entry.ticker,
      name: entry.title,
      exchange: entry.exchange,
    };
    tickerMap.set(entry.ticker.toUpperCase(), match);
    // Only set cikMap for first occurrence (avoids overwrite for multi-ticker companies)
    if (!cikMap.has(String(entry.cik_str))) {
      cikMap.set(String(entry.cik_str), match);
    }
    allEntries.push(match);
  }
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
