import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProvenanceGraph from './ProvenanceGraph'
import { gyokeresClaimDetail } from '@/test/fixtures'

describe('ProvenanceGraph — states', () => {
  it('renders a loading skeleton', () => {
    render(<ProvenanceGraph claim={null} isLoading />)
    expect(screen.getByTestId('provenance-loading')).toBeInTheDocument()
  })

  it('renders an error state', () => {
    render(<ProvenanceGraph claim={null} error="boom" />)
    expect(screen.getByTestId('provenance-error')).toBeInTheDocument()
  })

  it('renders an empty state for a null claim', () => {
    render(<ProvenanceGraph claim={null} />)
    expect(screen.getByTestId('provenance-empty')).toBeInTheDocument()
  })
})

describe('ProvenanceGraph — progressive disclosure', () => {
  it('is collapsed by default — not the first thing rendered', () => {
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    expect(screen.getByTestId('provenance-collapsed')).toBeInTheDocument()
    expect(screen.queryByTestId('provenance-expanded')).not.toBeInTheDocument()
  })

  it('expands on click, revealing the graph', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))
    expect(screen.getByTestId('provenance-expanded')).toBeInTheDocument()
  })

  it('can collapse back', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))
    await user.click(screen.getByText('▾ Provenance graph'))
    expect(screen.getByTestId('provenance-collapsed')).toBeInTheDocument()
  })
})

describe('ProvenanceGraph — view modes and mobile fallback', () => {
  it('shows both a spatial graph container (desktop) and a list container (compact fallback) by default', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))
    expect(screen.getByTestId('provenance-svg-view')).toBeInTheDocument()
    expect(screen.getByTestId('provenance-list-view')).toBeInTheDocument()
  })

  it('"View as list" forces list-only rendering, removing the spatial graph entirely', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))
    await user.click(screen.getByText('View as list'))
    expect(screen.queryByTestId('provenance-svg-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('provenance-list-view')).toBeInTheDocument()
  })
})

describe('ProvenanceGraph — accessibility', () => {
  it('every node is a real, accessibly-labeled button', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))
    const claimButton = screen.getByRole('button', { name: /^Claim: Claim #1/ })
    expect(claimButton).toBeInTheDocument()
    const sourceButton = screen.getByRole('button', { name: /^Source: Fabrizio Romano/ })
    expect(sourceButton).toBeInTheDocument()
  })

  it('does not encode credibility as a single opaque colour — tier is rendered as text', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))
    // Romano is Tier 1 in the fixture — his tier must be visible as text
    // somewhere (list view), not just implied by node colour.
    const list = screen.getByTestId('provenance-list-view')
    expect(within(list).getByText('Source: Fabrizio Romano, Tier 1')).toBeInTheDocument()
  })

  it('zoom controls exist with a reset action, all keyboard-accessible buttons', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    const resetButton = screen.getByRole('button', { name: 'Reset zoom' })

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('120%')).toBeInTheDocument()
    await user.click(resetButton)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})

describe('ProvenanceGraph — keyboard navigation', () => {
  it('arrow keys move focus between connected nodes', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))

    const claimButton = screen.getByRole('button', { name: /^Claim: Claim #1/ })
    claimButton.focus()
    expect(document.activeElement).toBe(claimButton)

    await user.keyboard('{ArrowRight}')
    // Focus should have moved to one of the claim's neighbors, not stayed
    // on the claim node itself.
    expect(document.activeElement).not.toBe(claimButton)
    expect(document.activeElement?.tagName).toBe('BUTTON')
  })

  it('selecting a node (Enter/click) shows a detail panel with its connection count', async () => {
    const user = userEvent.setup()
    render(<ProvenanceGraph claim={gyokeresClaimDetail} />)
    await user.click(screen.getByText('Investigate provenance graph'))

    const claimButton = screen.getByRole('button', { name: /^Claim: Claim #1/ })
    await user.click(claimButton)

    expect(screen.getByRole('status')).toHaveTextContent(/connected node/)
  })
})
