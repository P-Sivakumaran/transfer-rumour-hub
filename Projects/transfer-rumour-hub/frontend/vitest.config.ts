import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // tsconfig.json sets jsx:"preserve" (Next.js owns the real JSX transform
  // in dev/build) — vitest's esbuild pre-transform needs its own jsx
  // handling since it never goes through Next's pipeline.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
