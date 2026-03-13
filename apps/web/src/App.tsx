import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { SectionNav } from './components/SectionNav';
import { FilingPanel } from './components/FilingPanel';

export function App() {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <SearchBar />
      <main className="flex-1 flex overflow-hidden">
        <SectionNav />
        <FilingPanel label="Filing A" />
        <div className="w-px bg-gray-200" aria-hidden="true" />
        <FilingPanel label="Filing B" />
      </main>
    </div>
  );
}
