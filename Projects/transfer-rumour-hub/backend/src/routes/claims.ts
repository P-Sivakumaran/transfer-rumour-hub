import { Router } from 'express'
import { optionalAuth } from '../middleware/auth.js'
import { handleListClaims, handleGetClaim, handleGetClaimForecastHistory } from '../controllers/claimsController.js'
import { handleGetClaimForecast } from '../controllers/forecastController.js'

const router = Router()

// optionalAuth, not requireAuth — claims stay browsable anonymously
// (unchanged public contract); it only populates req.userId so the
// entitlement checks in claimsController know a logged-in user's tier
// instead of defaulting everyone to Free.
router.use(optionalAuth)

router.get('/', handleListClaims)
router.get('/:id', handleGetClaim)
router.get('/:id/forecast', handleGetClaimForecast)
router.get('/:id/forecast-history', handleGetClaimForecastHistory)

export default router
