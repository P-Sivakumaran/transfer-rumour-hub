'use client'

import Link from 'next/link'
import { useAuth } from './AuthProvider'

export default function AuthNav() {
  const { user, loading, logout } = useAuth()

  if (loading) return null

  if (!user) {
    return (
      <div className="ml-auto flex items-center gap-3 text-sm">
        <Link href="/login" className="text-slate-400 hover:text-white transition-colors">
          Log in
        </Link>
        <Link
          href="/register"
          className="rounded-lg bg-pitch-500 px-3 py-1.5 font-medium text-white hover:bg-pitch-400 transition-colors"
        >
          Sign up
        </Link>
      </div>
    )
  }

  return (
    <div className="ml-auto flex items-center gap-4 text-sm">
      <Link href="/watchlist" className="text-slate-400 hover:text-white transition-colors">
        Watchlist
      </Link>
      <span className="text-slate-600">{user.email}</span>
      <button onClick={() => logout()} className="text-slate-400 hover:text-white transition-colors">
        Log out
      </button>
    </div>
  )
}
