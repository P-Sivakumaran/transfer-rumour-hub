import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModelCalibrationChart from './ModelCalibrationChart'
import { modelHealthTrained, modelHealthInsufficient } from '@/test/fixtures'

describe('ModelCalibrationChart — states', () => {
  it('renders a loading skeleton', () => {
    render(<ModelCalibrationChart definition={null} isLoading />)
    expect(screen.getByTestId('calibration-loading')).toBeInTheDocument()
  })

  it('renders an error state', () => {
    render(<ModelCalibrationChart definition={null} error="boom" />)
    expect(screen.getByTestId('calibration-error')).toBeInTheDocument()
  })

  it('renders an empty state when there is no definition', () => {
    render(<ModelCalibrationChart definition={null} />)
    expect(screen.getByTestId('calibration-empty')).toBeInTheDocument()
  })

  it('renders an empty state when the calibration curve has no populated bins', () => {
    render(<ModelCalibrationChart definition={modelHealthInsufficient.definitions[0]} />)
    expect(screen.getByTestId('calibration-empty')).toBeInTheDocument()
  })
})

describe('ModelCalibrationChart — data', () => {
  it('renders the chart when the curve has populated bins', () => {
    render(<ModelCalibrationChart definition={modelHealthTrained.definitions[0]} />)
    expect(screen.getByTestId('calibration-chart')).toBeInTheDocument()
    expect(screen.getByText('Model calibration')).toBeInTheDocument()
  })

  it('shows evaluation stats', () => {
    render(<ModelCalibrationChart definition={modelHealthTrained.definitions[0]} />)
    expect(screen.getByText('0.140')).toBeInTheDocument() // brierScore
    expect(screen.getByText('0.420')).toBeInTheDocument() // logLoss
    expect(screen.getByText('300')).toBeInTheDocument() // nTestSamples
  })

  it('does not show the synthetic-data badge for a db-trained model', () => {
    render(<ModelCalibrationChart definition={modelHealthTrained.definitions[0]} />)
    expect(screen.queryByTestId('calibration-synthetic-badge')).not.toBeInTheDocument()
  })

  it('shows the synthetic-data badge when trainingDataSource is not db', () => {
    const syntheticButPopulated = {
      ...modelHealthInsufficient.definitions[0],
      currentModel: {
        ...modelHealthInsufficient.definitions[0].currentModel!,
        calibrationCurve: [
          { binLow: 0, binHigh: 0.5, meanPredicted: 0.3, empiricalRate: 0.28, n: 150 },
        ],
      },
    }
    render(<ModelCalibrationChart definition={syntheticButPopulated} />)
    expect(screen.getByTestId('calibration-synthetic-badge')).toBeInTheDocument()
  })

  it('filters out zero-count bins before rendering', () => {
    const withEmptyBin = {
      ...modelHealthTrained.definitions[0],
      currentModel: {
        ...modelHealthTrained.definitions[0].currentModel!,
        calibrationCurve: [
          { binLow: 0, binHigh: 0.5, meanPredicted: 0.3, empiricalRate: 0.28, n: 150 },
          { binLow: 0.5, binHigh: 1, meanPredicted: 0, empiricalRate: 0, n: 0 },
        ],
      },
    }
    render(<ModelCalibrationChart definition={withEmptyBin} />)
    expect(screen.getByTestId('calibration-chart')).toBeInTheDocument()
  })
})
