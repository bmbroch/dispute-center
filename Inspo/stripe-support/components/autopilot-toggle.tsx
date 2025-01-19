"use client"

import { useState } from "react"
import { Rocket } from 'lucide-react'
import { Switch } from "@/components/ui/switch"

export function AutopilotToggle() {
  const [enabled, setEnabled] = useState(false)

  return (
    <div className="flex items-center gap-3 rounded-full bg-white/10 px-6 py-3 backdrop-blur-sm">
      <Rocket className={`h-5 w-5 transition-colors ${enabled ? 'text-purple-300' : 'text-white/70'}`} />
      <span className="text-sm font-medium text-white">Autopilot</span>
      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
        className="data-[state=checked]:bg-purple-400"
      />
    </div>
  )
}

