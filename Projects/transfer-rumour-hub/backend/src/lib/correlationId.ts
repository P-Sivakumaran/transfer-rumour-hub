import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'

export interface CorrelatedRequest extends Request {
  correlationId?: string
}

// Request-scoped correlation ID — same randomUUID() primitive already used
// once in this codebase for SSE client IDs (sse/broadcaster.ts). Accepts an
// inbound X-Correlation-Id (capped, so a caller can't inject something
// unbounded into logs) so a request can be traced across a future
// gateway/proxy hop; otherwise mints one. Echoed back so a client can
// correlate its own logs with server-side ones.
export function correlationId(req: CorrelatedRequest, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id')
  const id = incoming && incoming.length > 0 && incoming.length <= 100 ? incoming : randomUUID()
  req.correlationId = id
  res.setHeader('x-correlation-id', id)
  next()
}
