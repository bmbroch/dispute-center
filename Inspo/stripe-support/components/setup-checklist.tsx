"use client"

import * as React from "react"
import { CheckCircle2, Circle } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

interface ChecklistItem {
  id: string
  title: string
  completed: boolean
}

export function SetupChecklist() {
  const [items, setItems] = React.useState<ChecklistItem[]>([
    {
      id: "1",
      title: "Connect your payment gateway",
      completed: false,
    },
    {
      id: "2",
      title: "Set up webhook endpoints",
      completed: false,
    },
    {
      id: "3",
      title: "Configure notification preferences",
      completed: true,
    },
    {
      id: "4",
      title: "Review security settings",
      completed: false,
    },
  ])

  const completedCount = items.filter(item => item.completed).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          className="border-purple-300/20 bg-white/10 text-white hover:bg-white/20"
        >
          <CheckCircle2 className="mr-2 h-4 w-4 text-purple-300" />
          Setup Progress ({completedCount}/{items.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-purple-950/90 backdrop-blur-xl">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none text-white">Setup Checklist</h4>
            <p className="text-sm text-purple-200">
              Complete these tasks to fully optimize your setup
            </p>
          </div>
          <div className="grid gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-purple-300/20 p-3"
              >
                {item.completed ? (
                  <CheckCircle2 className="h-5 w-5 text-purple-400" />
                ) : (
                  <Circle className="h-5 w-5 text-purple-300/50" />
                )}
                <span className="text-sm text-purple-100">{item.title}</span>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

