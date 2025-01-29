'use client';

import './globals.css'
import { Providers } from './providers'
import { Roboto } from 'next/font/google'
import { Toaster } from 'react-hot-toast'

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-roboto',
})

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
        <Toaster position="top-right" />
      </body>
    </html>
  )
}
