interface SectionNavItem {
  id: string;
  label: string;
}

const placeholderSections: SectionNavItem[] = [
  { id: 'item-1', label: 'Item 1. Business' },
  { id: 'item-1a', label: 'Item 1A. Risk Factors' },
  { id: 'item-2', label: 'Item 2. Properties' },
  { id: 'item-7', label: 'Item 7. MD&A' },
  { id: 'item-7a', label: 'Item 7A. Quant. Disclosures' },
  { id: 'item-8', label: 'Item 8. Financial Statements' },
];

export function SectionNav() {
  return (
    <nav className="w-60 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
      <div className="p-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Sections
        </h2>
        <ul className="space-y-1">
          {placeholderSections.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
              >
                {section.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
