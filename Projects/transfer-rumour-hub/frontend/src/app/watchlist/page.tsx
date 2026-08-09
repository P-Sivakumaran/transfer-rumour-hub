import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RumourCard from '@/components/RumourCard'
import type { PaginatedResponse, Rumour } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export default async function WatchlistPage() {
  const cookieStore = cookies()
  if (!cookieStore.get('token')) redirect('/login')

  const res = await fetch(`${BASE}/rumours?watchlist=true&limit=50`, {
    headers: { Cookie: cookieStore.toString() },
    cache: 'no-store',
  })
  if (res.status === 401) redirect('/login')
  if (!res.ok) throw new Error(`API ${res.status}: /rumours?watchlist=true`)

  const { data: rumours, total } = (await res.json()) as PaginatedResponse<Rumour>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Watchlist</h1>
      <div className="space-y-3">
        {rumours.map((r) => (
          <RumourCard key={r.id} rumour={r} />
        ))}
        {rumours.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center">
            <p className="text-slate-500">No rumours for watched players yet.</p>
            <Link href="/" className="mt-2 inline-block text-pitch-500 hover:underline">
              Browse rumours →
            </Link>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-600">{total} total</p>
    </div>
  )
}
