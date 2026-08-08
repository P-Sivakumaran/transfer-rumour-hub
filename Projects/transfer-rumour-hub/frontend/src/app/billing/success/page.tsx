'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Status = 'checking' | 'ok' | 'error'

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-md py-20 text-center text-slate-400">Loading…</p>}>
      <BillingSuccessContent />
    </Suspense>
  )
}

function BillingSuccessContent() {
  const params = useSearchParams()
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    const sessionId = params.get('session_id')
    if (!sessionId) {
      setStatus('error')
      return
    }
    fetch(`/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((d: { paid?: boolean }) => setStatus(d.paid ? 'ok' : 'error'))
      .catch(() => setStatus('error'))
  }, [params])

  return (
    <div className="mx-auto max-w-md space-y-4 py-20 text-center">
      {status === 'checking' && <p className="text-slate-400">Confirming payment…</p>}
      {status === 'ok' && (
        <>
          <p className="text-xl font-semibold text-white">Ads removed. Thanks for the support.</p>
          {/* Full reload, not client navigation — the ad-free cookie needs to
              be picked up by a fresh server render of the feed. */}
          <a
            href="/"
            className="inline-block rounded-lg bg-pitch-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pitch-600"
          >
            Back to Transfer Hub
          </a>
        </>
      )}
      {status === 'error' && (
        <p className="text-red-400">Couldn&apos;t confirm payment. If you were charged, contact support.</p>
      )}
    </div>
  )
}
