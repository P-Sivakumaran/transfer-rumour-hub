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
  ClaimDetail,
  ForecastDisplayData,
  ForecastHistoryPoint,
  ModelHealthResponse,
  WatchlistItem,
} from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Carries status + parsed body so callers can distinguish an entitlement
// 403 (which has {reason, requiredTier, currentTier}) from any other
// failure, instead of collapsing every non-2xx into the same generic
// string — see ForecastHistoryChart's entitlementDenied prop for the
// reason this exists.
export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, path: string, body: unknown) {
    super(`API ${status}: ${path}`)
    this.status = status
    this.body = body
  }
}

async function toApiError(res: Response, path: string): Promise<ApiError> {
  const body = await res.json().catch(() => undefined)
  return new ApiError(res.status, path, body)
}

// Server Components run outside the browser, so `credentials: 'include'`
// forwards nothing — there's no cookie jar. Callers rendering on behalf of
// a specific logged-in user (e.g. claim/[id]/page.tsx, which needs the
// real tier for entitlement-gated fields) must read cookies() themselves
// (next/headers) and pass the resulting string through, same pattern
// app/watchlist/page.tsx already used before entitlements existed.
async function get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  cookie?: string,
): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    next: { revalidate: 30 },
    credentials: 'include',
    headers: cookie ? { Cookie: cookie } : undefined,
  })
  if (!res.ok) throw await toApiError(res, path)
  return res.json() as Promise<T>
}

async function getFresh<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  cookie?: string,
): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    credentials: 'include',
    headers: cookie ? { Cookie: cookie } : undefined,
  })
  if (!res.ok) throw await toApiError(res, path)
  return res.json() as Promise<T>
}

async function send<T>(method: 'PATCH' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw await toApiError(res, path)
  if (res.status === 204) return undefined as T
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
  claims: {
    get: (id: number, cookie?: string) => get<ClaimDetail>(`/claims/${id}`, undefined, cookie),
    // Not cached — this call itself persists a ClaimForecast row server-side
    // (see backend/src/forecasting/forecastService.ts), so it's a write as
    // much as a read; a stale cached response would also mean a missing
    // prediction-history row.
    forecast: (id: number, cookie?: string) => getFresh<ForecastDisplayData>(`/claims/${id}/forecast`, undefined, cookie),
    // cookie forwarded so a logged-in Pro user's real tier reaches the
    // entitlement gate server-side — see the `get`/`getFresh` comment above.
    forecastHistory: (id: number, cookie?: string) =>
      get<ForecastHistoryPoint[]>(`/claims/${id}/forecast-history`, undefined, cookie),
  },
  forecast: {
    modelHealth: () => getFresh<ModelHealthResponse>('/forecast/model-health'),
  },
  watchlist: {
    list: () => getFresh<WatchlistItem[]>('/watchlist'),
    add: (playerId: number) => send<WatchlistItem>('POST', '/watchlist', { playerId }),
    remove: (playerId: number) => send<void>('DELETE', `/watchlist/${playerId}`),
    setAlertMode: (playerId: number, mode: 'DELAYED' | 'INSTANT') =>
      send<WatchlistItem>('PATCH', `/watchlist/${playerId}/alert-mode`, { mode }),
    exportCsvUrl: () => `${BASE}/watchlist/export.csv`,
  },
  analytics: {
    // Fire-and-forget by design — a dropped analytics event must never
    // break the feature the user is actually using. Swallows failures.
    logEvent: (eventType: 'PROVENANCE_PANEL_VIEWED' | 'UPGRADE_INTEREST_CLICKED', metadata?: Record<string, string>) => {
      fetch(`${BASE}/analytics/events`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, metadata }),
      }).catch(() => {})
    },
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
