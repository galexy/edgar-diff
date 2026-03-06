/**
 * fetch-filings.ts — Download 10-K filings from SEC EDGAR
 *
 * Usage: npx tsx scripts/fetch-filings.ts
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(
  import.meta.dirname,
  "..",
  "libs/edgar-diff-lib/tests/integration/fixtures"
);

const USER_AGENT = "edgar-diff research@example.com";
const THROTTLE_MS = 250; // ~4 req/s, well under 10 req/s limit

interface Company {
  ticker: string;
  cik: string;
  years: number[];
}

const COMPANIES: Company[] = [
  { ticker: "aapl", cik: "0000320193", years: [2024, 2023] },
  { ticker: "msft", cik: "0000789019", years: [2024, 2023] },
  { ticker: "amzn", cik: "0001018724", years: [2024] },
  { ticker: "jpm", cik: "0000019617", years: [2024, 2023] },
  { ticker: "jnj", cik: "0000200406", years: [2024] },
  { ticker: "xom", cik: "0000034088", years: [2024, 2012] },
  { ticker: "brk-b", cik: "0001067983", years: [2024] },
  { ticker: "wmt", cik: "0000104169", years: [2024] },
  { ticker: "pg", cik: "0000080424", years: [2024] },
  { ticker: "bac", cik: "0000070858", years: [2024] },
  { ticker: "unh", cik: "0000731766", years: [2024] },
  { ticker: "cvx", cik: "0000093410", years: [2024] },
];

async function throttledFetch(
  url: string,
  retries = 3
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
    if (res.ok) return res;
    if (res.status === 429 || res.status === 503) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      console.warn(
        `  Rate limited (${res.status}), waiting ${retryAfter}s...`
      );
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

interface SubmissionsJson {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      primaryDocument: string[];
      reportDate: string[];
    };
    files: Array<{ name: string }>;
  };
}

async function findFiling(
  cik: string,
  targetYear: number
): Promise<{
  accessionNumber: string;
  primaryDocument: string;
  filingDate: string;
} | null> {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  console.log(`  Fetching submissions for CIK ${cik}...`);
  const res = await throttledFetch(url);
  const data = (await res.json()) as SubmissionsJson;

  const recent = data.filings.recent;

  // Search recent filings for 10-K matching target year
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i];
    if (form !== "10-K") continue;

    const filingDate = recent.filingDate[i];
    const reportDate = recent.reportDate[i];
    // Check if the report date or filing date year matches
    const reportYear = reportDate
      ? parseInt(reportDate.substring(0, 4), 10)
      : 0;
    const filingYear = parseInt(filingDate.substring(0, 4), 10);

    // For fiscal year matching: reportDate year should match targetYear,
    // or filing year should match targetYear or targetYear+1
    // (companies file their annual report the year after fiscal year end)
    if (
      reportYear === targetYear ||
      filingYear === targetYear ||
      filingYear === targetYear + 1
    ) {
      return {
        accessionNumber: recent.accessionNumber[i],
        primaryDocument: recent.primaryDocument[i],
        filingDate,
      };
    }
  }

  // If not found in recent, check older filing index files
  for (const file of data.filings.files) {
    const fileUrl = `https://data.sec.gov/submissions/${file.name}`;
    console.log(`  Checking older filings index: ${file.name}...`);
    const fileRes = await throttledFetch(fileUrl);
    const fileData = (await fileRes.json()) as {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      primaryDocument: string[];
      reportDate: string[];
    };

    for (let i = 0; i < fileData.form.length; i++) {
      if (fileData.form[i] !== "10-K") continue;
      const filingDate = fileData.filingDate[i];
      const reportDate = fileData.reportDate[i];
      const reportYear = reportDate
        ? parseInt(reportDate.substring(0, 4), 10)
        : 0;
      const filingYear = parseInt(filingDate.substring(0, 4), 10);

      if (
        reportYear === targetYear ||
        filingYear === targetYear ||
        filingYear === targetYear + 1
      ) {
        return {
          accessionNumber: fileData.accessionNumber[i],
          primaryDocument: fileData.primaryDocument[i],
          filingDate,
        };
      }
    }
  }

  return null;
}

async function downloadFiling(
  ticker: string,
  cik: string,
  year: number
): Promise<void> {
  const outPath = join(FIXTURES_DIR, `10k-${ticker}-${year}.html`);
  if (existsSync(outPath)) {
    console.log(`  [SKIP] ${outPath} already exists`);
    return;
  }

  console.log(`Fetching ${ticker.toUpperCase()} FY${year}...`);
  const filing = await findFiling(cik, year);
  if (!filing) {
    console.error(`  [FAIL] No 10-K found for ${ticker} FY${year}`);
    return;
  }

  console.log(
    `  Found: accession=${filing.accessionNumber}, doc=${filing.primaryDocument}, filed=${filing.filingDate}`
  );

  const accessionNoDashes = filing.accessionNumber.replace(/-/g, "");
  const cikNum = cik.replace(/^0+/, "");
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNoDashes}/${filing.primaryDocument}`;

  console.log(`  Downloading: ${docUrl}`);
  const res = await throttledFetch(docUrl);
  const html = await res.text();

  writeFileSync(outPath, html, "utf-8");
  console.log(`  [OK] Saved ${outPath} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  if (!existsSync(FIXTURES_DIR)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  console.log(`Downloading filings to: ${FIXTURES_DIR}\n`);

  for (const company of COMPANIES) {
    for (const year of company.years) {
      try {
        await downloadFiling(company.ticker, company.cik, year);
      } catch (err) {
        console.error(
          `  [ERROR] ${company.ticker} FY${year}: ${(err as Error).message}`
        );
      }
    }
  }

  console.log("\nDone!");
}

main();
