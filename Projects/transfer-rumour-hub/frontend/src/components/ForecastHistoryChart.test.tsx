import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ForecastHistoryChart from './ForecastHistoryChart'
import { gyokeresForecastHistory, gyokeresClaimDetail, emptyForecastHistory } from '@/test/fixtures'

describe('ForecastHistoryChart — states', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  })

  it('renders a loading skeleton', () => {
    render(<ForecastHistoryChart history={null} isLoading />)
    expect(screen.getByTestId('history-loading')).toBeInTheDocument()
  })

  it('renders an error state', () => {
    render(<ForecastHistoryChart history={null} error="boom" />)
    expect(screen.getByTestId('history-error')).toBeInTheDocument()
  })

  it('renders an upgrade prompt, not the generic error, when the entitlement gate denies access', () => {
    render(
      <ForecastHistoryChart
        history={null}
        error="ignored when entitlementDenied is set"
        entitlementDenied={{ reason: 'INSUFFICIENT_TIER', requiredTier: 'PRO', currentTier: 'FREE' }}
      />,
    )
    expect(screen.getByTestId('history-entitlement-denied')).toBeInTheDocument()
    expect(screen.queryByTestId('history-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('upgrade-prompt')).toBeInTheDocument()
  })

  it('renders a clear empty state when the claim has no historical forecasts', () => {
    render(<ForecastHistoryChart history={emptyForecastHistory} />)
    expect(screen.getByTestId('history-empty')).toBeInTheDocument()
    expect(screen.getByText(/doesn't have any historical forecasts/i)).toBeInTheDocument()
  })

  it('renders a clear empty state for a null history', () => {
    render(<ForecastHistoryChart history={null} />)
    expect(screen.getByTestId('history-empty')).toBeInTheDocument()
  })
})

describe('ForecastHistoryChart — data', () => {
  it('renders the chart container when history has precise points', () => {
    render(<ForecastHistoryChart history={gyokeresForecastHistory} claim={gyokeresClaimDetail} />)
    expect(screen.getByTestId('forecast-history-chart')).toBeInTheDocument()
    expect(screen.getByText('Forecast history')).toBeInTheDocument()
  })

  it('shows an uncertainty-band legend when band data is present', () => {
    render(<ForecastHistoryChart history={gyokeresForecastHistory} claim={gyokeresClaimDetail} />)
    expect(screen.getByText(/Shaded band = uncertainty range/)).toBeInTheDocument()
  })

  it('annotates the official confirmation event when the claim has one', () => {
    render(<ForecastHistoryChart history={gyokeresForecastHistory} claim={gyokeresClaimDetail} />)
    expect(screen.getByText('Official confirmation')).toBeInTheDocument()
  })

  it('does not annotate a confirmation when the claim has none', () => {
    render(<ForecastHistoryChart history={gyokeresForecastHistory} claim={null} />)
    expect(screen.queryByText('Official confirmation')).not.toBeInTheDocument()
  })

  it('filters out INSUFFICIENT_DATA points (null probability) from the plotted series', () => {
    const mixed = [
      ...gyokeresForecastHistory,
      { predictionTimestamp: '2026-08-12T00:00:00Z', calibratedProbability: null, uncertaintyLow: null, uncertaintyHigh: null, displayMode: 'INSUFFICIENT_DATA' as const, rawScore: null },
    ]
    render(<ForecastHistoryChart history={mixed} claim={gyokeresClaimDetail} />)
    // Should still render the chart (3 valid points survive), not fall into the empty state.
    expect(screen.getByTestId('forecast-history-chart')).toBeInTheDocument()
  })
})
