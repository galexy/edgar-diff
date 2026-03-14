import type { AvailableFiling } from '../services/types';

interface FilingSelectorProps {
  filings: AvailableFiling[];
  selectedAccession: string | null;
  onSelect: (filing: AvailableFiling) => void;
  disabled?: boolean;
  'aria-label': string;
}

export function FilingSelector({
  filings,
  selectedAccession,
  onSelect,
  disabled,
  'aria-label': ariaLabel,
}: FilingSelectorProps) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const filing = filings.find((f) => f.accessionNumber === e.target.value);
    if (filing) onSelect(filing);
  }

  return (
    <select
      value={selectedAccession ?? ''}
      onChange={handleChange}
      disabled={disabled || filings.length === 0}
      aria-label={ariaLabel}
      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm
                 disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
                 bg-white text-gray-900"
    >
      <option value="">Select a filing...</option>
      {filings.map((f) => (
        <option key={f.accessionNumber} value={f.accessionNumber}>
          {f.formType} | {f.filingDate}
        </option>
      ))}
    </select>
  );
}
