import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'

export interface AuthedRequest extends Request {
  userId?: number
}

function readUserId(req: Request): number | undefined {
  const token = req.cookies?.token
  if (!token) return undefined
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number }
    return payload.userId
  } catch {
    return undefined
  }
}

// Rejects unauthenticated requests.
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const userId = readUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  req.userId = userId
  next()
}

// Populates req.userId when a valid session cookie is present, but lets
// anonymous requests through — for routes like the rumour feed that behave
// differently for logged-in users without requiring login.
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  req.userId = readUserId(req)
  next()
}
