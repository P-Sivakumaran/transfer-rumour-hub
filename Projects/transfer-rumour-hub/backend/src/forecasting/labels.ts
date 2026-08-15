/**
 * Ground-truth label resolution for training. The asymmetry with
 * featureSnapshot.ts is deliberate and is the whole mechanism behind
 * leakage prevention: features may only see evidence with
 * `publishedAt <= asOf`; labels are ALLOWED to see evidence published after
 * asOf, because a label is "what actually happened next" — that's the
 * entire point of a supervised training example. Mixing these two up in
 * either direction breaks the pipeline: features seeing the future is
 * leakage; labels blind to the future can't be computed at all.
 */
import type { ClaimRow, EvidenceItemRow } from './db.js'
import { resolveWindowCutoff, type CutoffConfig } from './windowCutoff.js'

export type LabelResult =
  | { label: 1 | 0; resolvedAt: Date; reason: 'CONFIRMED' | 'DEADLINE_PASSED' }
  | { label: null; reason: 'STILL_PENDING' }

/**
 * @param evidenceForClaim ALL evidence for the claim, unfiltered by asOf —
 *   this function decides for itself what's "future" relative to asOf.
 * @param asOf the prediction timestamp the label is being resolved for.
 * @param now wall-clock "now" at label-resolution time — needed to tell
 *   "deadline passed with no confirmation → label 0" apart from "deadline
 *   hasn't arrived yet → not resolvable, exclude from training".
 */
export function resolveLabel(
  claim: Pick<ClaimRow, 'window' | 'firstSeenAt'>,
  evidenceForClaim: EvidenceItemRow[],
  horizonDays: number,
  cutoffConfig: CutoffConfig,
  asOf: Date,
  now: Date,
): LabelResult {
  const horizonEnd = new Date(asOf.getTime() + horizonDays * 24 * 60 * 60 * 1000)
  const windowCutoff = resolveWindowCutoff(claim.window, claim.firstSeenAt, cutoffConfig)
  const deadline = windowCutoff && windowCutoff.getTime() < horizonEnd.getTime() ? windowCutoff : horizonEnd

  const confirmation = evidenceForClaim
    .filter(
      (e) =>
        e.sourceType === 'CLUB_OFFICIAL' &&
        e.evidenceDirection === 'CONFIRMS' &&
        e.publishedAt.getTime() > asOf.getTime() &&
        e.publishedAt.getTime() <= deadline.getTime(),
    )
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())[0]

  if (confirmation) return { label: 1, resolvedAt: confirmation.publishedAt, reason: 'CONFIRMED' }
  if (deadline.getTime() <= now.getTime()) return { label: 0, resolvedAt: deadline, reason: 'DEADLINE_PASSED' }
  return { label: null, reason: 'STILL_PENDING' }
}
