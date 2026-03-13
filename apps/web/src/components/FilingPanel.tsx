import type { StructuredDocument } from '@edgar-diff/lib';
import { FilingContent } from './FilingContent';

interface FilingPanelProps {
  label: string;
  document?: StructuredDocument;
}

export function FilingPanel({ label, document }: FilingPanelProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">{label}</h2>
        <select
          disabled
          className="w-full px-3 py-1.5 border border-gray-300 rounded-md bg-gray-50 text-gray-500 text-sm cursor-not-allowed"
        >
          <option>Select a filing...</option>
        </select>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {document ? (
          <FilingContent document={document} />
        ) : (
          <p className="text-sm text-gray-400 italic">
            Filing content will appear here
          </p>
        )}
      </div>
    </div>
  );
}
