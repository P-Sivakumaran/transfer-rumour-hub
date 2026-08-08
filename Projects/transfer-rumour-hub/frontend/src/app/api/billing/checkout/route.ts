import { NextResponse } from 'next/server'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function POST() {
  const res = await fetch(`${BASE}/billing/checkout-session`, { method: 'POST' })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
