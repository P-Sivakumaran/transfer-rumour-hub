'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface User {
  id: number
  email: string
}

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh(): Promise<void> {
    const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
    setUser(res.ok ? await res.json() : null)
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  async function submit(path: string, email: string, password: string): Promise<void> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(body.error ?? 'Request failed')
    }
    await refresh()
  }

  const value: AuthContextValue = {
    user,
    loading,
    login: (email, password) => submit('/auth/login', email, password),
    register: (email, password) => submit('/auth/register', email, password),
    logout: async () => {
      await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
      setUser(null)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
