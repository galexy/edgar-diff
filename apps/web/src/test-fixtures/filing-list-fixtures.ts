/**
 * Test fixtures for US-2.9 Filing Selectors.
 * Edge-case submissions data for filing list service, hook, and component tests.
 */

/** Company with no supported filings (only 8-K) */
export const MOCK_NO_SUPPORTED_FILINGS = {
  cik: '999999',
  name: 'Only 8K Corp',
  tickers: ['ONLY8K'],
  exchanges: ['NYSE'],
  filings: {
    recent: {
      accessionNumber: ['0000999999-23-000001'],
      filingDate: ['2023-06-15'],
      form: ['8-K'],
    },
  },
};

/** Company with mixed supported and unsupported types */
export const MOCK_MIXED_FILINGS_SUBMISSIONS = {
  cik: '888888',
  name: 'Mixed Filings Inc.',
  tickers: ['MXFD'],
  exchanges: ['Nasdaq'],
  filings: {
    recent: {
      accessionNumber: [
        '0000888888-23-000001',
        '0000888888-23-000002',
        '0000888888-23-000003',
        '0000888888-23-000004',
        '0000888888-23-000005',
      ],
      filingDate: [
        '2023-12-01',
        '2023-11-15',
        '2023-09-01',
        '2023-06-15',
        '2023-03-01',
      ],
      form: [
        '10-K',
        '8-K',
        '10-Q',
        'S-1',
        '10-K/A',
      ],
    },
  },
};

/** Company with all 4 supported form types */
export const MOCK_ALL_SUPPORTED_SUBMISSIONS = {
  cik: '777777',
  name: 'All Supported Corp.',
  tickers: ['ALLQ'],
  exchanges: ['NYSE'],
  filings: {
    recent: {
      accessionNumber: [
        '0000777777-23-000001',
        '0000777777-23-000002',
        '0000777777-23-000003',
        '0000777777-23-000004',
      ],
      filingDate: [
        '2023-12-15',
        '2023-09-15',
        '2023-06-15',
        '2023-03-15',
      ],
      form: [
        '10-K',
        '10-K/A',
        '10-Q',
        '10-Q/A',
      ],
    },
  },
};

/** Empty filings (company with no recent filings) */
export const MOCK_EMPTY_FILINGS_SUBMISSIONS = {
  cik: '666666',
  name: 'Empty Filings LLC',
  tickers: ['EMPT'],
  exchanges: ['Nasdaq'],
  filings: {
    recent: {
      accessionNumber: [],
      filingDate: [],
      form: [],
    },
  },
};

/** Large set of filings (50+) for scroll/performance testing */
export function createLargeFilingsSubmissions(count = 50) {
  const accessionNumber: string[] = [];
  const filingDate: string[] = [];
  const form: string[] = [];
  const formTypes = ['10-K', '10-Q', '10-Q', '10-Q']; // 1 annual + 3 quarterly per year

  for (let i = 0; i < count; i++) {
    const year = 2023 - Math.floor(i / 4);
    const quarter = i % 4;
    const month = String(11 - quarter * 3).padStart(2, '0');
    accessionNumber.push(`0000555555-${year}-${String(i).padStart(6, '0')}`);
    filingDate.push(`${year}-${month}-03`);
    form.push(formTypes[quarter]);
  }

  return {
    cik: '555555',
    name: 'Large Filings Corp.',
    tickers: ['LRGF'],
    exchanges: ['NYSE'],
    filings: {
      recent: { accessionNumber, filingDate, form },
    },
  };
}
