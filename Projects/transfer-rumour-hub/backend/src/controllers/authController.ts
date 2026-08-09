import type { Response } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import { createUser, findUserByEmail, verifyCredentials, getUserById } from '../services/authService.js'
import type { AuthedRequest } from '../middleware/auth.js'

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
}

const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

function issueSession(res: Response, userId: number): void {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' })
  res.cookie('token', token, COOKIE_OPTS)
}

export async function handleRegister(req: AuthedRequest, res: Response): Promise<void> {
  const { email, password } = CredentialsSchema.parse(req.body)

  const existing = await findUserByEmail(email)
  if (existing) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  const user = await createUser(email, password)
  issueSession(res, user.id)
  res.status(201).json(user)
}

export async function handleLogin(req: AuthedRequest, res: Response): Promise<void> {
  const { email, password } = CredentialsSchema.parse(req.body)

  const user = await verifyCredentials(email, password)
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  issueSession(res, user.id)
  res.json({ id: user.id, email: user.email, createdAt: user.createdAt })
}

export async function handleLogout(_req: AuthedRequest, res: Response): Promise<void> {
  res.clearCookie('token', COOKIE_OPTS)
  res.status(204).end()
}

export async function handleMe(req: AuthedRequest, res: Response): Promise<void> {
  const user = await getUserById(req.userId!)
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  res.json(user)
}
