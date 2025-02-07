'use client';

import { useState } from 'react';

interface DebugLog {
  timestamp: string;
  stage: string;
  data: any;
}

interface DebugPanelProps {
  logs: DebugLog[];
  closePanel: () => void;
  downloadLogs: () => void;
}

export default function DebugPanel({ logs, closePanel, downloadLogs }: DebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!logs || logs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-white rounded-lg shadow-lg p-4 max-w-2xl w-full">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          {isOpen ? '🔽' : '▶️'} Debug Info ({logs.length} logs)
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadLogs}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Download Logs
          </button>
          <button
            onClick={closePanel}
            className="text-sm text-gray-600 hover:text-gray-700"
          >
            Close
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="bg-gray-800 rounded text-xs font-mono text-gray-200 overflow-x-auto max-h-96 overflow-y-auto p-4">
          {logs.map((log, i) => (
            <div key={i} className="mb-4 border-b border-gray-700 pb-4 last:border-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-gray-400">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                <span className="text-yellow-400">{log.stage}</span>
              </div>
              <pre className="ml-4 text-green-300 whitespace-pre-wrap break-words">
                {JSON.stringify(log.data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 