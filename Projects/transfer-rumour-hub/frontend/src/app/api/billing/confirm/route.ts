import { NextRequest, NextResponse } from 'next/server'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const STRIPE_SESSION_ID = /^cs_[A-Za-z0-9_]{1,200}$/

// Called by the /billing/success page after Stripe redirects back. Verifies
// payment with the backend (which holds the Stripe secret key) and, only if
// actually paid, sets the ad-free cookie on this (frontend) origin — the
// origin that reads it server-side to decide whether to render ad slots.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId || !STRIPE_SESSION_ID.test(sessionId)) {
    return NextResponse.json({ error: 'Missing or invalid session_id' }, { status: 400 })
  }

  const res = await fetch(`${BASE}/billing/checkout-session/${encodeURIComponent(sessionId)}/status`)
  if (!res.ok) {
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  }

  const { paid } = (await res.json()) as { paid: boolean }
  const response = NextResponse.json({ paid })
  if (paid) {
    response.cookies.set('ads_removed', '1', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365 * 10,
    })
  }
  return response
}
