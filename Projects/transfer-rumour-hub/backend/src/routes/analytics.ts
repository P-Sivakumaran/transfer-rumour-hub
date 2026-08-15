import { Router } from 'express'
import { optionalAuth } from '../middleware/auth.js'
import { handleLogEvent } from '../controllers/analyticsController.js'

const router = Router()

// optionalAuth — upgrade-interest clicks and provenance-panel views can
// come from anonymous sessions; userId is attached when present.
router.use(optionalAuth)
router.post('/events', handleLogEvent)

export default router
