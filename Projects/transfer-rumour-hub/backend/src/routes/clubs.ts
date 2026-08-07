import { Router } from 'express'
import { handleListClubs, handleGetClub } from '../controllers/clubsController.js'

const router = Router()

router.get('/', handleListClubs)
router.get('/:id', handleGetClub)

export default router
