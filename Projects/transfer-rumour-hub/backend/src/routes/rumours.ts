import { Router } from 'express'
import { handleListRumours, handleGetRumour } from '../controllers/rumoursController.js'

const router = Router()

router.get('/', handleListRumours)
router.get('/:id', handleGetRumour)

export default router
