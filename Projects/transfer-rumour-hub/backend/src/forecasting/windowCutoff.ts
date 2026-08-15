/**
 * Transfer-window cutoff resolution — configurable via ForecastDefinition
 * (requirement 1), not a hardcoded constant. No cutoff-date concept existed
 * anywhere in this codebase before the forecasting pipeline: guessWindow()
 * in rss.ts/sportmonks.ts/apifootball.ts only ever infers SUMMER/WINTER from
 * a month number, never a closing date. MM-DD approximations here are a
 * deliberate simplification — real cutoffs vary by competition/season, see
 * docs/forecasting-methodology.md "Limitations".
 */

export interface CutoffConfig {
  summerCutoffMonthDay: string // "MM-DD"
  winterCutoffMonthDay: string
}

function parseMonthDay(monthDay: string): { month: number; day: number } {
  const [mm, dd] = monthDay.split('-').map(Number)
  return { month: mm, day: dd }
}

// The next occurrence of `monthDay` on or after `referenceDate` — handles
// the year-wraparound case (e.g. reference is November, cutoff is January).
function nextOccurrenceOnOrAfter(monthDay: string, referenceDate: Date): Date {
  const { month, day } = parseMonthDay(monthDay)
  const year = referenceDate.getUTCFullYear()
  let cutoff = new Date(Date.UTC(year, month - 1, day, 23, 59, 59))
  if (cutoff.getTime() < referenceDate.getTime()) {
    cutoff = new Date(Date.UTC(year + 1, month - 1, day, 23, 59, 59))
  }
  return cutoff
}

/**
 * Returns null for FREE_AGENT or a null window — there's no cutoff to
 * resolve. `referenceDate` should be the claim's `firstSeenAt` (the window
 * the claim was raised within), not "now" — resolving relative to "now"
 * would make a past claim's cutoff drift forward every time this is called,
 * which is itself a subtle form of temporal inconsistency in feature/label
 * computation.
 */
export function resolveWindowCutoff(
  window: string | null,
  referenceDate: Date,
  config: CutoffConfig,
): Date | null {
  if (window === 'SUMMER') return nextOccurrenceOnOrAfter(config.summerCutoffMonthDay, referenceDate)
  if (window === 'WINTER') return nextOccurrenceOnOrAfter(config.winterCutoffMonthDay, referenceDate)
  return null
}
