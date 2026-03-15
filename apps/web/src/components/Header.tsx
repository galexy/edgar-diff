interface HeaderProps {
  syncEnabled?: boolean;
  onSyncToggle?: () => void;
}

export function Header({ syncEnabled, onSyncToggle }: HeaderProps) {
  return (
    <header className="flex items-center h-14 px-6 bg-white border-b border-gray-200 shrink-0">
      <h1 className="text-xl font-bold text-gray-900">Edgar-Differ</h1>
      {onSyncToggle && (
        <button
          type="button"
          onClick={onSyncToggle}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
            syncEnabled
              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
          aria-pressed={syncEnabled}
          title={syncEnabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling'}
        >
          <span aria-hidden="true">{syncEnabled ? '\u{1F517}' : '\u{26D3}'}</span>
          <span>Sync Scroll</span>
        </button>
      )}
    </header>
  );
}
