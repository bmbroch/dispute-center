"use client"

import * as React from "react"
import { CheckCircle2, Circle } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'

export function SetupChecklist() {
  const [items] = React.useState([
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
    <Popover.Root>
      <Popover.Trigger asChild>
        <button 
          className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <CheckCircle2 className="h-4 w-4 text-gray-500" />
          Setup Progress ({completedCount}/{items.length})
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-xl" sideOffset={5}>
          <div className="grid gap-4">
            <div className="space-y-2">
              <h4 className="font-medium leading-none text-gray-900">Setup Checklist</h4>
              <p className="text-sm text-gray-600">
                Complete these tasks to fully optimize your setup
              </p>
            </div>
            <div className="grid gap-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 p-3"
                >
                  {item.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-400" />
                  )}
                  <span className="text-sm text-gray-700">{item.title}</span>
                </div>
              ))}
            </div>
          </div>
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
} 