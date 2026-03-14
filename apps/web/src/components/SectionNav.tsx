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
                  <span className="block truncate">{section.heading}</span>
                  {section.changeType === 'added' && (
                    <span
                      className="inline-block mt-0.5 text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded"
                      aria-label="Section added"
                    >
                      Added
                    </span>
                  )}
                  {section.changeType === 'removed' && (
                    <span
                      className="inline-block mt-0.5 text-xs text-red-700 bg-red-100 px-1.5 py-0.5 rounded"
                      aria-label="Section removed"
                    >
                      Removed
                    </span>
                  )}
                  {['modified', 'reordered', 'moved'].includes(section.changeType) && section.changeCount > 0 && (
                    <span
                      className="inline-block mt-0.5 text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
                      aria-label={`${section.changeCount} ${section.changeCount === 1 ? 'change' : 'changes'}`}
                    >
                      {section.changeCount} {section.changeCount === 1 ? 'change' : 'changes'}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
