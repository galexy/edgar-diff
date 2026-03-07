import { describe, it, expect } from 'vitest';
import { createEdgarClient } from '../../src/client/index.js';

describe('live EDGAR: fetch client', () => {
  it('fetches a real 10-K filing (Apple FY2023)', async () => {
    const client = createEdgarClient({
      userAgent: 'edgar-diff-lib-test test@example.com',
    });

    try {
      const filing = await client.fetchFiling('0000320193-23-000106');

      expect(filing.accessionNumber).toBe('0000320193-23-000106');
      expect(filing.cik).toBe('0000320193');
      expect(filing.formType).toBe('10-K');
      expect(filing.filingDate.toString()).toBe('2023-11-03');
      expect(filing.primaryDocumentFilename).toMatch(/\.htm$/);
      expect(filing.html.length).toBeGreaterThan(10_000);
    } finally {
      client.dispose();
    }
  }, 30_000);

  it('fetches a filing-agent-submitted filing', async () => {
    const client = createEdgarClient({
      userAgent: 'edgar-diff-lib-test test@example.com',
    });

    try {
      // Accession where submitter CIK != company CIK
      const filing = await client.fetchFiling('0000950170-23-035122');

      // CIK should be the company CIK, not the agent CIK
      expect(filing.cik).not.toBe('0000950170');
      expect(filing.accessionNumber).toBe('0000950170-23-035122');
      expect(filing.html.length).toBeGreaterThan(1000);
    } finally {
      client.dispose();
    }
  }, 30_000);
});
