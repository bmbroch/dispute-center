'use client';

import { useState } from 'react';
import { Rocket } from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';

export function AutopilotToggle() {
  const [enabled, setEnabled] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Rocket className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-700">Autopilot</span>
      </div>
      <Switch.Root
        checked={enabled}
        onCheckedChange={setEnabled}
        className={`relative inline-flex h-[24px] w-[44px] flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 ${
          enabled ? 'bg-purple-600' : 'bg-gray-200'
        }`}
      >
        <Switch.Thumb 
          className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </Switch.Root>
    </div>
  );
} 