import { NextRequest, NextResponse } from 'next/server'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Called by the /billing/success page after Stripe redirects back. Verifies
// payment with the backend (which holds the Stripe secret key) and, only if
// actually paid, sets the ad-free cookie on this (frontend) origin — the
// origin that reads it server-side to decide whether to render ad slots.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
  }

  const res = await fetch(`${BASE}/billing/checkout-session/${sessionId}/status`)
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
