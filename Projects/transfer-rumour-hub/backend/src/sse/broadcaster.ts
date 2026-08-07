import type { Response } from 'express'

interface SSEClient {
  id: string
  res: Response
}

const clients = new Map<string, SSEClient>()

export function addClient(id: string, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  // Heartbeat every 25s to prevent proxy timeouts
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 25_000)

  clients.set(id, { id, res })

  res.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(id)
  })
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients.values()) {
    client.res.write(payload)
  }
}

export function clientCount(): number {
  return clients.size
}
