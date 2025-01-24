"use client"

import { motion } from "framer-motion"
import Image from "next/image"
import { AlertCircle, Mail, FileQuestion, CreditCard } from "lucide-react"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-coral">Subspond</h1>
          <button className="flex items-center gap-2 bg-gray-50 hover:bg-gray-100 transition-colors px-4 py-2 rounded-lg text-gray-700">
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-xKjegnLsv838zJo5xBZtrMkCt8RfQr.png"
              alt="Google"
              className="w-5 h-5"
            />
            <span className="text-sm font-medium">Sign in with Google</span>
          </button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-2 text-gray-800">Welcome to SubHub</h2>
          <p className="text-gray-600">Your subscription management command center.</p>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="group"
          >
            <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-coral/50 transition-all duration-300 shadow-sm hover:shadow-xl">
              <div className="relative h-64 overflow-hidden">
                <Image
                  src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/supspond-8ieiuYQ01ASFR5tL4jhSurutrrkOT9.png"
                  alt="3D illustration of customer service representative managing disputes"
                  width={600}
                  height={400}
                  className="object-cover transform group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <h3 className="absolute bottom-4 left-6 text-2xl font-semibold text-white">Dispute Resolution</h3>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div className="w-2 h-2 rounded-full bg-coral animate-ping absolute" />
                      <div className="w-2 h-2 rounded-full bg-coral relative" />
                    </div>
                    <span className="text-sm text-gray-500">2 active disputes</span>
                  </div>
                  <div className="w-px h-4 bg-gray-200" />
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div className="w-2 h-2 rounded-full bg-teal animate-ping absolute" />
                      <div className="w-2 h-2 rounded-full bg-teal relative" />
                    </div>
                    <span className="text-sm text-gray-500">5 response drafts ready</span>
                  </div>
                </div>
                <button className="group/button relative w-full bg-gradient-to-r from-coral to-coral-light overflow-hidden text-white px-6 py-3 rounded-xl text-sm font-medium hover:shadow-lg transition-all duration-300">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%, rgba(255,255,255,0.15), transparent_50%)]" />
                  <div className="relative flex items-center justify-center gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                      <div className="w-2 h-2 rounded-full bg-white animate-pulse delay-100" />
                      <div className="w-2 h-2 rounded-full bg-white animate-pulse delay-200" />
                    </div>
                    <span className="font-semibold">Review Agent Replies 🚀</span>
                    <svg
                      className="w-4 h-4 transition-transform duration-300 group-hover/button:translate-x-1"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 12h14m-4 4l4-4m-4-4l4 4" />
                    </svg>
                  </div>
                  <div className="absolute inset-0 border border-white/20 rounded-xl" />
                </button>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="group"
          >
            <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-teal/50 transition-all duration-300 shadow-sm hover:shadow-xl">
              <div className="relative h-48 overflow-hidden">
                <Image
                  src="https://images.unsplash.com/photo-1614064641938-3bbee52942c7?q=80&w=2670&auto=format&fit=crop"
                  alt="Abstract visualization of knowledge base and FAQ system"
                  width={600}
                  height={400}
                  className="object-cover transform group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <h3 className="absolute bottom-4 left-6 text-2xl font-semibold text-white">FAQ & Support</h3>
              </div>
              <div className="p-6">
                <p className="text-gray-600 mb-6">
                  Access our comprehensive knowledge base for instant answers to billing questions.
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-teal" />
                    <span className="text-sm text-gray-500">200+ articles</span>
                  </div>
                  <button className="bg-gradient-to-r from-teal to-teal-light text-white px-6 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                    Browse
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="group"
          >
            <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-navy/50 transition-all duration-300 shadow-sm hover:shadow-xl">
              <div className="relative h-48 overflow-hidden">
                <Image
                  src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2670&auto=format&fit=crop"
                  alt="Abstract visualization of subscription management system"
                  width={600}
                  height={400}
                  className="object-cover transform group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <h3 className="absolute bottom-4 left-6 text-2xl font-semibold text-white">Subscription Management</h3>
              </div>
              <div className="p-6">
                <p className="text-gray-600 mb-6">
                  Efficiently manage all your customer subscriptions and billing plans.
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-navy" />
                    <span className="text-sm text-gray-500">15 active subscriptions</span>
                  </div>
                  <button className="bg-gradient-to-r from-navy to-navy-light text-white px-6 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                    Review
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  )
}

