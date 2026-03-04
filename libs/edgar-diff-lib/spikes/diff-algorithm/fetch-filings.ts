/**
 * Fetch 10-K filings from SEC EDGAR for diff algorithm spike.
 * Caches locally in fixtures/ to avoid repeated downloads.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

const USER_AGENT = 'EdgarDiffSpike admin@example.com';

const FILINGS = [
  {
    name: 'apple-fy2024.html',
    url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm',
  },
  {
    name: 'apple-fy2023.html',
    url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm',
  },
  {
    name: 'msft-fy2024.html',
    url: 'https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/msft-20240630.htm',
  },
  {
    name: 'msft-fy2023.html',
    url: 'https://www.sec.gov/Archives/edgar/data/789019/000095017023035122/msft-20230630.htm',
  },
];

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFiling(name: string, url: string): Promise<void> {
  const outPath = join(FIXTURES_DIR, name);

  if (await fileExists(outPath)) {
    const s = await stat(outPath);
    console.log(`✓ ${name} already cached (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
    return;
  }

  console.log(`⬇ Fetching ${name}...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
    }

    const html = await resp.text();
    await writeFile(outPath, html, 'utf-8');
    console.log(`✓ ${name} saved (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });

  for (const filing of FILINGS) {
    await fetchFiling(filing.name, filing.url);
    // Respect SEC rate limits
    await sleep(500);
  }

  console.log('\n✓ All filings ready in fixtures/');
}

main().catch((err) => {
  console.error('Failed to fetch filings:', err);
  process.exit(1);
});
