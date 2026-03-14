import { useCallback, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { SectionNav } from './components/SectionNav';
import { FilingPanel } from './components/FilingPanel';
import { useActiveSection } from './hooks/useActiveSection';
import { sampleDocument } from './fixtures/sample-filing';
import { buildSampleDiffs } from './fixtures/sample-diff';
import type { Company } from './services/types';

export function App() {
  // selectedCompany will be consumed by US-2.9 Filing Selectors
  const [, setSelectedCompany] = useState<Company | null>(null);
  const sampleDiffs = useMemo(() => buildSampleDiffs(sampleDocument), []);

  const sections = useMemo(
    () => sampleDiffs.map((sd) => ({ id: sd.id, heading: sd.heading, changeType: sd.changeType })),
    [sampleDiffs],
  );

  const oldPanelRef = useRef<HTMLDivElement>(null);
  const newPanelRef = useRef<HTMLDivElement>(null);

  const activeSectionId = useActiveSection(oldPanelRef);

  const handleSectionClick = useCallback((sectionId: string) => {
    for (const ref of [oldPanelRef, newPanelRef]) {
      const container = ref.current;
      if (!container) continue;
      const target = container.querySelector(`#${CSS.escape(sectionId)}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <SearchBar onCompanySelect={setSelectedCompany} />
      <main className="flex-1 flex overflow-hidden">
        <SectionNav
          sections={sections}
          activeSectionId={activeSectionId}
          onSectionClick={handleSectionClick}
        />
        <FilingPanel
          ref={oldPanelRef}
          label="Filing A"
          document={sampleDocument}
          sectionDiffs={sampleDiffs}
          side="old"
        />
        <div className="w-px bg-gray-200" aria-hidden="true" />
        <FilingPanel
          ref={newPanelRef}
          label="Filing B"
          document={sampleDocument}
          sectionDiffs={sampleDiffs}
          side="new"
        />
      </main>
    </div>
  );
}
