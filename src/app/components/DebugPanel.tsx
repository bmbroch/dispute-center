'use client';

import { useState } from 'react';

interface DebugLog {
  timestamp: string;
  stage: string;
  data: any;
}

interface DebugPanelProps {
  logs?: DebugLog[];
}

export default function DebugPanel({ logs }: DebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!logs || logs.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
      >
        {isOpen ? '🔽' : '▶️'} Debug Info ({logs.length} logs)
      </button>
      {isOpen && (
        <div className="mt-2 p-2 bg-gray-800 rounded text-xs font-mono text-gray-200 overflow-x-auto max-h-96 overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="mb-2 border-b border-gray-700 pb-2 last:border-0">
              <div className="flex items-center gap-2 mb-1">
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