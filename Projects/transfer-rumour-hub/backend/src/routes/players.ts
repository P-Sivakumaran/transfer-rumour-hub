import { Router } from 'express'
import { handleGetPlayer, handleSearchPlayers } from '../controllers/playersController.js'

const router = Router()

router.get('/search', handleSearchPlayers)
router.get('/:id', handleGetPlayer)

export default router
