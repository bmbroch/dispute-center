import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#EE6352] to-[#F79D84] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-white/90 backdrop-blur-md">
        <CardContent className="p-6">
          <div className="flex flex-col items-center space-y-6">
            <Image src="/logo-placeholder.svg" alt="Subspond Logo" width={120} height={120} className="mb-4" />
            <h1 className="text-3xl font-bold text-gray-800 text-center">Welcome to Subspond</h1>
            <p className="text-gray-600 text-center mb-6">
              Streamline your customer support with AI-powered automation
            </p>
            <Button
              className="w-full bg-[#EE6352] hover:bg-[#D55241] text-white"
              onClick={() => {
                /* Implement Google Sign-In */
              }}
            >
              Sign in with Google
            </Button>
          </div>

          <div className="mt-12 space-y-6">
            <ValueProp
              icon="📧"
              title="80% Automated Inquiries"
              description="Our AI handles the majority of customer emails, freeing up your team."
            />
            <ValueProp
              icon="🔄"
              title="Dispute Resolution Autopilot"
              description="Resolve customer disputes efficiently without manual intervention."
            />
            <ValueProp
              icon="❓"
              title="Smart Subscription Support"
              description="AI-powered responses to subscription queries, tailored to your docs."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ValueProp({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex items-start space-x-4">
      <div className="text-2xl">{icon}</div>
      <div>
        <h2 className="font-semibold text-gray-800">{title}</h2>
        <p className="text-sm text-gray-600">{description}</p>
      </div>
    </div>
  )
}

