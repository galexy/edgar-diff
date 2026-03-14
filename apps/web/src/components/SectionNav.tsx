import type { ChangeType } from '@edgar-diff/lib';

export interface SectionNavItem {
  id: string;
  heading: string;
  changeType: ChangeType;
  /** Number of non-unchanged paragraph + table diffs within this section. */
  changeCount: number;
}

export interface DiffSummaryData {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

interface SectionNavProps {
  sections: SectionNavItem[];
  activeSectionId?: string;
  onSectionClick?: (sectionId: string) => void;
  /** Aggregate diff totals displayed above the section list. */
  diffSummary?: DiffSummaryData;
}

export function SectionNav({ sections, activeSectionId, onSectionClick, diffSummary }: SectionNavProps) {
  return (
    <nav
      className="w-60 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto"
      aria-labelledby="section-nav-heading"
    >
      <div className="p-4">
        <h2
          id="section-nav-heading"
          className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3"
        >
          Sections
        </h2>
        {diffSummary && (diffSummary.added + diffSummary.removed + diffSummary.modified + diffSummary.unchanged > 0) && (
          <div className="mb-3 flex flex-wrap gap-2 text-xs" role="status" aria-label="Diff summary">
            {diffSummary.modified > 0 && (
              <span className="text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                {diffSummary.modified} modified
              </span>
            )}
            {diffSummary.added > 0 && (
              <span className="text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                {diffSummary.added} added
              </span>
            )}
            {diffSummary.removed > 0 && (
              <span className="text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                {diffSummary.removed} removed
              </span>
            )}
            {diffSummary.unchanged > 0 && (
              <span className="text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                {diffSummary.unchanged} unchanged
              </span>
            )}
          </div>
        )}
        {sections.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No sections</p>
        ) : (
          <ul className="space-y-1">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-current={section.id === activeSectionId ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                    section.id === activeSectionId
                      ? 'bg-blue-100 text-blue-900 font-medium'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                  onClick={() => onSectionClick?.(section.id)}
                >
                  <span className="flex items-baseline gap-1">
                    <span className="truncate">{section.heading}</span>
                    {section.changeType === 'added' && (
                      <span
                        className="shrink-0 text-[10px] leading-none text-green-700 bg-green-100 px-1 rounded-full -translate-y-0.5"
                        aria-label="Section added"
                      >
                        Added
                      </span>
                    )}
                    {section.changeType === 'removed' && (
                      <span
                        className="shrink-0 text-[10px] leading-none text-red-700 bg-red-100 px-1 rounded-full -translate-y-0.5"
                        aria-label="Section removed"
                      >
                        Removed
                      </span>
                    )}
                    {['modified', 'reordered', 'moved'].includes(section.changeType) && section.changeCount > 0 && (
                      <span
                        className="shrink-0 text-[10px] leading-none min-w-[1.25rem] text-center text-amber-700 bg-amber-100 px-1 rounded-full -translate-y-0.5"
                        aria-label={`${section.changeCount} ${section.changeCount === 1 ? 'change' : 'changes'}`}
                      >
                        {section.changeCount}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
