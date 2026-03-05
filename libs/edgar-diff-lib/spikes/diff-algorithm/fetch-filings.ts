/**
 * Fetches 10-K filing pairs for Apple and Microsoft from SEC EDGAR.
 * Caches locally to fixtures/ — skips if file already exists.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

const FILINGS = [
  {
    name: 'apple-fy2024.htm',
    url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm',
  },
  {
    name: 'apple-fy2023.htm',
    url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm',
  },
  {
    name: 'microsoft-fy2024.htm',
    url: 'https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/msft-20240630.htm',
  },
  {
    name: 'microsoft-fy2023.htm',
    url: 'https://www.sec.gov/Archives/edgar/data/789019/000095017023035122/msft-20230630.htm',
  },
];

const USER_AGENT = 'EdgarDiffSpike admin@example.com';
const DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFiling(name: string, url: string): Promise<void> {
  const filePath = join(FIXTURES_DIR, name);
  if (existsSync(filePath)) {
    console.log(`  ✓ ${name} (cached)`);
    return;
  }

  console.log(`  ↓ Fetching ${name}...`);
  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${name}: ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();
  writeFileSync(filePath, html, 'utf-8');
  console.log(`  ✓ ${name} (${(html.length / 1024).toFixed(0)} KB)`);
}

async function main(): Promise<void> {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  console.log('Fetching EDGAR 10-K filings...\n');

  for (let i = 0; i < FILINGS.length; i++) {
    const { name, url } = FILINGS[i];
    await fetchFiling(name, url);
    if (i < FILINGS.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\nAll filings downloaded.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
