import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { handleCreateApiKey, handleListApiKeys } from '../controllers/apiKeysController.js'

const router = Router()

// Cookie session, not the API key itself — a Research user manages their
// keys from the browser. Revocation is admin-only, see routes/admin.ts.
router.use(requireAuth)
router.post('/', handleCreateApiKey)
router.get('/', handleListApiKeys)

export default router
