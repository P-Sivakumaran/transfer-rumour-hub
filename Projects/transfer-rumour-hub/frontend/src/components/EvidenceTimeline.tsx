'use client'

import { useMemo, useState } from 'react'
import type { ClaimDetail, EvidenceItemData } from '@/types'
import {
  EVIDENCE_CATEGORIES,
  type EvidenceCategory,
  allEvidenceChronological,
  categorizeEvidence,
  findRootFor,
  isRoot,
} from '@/lib/evidenceCategories'
import { CheckCircleIcon, XCircleIcon, OriginalIcon, CopyIcon, HelpCircleIcon } from './icons'
import { clsx } from 'clsx'

interface Props {
  claim: ClaimDetail | null
  isLoading?: boolean
  error?: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function directionIcon(item: EvidenceItemData) {
  if (item.evidenceDirection === 'CONFIRMS') return <CheckCircleIcon className="h-4 w-4 text-pitch-500" />
  if (item.evidenceDirection === 'DENIES') return <XCircleIcon className="h-4 w-4 text-red-400" />
  if (item.evidenceDirection === 'CONTEXTUAL') return <HelpCircleIcon className="h-4 w-4 text-slate-500" />
  return isRoot(item) ? (
    <OriginalIcon className="h-4 w-4 text-amber-400" />
  ) : (
    <CopyIcon className="h-4 w-4 text-slate-500" />
  )
}

function EvidenceRow({ item, claim }: { item: EvidenceItemData; claim: ClaimDetail }) {
  const root = isRoot(item) ? null : findRootFor(item, claim)
  const primary = isRoot(item)

  return (
    <li id={`evidence-${item.id}`} className="relative pl-6">
      <span
        className={clsx(
          'absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2',
          primary ? 'border-amber-400 bg-amber-400/30' : 'border-slate-700 bg-slate-900',
        )}
        aria-hidden
      />
      <div
        className={clsx(
          'flex items-start gap-2.5 rounded-lg border p-3',
          primary
            ? 'border-slate-700 bg-slate-800/50'
            : 'border-slate-800/60 bg-slate-900/30 ml-2',
        )}
      >
        <span className="mt-0.5 flex-shrink-0">{directionIcon(item)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <a
              href={item.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={clsx(
                'hover:underline',
                primary ? 'text-sm font-semibold text-white' : 'text-xs font-medium text-slate-400',
              )}
            >
              {item.title}
            </a>
            {primary && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
                Original
              </span>
            )}
            {!primary && (
              <span className="rounded-full border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Copy
              </span>
            )}
          </div>
          <p className={clsx('mt-0.5', primary ? 'text-xs text-slate-400' : 'text-[11px] text-slate-600')}>
            {item.sourceName ?? 'Unknown source'} · {formatDate(item.publishedAt)}
          </p>
          {root && (
            <a href={`#evidence-${root.id}`} className="mt-1 inline-block text-[11px] text-slate-600 hover:text-slate-400 hover:underline">
              Same story as: {root.title}
            </a>
          )}
        </div>
      </div>
    </li>
  )
}

export default function EvidenceTimeline({ claim, isLoading = false, error = null }: Props) {
  const [activeFilters, setActiveFilters] = useState<Set<EvidenceCategory>>(new Set())

  const toggleFilter = (cat: EvidenceCategory) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const items = useMemo(() => (claim ? allEvidenceChronological(claim) : []), [claim])

  const visibleItems = useMemo(() => {
    if (!claim || activeFilters.size === 0) return items
    return items.filter((item) => {
      const cats = categorizeEvidence(item, claim)
      return cats.some((c) => activeFilters.has(c))
    })
  }, [items, claim, activeFilters])

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="timeline-loading">
        <div className="animate-pulse space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-slate-800/60" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="timeline-error">
        <p className="text-sm text-slate-500">Couldn&apos;t load the evidence timeline: {error}</p>
      </div>
    )
  }

  if (!claim || items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="timeline-empty">
        <p className="text-sm text-slate-500">No evidence captured for this claim yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5" data-testid="evidence-timeline">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Evidence timeline</p>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter evidence by category">
        {EVIDENCE_CATEGORIES.map(({ key, label }) => {
          const active = activeFilters.has(key)
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleFilter(key)}
              aria-pressed={active}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-pitch-500 bg-pitch-500/20 text-pitch-500'
                  : 'border-slate-700 bg-transparent text-slate-400 hover:border-slate-500 hover:text-slate-200',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {visibleItems.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No evidence matches the selected filters.</p>
      ) : (
        <ul className="mt-4 space-y-2.5 border-l border-slate-800 pl-0">
          {visibleItems.map((item) => (
            <EvidenceRow key={item.id} item={item} claim={claim} />
          ))}
        </ul>
      )}
    </div>
  )
}
