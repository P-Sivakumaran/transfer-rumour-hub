import { Router } from 'express'
import { handleListForecastDefinitions, handleModelHealth } from '../controllers/forecastController.js'

const router = Router()

router.get('/definitions', handleListForecastDefinitions)
router.get('/model-health', handleModelHealth)

export default router
