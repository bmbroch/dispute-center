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
  title: 'Subspond',
  description: 'Your all-in-one subscription management and dispute resolution platform.',
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
          <div className="min-h-screen">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  )
}
