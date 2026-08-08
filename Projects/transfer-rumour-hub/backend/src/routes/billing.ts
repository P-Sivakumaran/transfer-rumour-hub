import { Router } from 'express'
import Stripe from 'stripe'

const router = Router()

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000'
const REMOVE_ADS_PENCE = 99

// POST /billing/checkout-session — one-time £0.99 "remove ads" purchase
router.post('/checkout-session', async (_req, res) => {
  if (!stripe) {
    res.status(501).json({ error: 'Payments not configured — set STRIPE_SECRET_KEY' })
    return
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'gbp',
          unit_amount: REMOVE_ADS_PENCE,
          product_data: { name: 'Transfer Hub — Remove Ads' },
        },
        quantity: 1,
      },
    ],
    success_url: `${FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${FRONTEND_URL}/`,
  })

  res.json({ url: session.url })
})

// GET /billing/checkout-session/:id/status — used by the frontend's success
// page to confirm payment before it grants the ad-free cookie
router.get('/checkout-session/:id/status', async (req, res) => {
  if (!stripe) {
    res.status(501).json({ error: 'Payments not configured — set STRIPE_SECRET_KEY' })
    return
  }

  const session = await stripe.checkout.sessions.retrieve(req.params.id)
  res.json({ paid: session.payment_status === 'paid' })
})

export default router
