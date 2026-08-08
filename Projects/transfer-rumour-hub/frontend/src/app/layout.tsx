import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Transfer Hub — Football Rumour Tracker',
  description: 'Real-time transfer rumour probabilities and completion tracking.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-slate-950 font-sans text-white antialiased">
        <nav className="sticky top-0 z-50 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold">
              <span className="inline-block h-3 w-3 rounded-full bg-pitch-500" />
              Transfer Hub
            </Link>
            <div className="flex gap-5 text-sm text-slate-400">
              <Link href="/" className="hover:text-white transition-colors">Rumours</Link>
              <Link href="/clubs" className="hover:text-white transition-colors">Clubs</Link>
              <Link href="/network" className="hover:text-white transition-colors">Network</Link>
              <Link href="/admin" className="hover:text-white transition-colors">Admin</Link>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
