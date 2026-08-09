import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { handleListWatchlist, handleAddWatchlist, handleRemoveWatchlist } from '../controllers/watchlistController.js'

const router = Router()

router.use(requireAuth)
router.get('/', handleListWatchlist)
router.post('/', handleAddWatchlist)
router.delete('/:playerId', handleRemoveWatchlist)

export default router
