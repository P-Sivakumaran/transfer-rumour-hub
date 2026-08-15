import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WhyThisForecast from './WhyThisForecast'
import { gyokeresClaimDetail, davidClaimDetail } from '@/test/fixtures'

describe('WhyThisForecast — states', () => {
  it('renders a loading skeleton', () => {
    render(<WhyThisForecast claim={null} isLoading />)
    expect(screen.getByTestId('why-loading')).toBeInTheDocument()
  })

  it('renders an error state', () => {
    render(<WhyThisForecast claim={null} error="boom" />)
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })

  it('renders an empty state for a null claim', () => {
    render(<WhyThisForecast claim={null} />)
    expect(screen.getByTestId('why-empty')).toBeInTheDocument()
  })
})

describe('WhyThisForecast — factors', () => {
  it('shows official confirmation under strongest support, linked to its evidence URL', () => {
    render(<WhyThisForecast claim={gyokeresClaimDetail} />)
    expect(screen.getByText('Official club confirmation')).toBeInTheDocument()
    const link = screen.getAllByText('View evidence')[0].closest('a')
    expect(link).toHaveAttribute('href', expect.stringContaining('mancity.com'))
  })

  it('explains independent corroboration count, not raw article count, in the rendered text', () => {
    render(<WhyThisForecast claim={gyokeresClaimDetail} />)
    expect(screen.getByText('2 independent sources')).toBeInTheDocument()
  })

  it('shows official denial under strongest doubt for a denied claim', () => {
    render(<WhyThisForecast claim={davidClaimDetail} />)
    expect(screen.getByText('Official club denial')).toBeInTheDocument()
  })

  it('always renders a "What would change this?" section', () => {
    render(<WhyThisForecast claim={gyokeresClaimDetail} />)
    expect(screen.getByText('What would change this?')).toBeInTheDocument()
    // Already confirmed — the confirmation bullet should not appear, but
    // the denial one should.
    expect(screen.getByText(/official denial would end this claim/i)).toBeInTheDocument()
  })
})
