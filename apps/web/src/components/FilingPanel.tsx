import { forwardRef } from 'react';
import type { StructuredDocument, SectionDiff } from '@edgar-diff/lib';
import type { Side } from '../lib/highlight-injector';
import type { AvailableFiling, FilingListStatus, PipelineStatus } from '../services/types';
import { FilingContent } from './FilingContent';
import { FilingSelector } from './FilingSelector';

interface FilingPanelProps {
  label: string;
  document?: StructuredDocument;
  sectionDiffs?: SectionDiff[];
  side?: Side;
  filings?: AvailableFiling[];
  selectedFiling?: string | null;
  onFilingSelect?: (filing: AvailableFiling) => void;
  filingListStatus?: FilingListStatus;
  pipelineStatus?: PipelineStatus;
  pipelineError?: string | null;
}

export const FilingPanel = forwardRef<HTMLDivElement, FilingPanelProps>(
  function FilingPanel({ label, document, sectionDiffs, side, filings, selectedFiling, onFilingSelect, filingListStatus, pipelineStatus, pipelineError }, ref) {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-white">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">{label}</h2>
          {filings && onFilingSelect ? (
            <FilingSelector
              filings={filings}
              selectedAccession={selectedFiling ?? null}
              onSelect={onFilingSelect}
              disabled={filingListStatus === 'loading'}
              aria-label={`Select ${label}`}
            />
          ) : (
            <select
              disabled
              className="w-full px-3 py-1.5 border border-gray-300 rounded-md bg-gray-50 text-gray-500 text-sm cursor-not-allowed"
            >
              <option>Select a filing...</option>
            </select>
          )}
        </div>
        <div ref={ref} className="flex-1 overflow-y-auto p-4">
          {pipelineStatus === 'error' && pipelineError ? (
            <div className="flex items-center justify-center h-full" role="alert">
              <p className="text-sm text-red-600 font-medium">{pipelineError}</p>
            </div>
          ) : pipelineStatus === 'fetching' || pipelineStatus === 'parsing' || pipelineStatus === 'diffing' ? (
            <div className="flex items-center justify-center h-full" role="status" aria-live="polite">
              <div className="text-center">
                <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
                <p className="text-sm text-gray-500 mt-3">
                  {pipelineStatus === 'fetching' && 'Fetching filings...'}
                  {pipelineStatus === 'parsing' && 'Parsing filings...'}
                  {pipelineStatus === 'diffing' && 'Computing diff...'}
                </p>
              </div>
            </div>
          ) : document ? (
            <FilingContent document={document} sectionDiffs={sectionDiffs} side={side} />
          ) : (
            <p className="text-sm text-gray-400 italic">
              Filing content will appear here
            </p>
          )}
        </div>
      </div>
    );
  }
);
