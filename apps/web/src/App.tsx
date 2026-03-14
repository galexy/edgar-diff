import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { SectionNav } from './components/SectionNav';
import { FilingPanel } from './components/FilingPanel';
import { useActiveSection } from './hooks/useActiveSection';
import { useFilingList } from './hooks/useFilingList';
import { sampleDocument } from './fixtures/sample-filing';
import { buildSampleDiffs } from './fixtures/sample-diff';
import type { SectionDiff } from '@edgar-diff/lib';
import type { Company, AvailableFiling } from './services/types';

export function countChanges(section: SectionDiff): number {
  const paragraphChanges = section.paragraphDiffs.filter(
    (p) => p.changeType !== 'unchanged',
  ).length;
  const tableChanges = section.tableDiffs.filter(
    (t) => t.changeType !== 'unchanged',
  ).length;
  return paragraphChanges + tableChanges;
}

export function App() {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const { filings, status: filingListStatus } = useFilingList(selectedCompany);
  const [selectedFilingA, setSelectedFilingA] = useState<AvailableFiling | null>(null);
  const [selectedFilingB, setSelectedFilingB] = useState<AvailableFiling | null>(null);

  useEffect(() => {
    setSelectedFilingA(null);
    setSelectedFilingB(null);
  }, [selectedCompany]);

  const sampleDiffs = useMemo(() => buildSampleDiffs(sampleDocument), []);

  const sections = useMemo(
    () =>
      sampleDiffs.map((sd) => ({
        id: sd.id,
        heading: sd.heading,
        changeType: sd.changeType,
        changeCount: countChanges(sd),
      })),
    [sampleDiffs],
  );

  const diffSummary = useMemo(() => {
    const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    for (const sd of sampleDiffs) {
      if (sd.changeType === 'added') summary.added++;
      else if (sd.changeType === 'removed') summary.removed++;
      else if (sd.changeType === 'modified' || sd.changeType === 'reordered' || sd.changeType === 'moved')
        summary.modified++;
      else summary.unchanged++;
    }
    return summary;
  }, [sampleDiffs]);

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
          diffSummary={diffSummary}
        />
        <FilingPanel
          ref={oldPanelRef}
          label="Filing A"
          document={sampleDocument}
          sectionDiffs={sampleDiffs}
          side="old"
          filings={filings}
          selectedFiling={selectedFilingA?.accessionNumber ?? null}
          onFilingSelect={setSelectedFilingA}
          filingListStatus={filingListStatus}
        />
        <div className="w-px bg-gray-200" aria-hidden="true" />
        <FilingPanel
          ref={newPanelRef}
          label="Filing B"
          document={sampleDocument}
          sectionDiffs={sampleDiffs}
          side="new"
          filings={filings}
          selectedFiling={selectedFilingB?.accessionNumber ?? null}
          onFilingSelect={setSelectedFilingB}
          filingListStatus={filingListStatus}
        />
      </main>
    </div>
  );
}
