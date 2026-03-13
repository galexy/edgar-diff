import type { FormType } from '@edgar-diff/lib';

const formTypes: FormType[] = [
  '10-K', '10-K/A', '10-Q', '10-Q/A',
  '8-K', '8-K/A', '20-F', '20-F/A',
  'S-1', 'S-1/A', 'DEF 14A',
  'SC 13D', 'SC 13D/A',
];

export function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-4">
        Edgar-Differ
      </h1>
      <p className="text-gray-600 mb-6">
        SEC Filing Comparison Tool
      </p>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-3">
          Supported Form Types
        </h2>
        <div className="flex flex-wrap gap-2">
          {formTypes.map((ft) => (
            <span
              key={ft}
              className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
            >
              {ft}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
