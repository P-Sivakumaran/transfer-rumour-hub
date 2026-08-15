import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom doesn't implement ResizeObserver — Recharts' ResponsiveContainer
// (TimelineChart, ForecastHistoryChart, ClubDashboard, ...) needs it just
// to mount, regardless of whether a test ever checks a size-dependent
// value. Standard no-op stand-in for jsdom test environments.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver)

// globals:false in vitest.config.ts (deliberate — avoids injecting a global
// test API surface) means RTL's automatic afterEach-cleanup detection never
// fires, since it relies on finding a global `afterEach`. Register it
// explicitly instead — without this, DOM from one test leaks into the next.
afterEach(() => {
  cleanup()
})
