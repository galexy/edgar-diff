import { useState, useRef, useEffect, useId } from 'react';
import { useCompanySearch } from '../hooks/use-company-search';
import type { Company, CompanyMatch } from '../services/types';

interface SearchBarProps {
  onCompanySelect?: (company: Company | null) => void;
}

export function SearchBar({ onCompanySelect }: SearchBarProps) {
  const {
    query,
    setQuery,
    status,
    matches,
    selectedCompany,
    error,
    selectMatch,
    clear,
  } = useCompanySearch();

  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Notify parent when selectedCompany changes
  useEffect(() => {
    if (status === 'resolved' && selectedCompany) {
      onCompanySelect?.(selectedCompany);
    }
  }, [status, selectedCompany, onCompanySelect]);

  const showDropdown = dropdownOpen && matches.length > 0;

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setHighlightIndex(-1);
    setDropdownOpen(true);
  }

  function handleSelectMatch(match: CompanyMatch) {
    selectMatch(match);
    setHighlightIndex(-1);
    setDropdownOpen(false);
  }

  function handleClear() {
    clear();
    onCompanySelect?.(null);
    setHighlightIndex(-1);
    setDropdownOpen(true);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, matches.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < matches.length) {
          handleSelectMatch(matches[highlightIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setDropdownOpen(false);
        break;
    }
  }

  const activeDescendant =
    showDropdown && highlightIndex >= 0 ? `${listboxId}-option-${highlightIndex}` : undefined;

  return (
    <div role="search" className="px-6 py-3 bg-white border-b border-gray-200 shrink-0 relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Search by company name, ticker, or CIK..."
          aria-label="Search by company name, ticker, or CIK"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />

        {query && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          >
            &#x2715;
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-6 right-6 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto z-10"
        >
          {matches.map((match, index) => (
            <li
              key={`${match.cik}-${match.ticker}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === highlightIndex}
              onClick={() => handleSelectMatch(match)}
              onMouseEnter={() => setHighlightIndex(index)}
              className={`px-4 py-2 cursor-pointer ${
                index === highlightIndex ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50'
              }`}
            >
              <span className="font-semibold">{match.ticker}</span>
              <span className="mx-2 text-gray-400">&mdash;</span>
              <span>{match.name}</span>
              {match.exchange && (
                <span className="ml-2 text-gray-500 text-sm">({match.exchange})</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Loading */}
      {status === 'searching' && (
        <div role="status" className="mt-2 text-sm text-gray-500">
          Searching...
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Resolved company */}
      <div aria-live="polite">
        {status === 'resolved' && selectedCompany && (
          <div className="mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm">
            <span className="font-semibold">{selectedCompany.name}</span>
            {selectedCompany.ticker && (
              <span className="ml-1 text-gray-600">({selectedCompany.ticker})</span>
            )}
            <span className="ml-2 text-gray-500">CIK: {selectedCompany.cik}</span>
          </div>
        )}
      </div>
    </div>
  );
}
