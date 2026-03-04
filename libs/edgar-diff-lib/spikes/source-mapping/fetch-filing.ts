/**
 * Spike A1 — Task 1: Fetch and cache a real 10-K filing from EDGAR.
 *
 * Usage: npx tsx spikes/source-mapping/fetch-filing.ts
 */

import { writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

const FILING_URL =
  'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm';

const USER_AGENT = 'EdgarDiffSpike admin@example.com';

async function fetchFiling(): Promise<void> {
  const outPath = join(FIXTURES_DIR, 'apple-10k.html');

  // Skip if already cached
  try {
    const s = await stat(outPath);
    if (s.size > 0) {
      console.log(`✓ Filing already cached (${(s.size / 1024 / 1024).toFixed(1)} MB): ${outPath}`);
      return;
    }
  } catch {
    // File doesn't exist, proceed with fetch
  }

  await mkdir(FIXTURES_DIR, { recursive: true });

  console.log(`Fetching ${FILING_URL} ...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let resp: Response;
  try {
    resp = await fetch(FILING_URL, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch filing: ${resp.status} ${resp.statusText}. ` +
        `Try finding a valid URL manually via EDGAR full-text search.`,
    );
  }

  const html = await resp.text();
  await writeFile(outPath, html, 'utf-8');
  console.log(`✓ Saved filing (${(html.length / 1024 / 1024).toFixed(1)} MB chars): ${outPath}`);
}

function createMultibyteFixture(): Promise<void> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Multibyte Test</title></head>
<body>
  <!-- Comment with emoji: 🚀🌍 -->
  <h1>Multibyte Character Test</h1>

  <section id="emoji">
    <h2>Emoji Section 🎉</h2>
    <p>Rocket: 🚀 Earth: 🌍 Fire: 🔥 Star: ⭐</p>
    <p>Compound emoji: 👨‍👩‍👧‍👦 Flag: 🇺🇸</p>
  </section>

  <section id="cjk">
    <h2>CJK Characters 中文</h2>
    <p>日本語テスト: これはテストです。</p>
    <p>한국어: 이것은 시험입니다.</p>
    <p>中文: 这是一个测试。</p>
    <p>Mixed: Hello世界🌍test</p>
  </section>

  <section id="accented">
    <h2>Accented Characters</h2>
    <p>French: résumé, naïve, café</p>
    <p>German: Ärger, Über, Straße</p>
    <p>Spanish: señor, niño, año</p>
    <p>Nordic: Ångström, fjörður</p>
  </section>

  <section id="special">
    <h2>Special Unicode</h2>
    <p>Math: ∑∏∫∂√∞≈≠≤≥</p>
    <p>Currency: €£¥₹₽₿</p>
    <p>Arrows: ←→↑↓↔↕⇐⇒</p>
  </section>

  <!-- CDATA-like section (for XML compat) -->
  <script>
  //<![CDATA[
  const x = "🚀 < > & 中文";
  //]]>
  </script>

  <br>
  <img src="test.png" alt="Self-closing 🖼️">
  <hr>

  <div>
    <div>
      <div>
        <div>
          <p>Deeply nested with émojis 🎭</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const outPath = join(FIXTURES_DIR, 'multibyte.html');
  console.log(`✓ Creating multibyte fixture: ${outPath}`);
  return writeFile(outPath, html, 'utf-8');
}

async function main(): Promise<void> {
  await fetchFiling();
  await createMultibyteFixture();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
