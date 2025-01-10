import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { Roboto } from 'next/font/google'

const roboto = Roboto({
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto',
})

export const metadata: Metadata = {
  title: 'Stripe Dispute Center',
  description: 'Your platform for managing and resolving disputes efficiently.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={roboto.variable}>
      <body className="font-sans">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
