import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireApiKey } from '../apiKeys/middleware.js'
import type { ApiKeyDb, ApiKeyUsageDb } from '../apiKeys/db.js'
import type { OperationalEventDb } from '../analytics/operationalEvents.js'
import { handleHistoricalClaims, handleEvidenceMetadata } from '../controllers/researchController.js'

const prisma = new PrismaClient()
const db = prisma as unknown as ApiKeyDb & ApiKeyUsageDb & OperationalEventDb

const router = Router()

// API-key authenticated, not cookie-session — this replaces the
// requireAuth + requireEntitlement gate these routes used before Research
// API keys existed (docs/public-beta-readiness-audit.md: "Research tier
// has no real API-key auth" was the flagged gap). Tier is still enforced
// (requireApiKey checks the key owner's current tier live), just via the
// key rather than a browser cookie — this is a programmatic-access surface
// now, not a browser one.
router.get(
  '/historical-claims',
  requireApiKey(db, { scope: 'RESEARCH_READ', featureKey: 'HISTORICAL_DATASETS', endpointCategory: 'HISTORICAL_CLAIMS' }),
  handleHistoricalClaims,
)
router.get(
  '/evidence-metadata',
  requireApiKey(db, { scope: 'RESEARCH_EXPORT', featureKey: 'PROVENANCE_BULK_EXPORT', endpointCategory: 'EVIDENCE_METADATA' }),
  handleEvidenceMetadata,
)

export default router
