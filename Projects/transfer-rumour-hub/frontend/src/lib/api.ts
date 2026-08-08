import type {
  AdminRumour,
  AdminSource,
  ClubDetail,
  PaginatedResponse,
  Player,
  RumourDetail,
  RumourStatus,
  Rumour,
  Club,
} from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { next: { revalidate: 30 } })
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function getFresh<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function send<T>(method: 'PATCH' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

export interface RumourQueryParams {
  league?: string
  clubId?: number
  position?: string
  status?: string
  window?: string
  page?: number
  limit?: number
}

export const api = {
  rumours: {
    list: (params?: RumourQueryParams) =>
      get<PaginatedResponse<Rumour>>('/rumours', params as Record<string, string | number>),
    get: (id: number) => get<RumourDetail>(`/rumours/${id}`),
  },
  players: {
    get: (id: number) => get<Player & { rumours: Rumour[] }>(`/players/${id}`),
    search: (q: string) => get<Player[]>('/players/search', { q }),
  },
  clubs: {
    list: (league?: string) => get<Club[]>('/clubs', league ? { league } : undefined),
    get: (id: number) => get<ClubDetail>(`/clubs/${id}`),
  },
  stats: {
    sources: () => get<(import('@/types').Source & { _count: { rumours: number } })[]>('/stats/sources'),
    overview: () => get<{ totalRumours: number; hotRumours: number; completedRumours: number }>('/stats/overview'),
  },
  admin: {
    rumours: (status?: RumourStatus) => getFresh<AdminRumour[]>('/admin/rumours', status ? { status } : undefined),
    sources: () => getFresh<AdminSource[]>('/admin/sources'),
    setOutcome: (id: number, status: 'COMPLETED' | 'FAILED' | 'DENIED') =>
      send<{ id: number; status: string }>('PATCH', `/admin/rumours/${id}/outcome`, { status }),
    enrichPlayer: (playerId: number) =>
      send<{ queued: boolean; playerId: number; playerName: string }>('POST', `/admin/players/${playerId}/enrich`),
  },
}
