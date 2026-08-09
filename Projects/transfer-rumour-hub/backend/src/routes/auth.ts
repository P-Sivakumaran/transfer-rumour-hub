import { Router } from 'express'
import { handleRegister, handleLogin, handleLogout, handleMe } from '../controllers/authController.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.post('/register', handleRegister)
router.post('/login', handleLogin)
router.post('/logout', handleLogout)
router.get('/me', requireAuth, handleMe)

export default router
