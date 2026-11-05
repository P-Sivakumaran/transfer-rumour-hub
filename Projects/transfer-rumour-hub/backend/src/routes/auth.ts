import { Router } from 'express'
import { handleRegister, handleLogin, handleLogout, handleMe } from '../controllers/authController.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimitMiddleware } from '../lib/rateLimit.js'

const router = Router()

const ipKey = (name: string) => (req: { ip?: string }) => `auth:${name}:${req.ip ?? 'unknown'}`
const registerLimit = rateLimitMiddleware({ keyFn: ipKey('register'), limit: 10, windowSeconds: 3600, failureMode: 'OPEN' })
const loginLimit = rateLimitMiddleware({ keyFn: ipKey('login'), limit: 10, windowSeconds: 900, failureMode: 'OPEN' })
const meLimit = rateLimitMiddleware({ keyFn: ipKey('me'), limit: 120, windowSeconds: 60, failureMode: 'OPEN' })

router.post('/register', registerLimit, handleRegister)
router.post('/login', loginLimit, handleLogin)
router.post('/logout', handleLogout)
router.get('/me', meLimit, requireAuth, handleMe)

export default router
