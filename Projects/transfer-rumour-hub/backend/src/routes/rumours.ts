import { Router } from 'express'
import { handleListRumours, handleGetRumour } from '../controllers/rumoursController.js'
import { optionalAuth } from '../middleware/auth.js'

const router = Router()

router.get('/', optionalAuth, handleListRumours)
router.get('/:id', handleGetRumour)

export default router
