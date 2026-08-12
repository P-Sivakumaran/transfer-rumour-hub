import type { Rumour } from '@/types'

/**
 * `fromClub` is only asserted as fact when the matcher found an explicit
 * "from"/"leaves" cue in the source text. When it was assigned by the
 * elimination fallback (fromClubInferred=true) AND it disagrees with the
 * player's actual current club, showing it as-is presents a guess as a fact
 * (see rumour 135: Balogun shown "from Man City" when he plays for Monaco,
 * because Man City was really the destination club of a different player in
 * the same digest headline). Fall back to the player's real current club in
 * that case, with a flag the UI renders as an "(unconfirmed origin)" badge.
 */
export function resolveDisplayOrigin(rumour: Rumour): { club: Rumour['fromClub']; unconfirmed: boolean } {
  const currentClub = rumour.player.currentClub
  const mismatched = currentClub != null && currentClub.id !== rumour.fromClub.id

  if (rumour.fromClubInferred && mismatched) {
    return { club: currentClub, unconfirmed: true }
  }
  return { club: rumour.fromClub, unconfirmed: false }
}
