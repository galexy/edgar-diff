export function SearchBar() {
  return (
    <div role="search" className="px-6 py-3 bg-white border-b border-gray-200 shrink-0">
      <input
        type="text"
        placeholder="Search by company name, ticker, or CIK..."
        aria-label="Search by company name, ticker, or CIK"
        disabled
        className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
      />
    </div>
  );
}
