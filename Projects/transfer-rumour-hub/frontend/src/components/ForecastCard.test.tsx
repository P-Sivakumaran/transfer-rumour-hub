import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ForecastCard from './ForecastCard'
import { gyokeresForecastPrecise, intervalForecast, davidForecastInsufficient } from '@/test/fixtures'

describe('ForecastCard — loading/error/empty states', () => {
  it('renders a skeleton when loading', () => {
    render(<ForecastCard forecast={null} isLoading />)
    expect(screen.getByTestId('forecast-card-loading')).toBeInTheDocument()
  })

  it('renders an error state distinct from insufficient data', () => {
    render(<ForecastCard forecast={null} error="Network error" />)
    expect(screen.getByTestId('forecast-card-error')).toBeInTheDocument()
    expect(screen.getByText('Forecast unavailable')).toBeInTheDocument()
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })

  it('renders insufficient-data state for a null forecast', () => {
    render(<ForecastCard forecast={null} />)
    expect(screen.getByText('Insufficient historical data')).toBeInTheDocument()
  })
})

describe('ForecastCard — the model-health gate (requirement: only show probability when approved)', () => {
  it('never renders a percentage number when displayMode is INSUFFICIENT_DATA', () => {
    render(<ForecastCard forecast={davidForecastInsufficient} />)
    expect(screen.getByText('Insufficient historical data')).toBeInTheDocument()
    expect(screen.getByText(davidForecastInsufficient.insufficientDataReason!)).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('shows a single precise percentage plus its band when displayMode is PRECISE', () => {
    render(<ForecastCard forecast={gyokeresForecastPrecise} />)
    expect(screen.getByText('87%')).toBeInTheDocument()
    expect(screen.getByText(/79%–94%/)).toBeInTheDocument()
  })

  it('shows a range, not a point estimate, when displayMode is INTERVAL', () => {
    render(<ForecastCard forecast={intervalForecast} />)
    expect(screen.getByText('22%–78%')).toBeInTheDocument()
    expect(screen.queryByText('50%')).not.toBeInTheDocument()
    expect(screen.getByText(/wide-uncertainty forecast/i)).toBeInTheDocument()
  })
})

describe('ForecastCard — metadata and disclaimer', () => {
  it('shows the as-of timestamp and model version for a precise forecast', () => {
    render(<ForecastCard forecast={gyokeresForecastPrecise} />)
    expect(screen.getByText(/as of/i)).toBeInTheDocument()
    expect(screen.getByText(gyokeresForecastPrecise.modelVersion!)).toBeInTheDocument()
  })

  it('always includes the "Forecast, not confirmation" disclaimer', () => {
    const { rerender } = render(<ForecastCard forecast={gyokeresForecastPrecise} />)
    expect(screen.getByText('Forecast, not confirmation.')).toBeInTheDocument()

    rerender(<ForecastCard forecast={intervalForecast} />)
    expect(screen.getByText('Forecast, not confirmation.')).toBeInTheDocument()

    rerender(<ForecastCard forecast={davidForecastInsufficient} />)
    expect(screen.getByText('Forecast, not confirmation.')).toBeInTheDocument()
  })
})

describe('ForecastCard — colour is never the only encoding', () => {
  it('pairs an icon (svg) with text for every display mode, not colour alone', () => {
    const { container: precise, unmount: unmountPrecise } = render(<ForecastCard forecast={gyokeresForecastPrecise} />)
    expect(precise.querySelector('svg')).toBeTruthy()
    expect(within(precise).getByText('Completion likelihood')).toBeInTheDocument()
    unmountPrecise()

    const { container: interval, unmount: unmountInterval } = render(<ForecastCard forecast={intervalForecast} />)
    expect(interval.querySelector('svg')).toBeTruthy()
    unmountInterval()

    const { container: insufficient } = render(<ForecastCard forecast={davidForecastInsufficient} />)
    expect(insufficient.querySelector('svg')).toBeTruthy()
  })
})
