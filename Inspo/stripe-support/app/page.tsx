import { AutopilotToggle } from "@/components/autopilot-toggle"
import { SetupChecklist } from "@/components/setup-checklist"
import { SubscriptionDashboard } from "@/components/subscription-dashboard"

export default function Page() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-950 via-purple-900 to-purple-800">
      <div className="relative mx-auto max-w-7xl px-8 pt-8">
        <div className="mb-16 flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <h1 className="font-cal text-5xl font-bold tracking-tight text-white">
              Stripe Support Center
            </h1>
            <p className="text-xl text-purple-200">
              Your tasks are ready to run. Look what we found:
            </p>
          </div>
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            <AutopilotToggle />
            <SetupChecklist />
          </div>
        </div>
        <SubscriptionDashboard />
      </div>
    </main>
  )
}

