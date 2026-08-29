'use client'

import dynamic from 'next/dynamic'

// Sigma requires window — load client-side only
const TransferGraph = dynamic(() => import('@/components/network/TransferGraph'), { ssr: false })

export default function TransferGraphClient() {
  return <TransferGraph />
}
