import { useEffect } from 'react';
import { type ViewMode } from '../types';

interface UseKeyboardShortcutsProps {
  onNavigate: (tab: ViewMode) => void;
  onRefresh: () => void;
  selectedTraceId: string | null;
  traces: string[];
  onTraceSelect: (traceId: string) => void;
}

export function useKeyboardShortcuts({
  onNavigate,
  onRefresh,
  selectedTraceId,
  traces,
  onTraceSelect,
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // Command/Ctrl + K for command palette (future feature)
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        // Future: Open command palette
        return;
      }

      // Navigation shortcuts (no modifiers)
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        switch (event.key) {
          case '1':
            event.preventDefault();
            onNavigate('overview');
            break;
          case '2':
            event.preventDefault();
            onNavigate('events');
            break;
          case '3':
            event.preventDefault();
            onNavigate('audit-trail');
            break;
          case '4':
            event.preventDefault();
            onNavigate('anomalies');
            break;
          case '5':
            event.preventDefault();
            onNavigate('critical-path');
            break;
          case '6':
            event.preventDefault();
            onNavigate('dependencies');
            break;
          case 'r':
            event.preventDefault();
            onRefresh();
            break;
          case '?':
            event.preventDefault();
            showKeyboardShortcutsHelp();
            break;
        }
      }

      // Trace navigation with arrow keys
      if (selectedTraceId && traces.length > 0) {
        const currentIndex = traces.indexOf(selectedTraceId);

        if (event.key === 'ArrowUp' && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : traces.length - 1;
          onTraceSelect(traces[prevIndex]);
        } else if (event.key === 'ArrowDown' && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          const nextIndex = currentIndex < traces.length - 1 ? currentIndex + 1 : 0;
          onTraceSelect(traces[nextIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNavigate, onRefresh, selectedTraceId, traces, onTraceSelect]);
}

function showKeyboardShortcutsHelp() {
  const shortcuts = [
    { key: '1-6', description: 'Navigate to tabs (Overview, Events, Debugger, Anomalies, Critical Path, Dependencies)' },
    { key: 'r', description: 'Refresh trace list' },
    { key: '↑/↓', description: 'Navigate between traces' },
    { key: '?', description: 'Show keyboard shortcuts' },
  ];

  const message = [
    '⌨️ Keyboard Shortcuts\n',
    ...shortcuts.map(s => `${s.key.padEnd(10)} - ${s.description}`),
  ].join('\n');

  // Simple alert for now, could be replaced with a modal
  alert(message);
}
