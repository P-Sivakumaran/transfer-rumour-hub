'use client'

import { useEffect, useReducer } from 'react'
import type { Rumour, RumourStatus } from '@/types'

interface RumourUpdate {
  id: number
  computedLikelihood: number
  status: RumourStatus
}

type Action =
  | { type: 'INIT'; rumours: Rumour[] }
  | { type: 'UPDATE'; payload: RumourUpdate }
  | { type: 'NEW'; rumourId: number }

function reducer(state: Rumour[], action: Action): Rumour[] {
  switch (action.type) {
    case 'INIT':
      return action.rumours
    case 'UPDATE':
      return state.map((r) =>
        r.id === action.payload.id
          ? { ...r, computedLikelihood: action.payload.computedLikelihood, status: action.payload.status }
          : r,
      )
    default:
      return state
  }
}

export function useRumourFeed(initialRumours: Rumour[]) {
  const [rumours, dispatch] = useReducer(reducer, initialRumours)

  useEffect(() => {
    dispatch({ type: 'INIT', rumours: initialRumours })
  }, [initialRumours])

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SSE_URL ?? 'http://localhost:3001/events'
    const es = new EventSource(url)

    es.addEventListener('rumour:updated', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as RumourUpdate
        dispatch({ type: 'UPDATE', payload })
      } catch {}
    })

    es.onerror = () => console.warn('[SSE] Connection lost — auto-reconnecting')

    return () => es.close()
  }, [])

  return rumours
}
