'use client'

type SSEHandler = (data: unknown) => void

export function createSSEConnection(onEvent: Record<string, SSEHandler>): () => void {
  const url = process.env.NEXT_PUBLIC_SSE_URL ?? 'http://localhost:3001/events'
  const es = new EventSource(url)

  for (const [event, handler] of Object.entries(onEvent)) {
    es.addEventListener(event, (e: MessageEvent) => {
      try {
        handler(JSON.parse(e.data))
      } catch {
        console.error('[SSE] Parse error', e.data)
      }
    })
  }

  es.onerror = () => {
    console.warn('[SSE] Connection error — will retry automatically.')
  }

  return () => es.close()
}
