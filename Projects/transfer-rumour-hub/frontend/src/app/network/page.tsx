import dynamic from 'next/dynamic'

// Sigma requires window — load client-side only
const TransferGraph = dynamic(() => import('@/components/network/TransferGraph'), { ssr: false })

export default function NetworkPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transfer Network</h1>
        <p className="mt-1 text-sm text-slate-400">
          Force-directed graph of players, clubs, and active transfer rumours.
          Node size = market value · Edge thickness = likelihood · Edge color = status.
        </p>
      </div>
      <TransferGraph />
    </div>
  )
}
