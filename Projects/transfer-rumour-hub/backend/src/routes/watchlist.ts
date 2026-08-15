import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth.js'
import { requireEntitlement } from '../entitlements/middleware.js'
import type { EntitlementDb } from '../entitlements/db.js'
import type { OperationalEventDb } from '../analytics/operationalEvents.js'
import {
  handleListWatchlist,
  handleAddWatchlist,
  handleRemoveWatchlist,
  handleSetAlertMode,
  handleExportWatchlistCsv,
} from '../controllers/watchlistController.js'

const prisma = new PrismaClient()
const db = prisma as unknown as EntitlementDb & OperationalEventDb

const router = Router()

router.use(requireAuth)
router.get('/', handleListWatchlist)
router.post('/', handleAddWatchlist)
router.delete('/:playerId', handleRemoveWatchlist)
router.patch('/:playerId/alert-mode', handleSetAlertMode)
router.get('/export.csv', requireEntitlement(db, 'CSV_EXPORT_WATCHLIST'), handleExportWatchlistCsv)

export default router
