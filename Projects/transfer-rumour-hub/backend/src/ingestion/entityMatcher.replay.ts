/**
 * Replay harness for entityMatcher bugs found by tracing real raw_signals
 * through extractRumoursFromText() rather than guessing (same technique the
 * README credits for earlier rounds of fixes). Not a vitest suite — vitest
 * is currently broken in this env (rollup optional-dep issue), so this is
 * the actual verification path. Run with:
 *
 *   npx tsx src/ingestion/entityMatcher.replay.ts
 *
 * Requires a running Postgres with the real player/club catalog (getEntities
 * reads the DB) — these are live signals, not fixtures, so a match depends
 * on the actual entity set.
 *
 * BAD_CASES: real signals that produced wrong rumours (91, 93, 94, 98 in the
 * dev DB as of 2026-08-11). Documents expected-fixed output as each of the
 * four bugs (see git history / PR description) gets fixed.
 *
 * GOOD_CASES: real signals behind known-correct rumours (88, 89, 90) —
 * regression guards. A fix that makes a BAD_CASE right but breaks one of
 * these is not done.
 */
import { extractRumoursFromText } from './entityMatcher.js'

const BAD_CASES = [
  {
    rumourId: 91,
    note: 'Fix 1 (mononym) + Fix 2 (club scope): "Bruno" (mononym, id 2425) should not match text about "Bruno Guimarães" (id 12); after Fix 4 splits the digest, the "Bruno Guimaraes bid" segment has no club pairing so should produce nothing at all for either player.',
    headline: 'Transfer news: Huge Vinicius Jr to Arsenal update, Man Utd £60m talks, Bruno Guimaraes bid - mirror.co.uk',
    summary: 'Transfer news: Huge Vinicius Jr to Arsenal update, Man Utd £60m talks, Bruno Guimaraes bid  mirror.co.uk',
  },
  {
    rumourId: 93,
    note: 'Fix 4 (digest split): "Rashford bombshell, Rodri to Barcelona, Arsenal update" is 3 comma-joined unrelated blurbs — the real rumour (row 90) is Man City -> Barcelona; this signal alone should never claim Arsenal as fromClub.',
    headline: 'Fabrizio Romano Transfer News: Rashford bombshell, Rodri to Barcelona, Arsenal update - footballtransfers.com',
    summary: 'Fabrizio Romano Transfer News: Rashford bombshell, Rodri to Barcelona, Arsenal update  footballtransfers.com',
  },
  {
    rumourId: 94,
    note: 'Fix 3 (transfer-context gate): pure match report, not transfer news. Chermiti is mentioned only because he was carried off injured; "signing from Partizan Belgrade" is about a different player (Dragojevic) in the same article.',
    headline: 'Hibernian stun Rangers at Ibrox while O’Neill misses Høgh treble in Celtic win',
    summary: `Callum Wright scores injury-time winner for visitors

Martin O’Neill absent from Rugby Park after operation

Derek McInnes suffered a damaging home debut as Rangers manager with a 2-1 Premiership defeat to Hibernian compounded by striker Youssef Chermiti being carried off the pitch on a stretcher.

David Gray’s side took the lead in the 12th minute with a Josh Campbell penalty after the video assistant referee (VAR) had flagged up that Vanja Dragojevic, making his first Rangers start after signing from Partizan Belgrade, had fouled Jason Kerr in the area.

 Continue reading...`,
  },
  {
    rumourId: 98,
    note: 'Fix 2 (club scope): mentioned clubs are Real Madrid + Aston Villa; "Astana" only appeared because a 40-char slice truncated mid-word into a duplicated copy of the headline ("...Daily Mirror Ast") and coincidentally whole-token-matched Astana\'s "AST" shortcode. Also a semantically inverted story either way (Morgan Rogers is the incumbent being replaced, not the transfer subject) — not attempting to fix that half here.',
    headline: 'Aston Villa linked with bargain Real Madrid transfer to replace Morgan Rogers - Daily Mirror',
    summary: 'Aston Villa linked with bargain Real Madrid transfer to replace Morgan Rogers  Daily Mirror',
  },
  {
    rumourId: null,
    note: 'Fix-induced regression, not a pre-existing rumour row: before Fix 1, this signal was diverted onto the bogus mononym "Bruno" and never surfaced. After Fix 1 correctly routes it to the real "Bruno Guimarães" (id 12), "backed to hijack" was misread as a " to " destination cue (his real move is Newcastle -> Arsenal, already correct via other signals) — fixed by adding hijack/hijacks to TO_INFINITIVE_VERBS.',
    headline: 'Arsenal backed to hijack £100m Liverpool transfer after Bruno Guimaraes signing - Metro.co.uk',
    summary: 'Arsenal backed to hijack £100m Liverpool transfer after Bruno Guimaraes signing  Metro.co.uk',
  },
  {
    rumourId: null,
    note: 'Live regression found on the first post-wipe re-ingest (rumour 114 in that run): "Arsenal set to bid £70m for Newcastle midfielder" got read as Arsenal -> Newcastle (backwards; the real move is Newcastle -> Arsenal, already correct elsewhere) because "bid" was missing from TO_INFINITIVE_VERBS, same class as replace/hijack above.',
    headline: 'Bruno Guimaraes transfer news: Arsenal set to bid £70m for Newcastle midfielder - BBC',
    summary: 'Bruno Guimaraes transfer news: Arsenal set to bid £70m for Newcastle midfielder  BBC',
  },
  {
    rumourId: null,
    note: 'Manager/player disambiguation, mechanism 1: missing word boundary. "to" (no \\b) matched inside "told", so PLAYER_EXTRACTION_PATTERNS[0] read "Mikel Arteta told..." as "Mikel Arteta to [destination]" and auto-created Arsenal\'s manager as a Player.',
    headline: 'Mikel Arteta told Arsenal winger is better option than £145m transfer target - Metro.co.uk',
    summary: 'Mikel Arteta told Arsenal winger is better option than £145m transfer target  Metro.co.uk',
  },
  {
    rumourId: null,
    note: 'Manager/player disambiguation, mechanism 2: third-party attribution. "Diego Simeone confirms Julian Alvarez transfer \'decision\'" matched pattern 3 (NAME + "confirms") on Simeone (Atlético\'s manager), but the real subject (Alvarez) is the proper name immediately after the trigger, not before it.',
    headline: "Diego Simeone confirms Julian Alvarez transfer 'decision' amid Arsenal interest - The Mirror",
    summary: "Diego Simeone confirms Julian Alvarez transfer 'decision' amid Arsenal interest  The Mirror",
  },
  {
    rumourId: null,
    note: 'Manager/player disambiguation, mechanism 3: managerial appointment, not a transfer. "Ruben Amorim agrees to become AC Milan boss" matched pattern 3 on "agrees"/"here we go" — real transfer vocabulary, just not describing a player transfer.',
    headline: 'Here we go! Ruben Amorim agrees to become AC Milan boss as Man Utd handed cash boost - TribalFootball',
    summary: 'Here we go! Ruben Amorim agrees to become AC Milan boss as Man Utd handed cash boost  TribalFootball',
  },
]

const GOOD_CASES = [
  {
    rumourId: 88,
    headline: 'Transfer rumors, news: Could Spurs captain Romero join Arsenal?',
    summary: "Tottenham Hotspur captain Cristian Romero is reportedly open to joining his club's local rivals Arsenal. Transfer Talk has the latest.",
  },
  {
    rumourId: 89,
    headline: 'Arsenal sign Bruno Guimarães from Newcastle',
    summary: 'Bruno Guimarães has joined Arsenal from Newcastle United, the club has confirmed.',
  },
  {
    rumourId: 90,
    headline: "Rodri to Barcelona transfer twist after Man City respond to £38m offer - London Evening Standard",
    summary: "Rodri to Barcelona transfer twist after Man City respond to £38m offer  London Evening Standard",
  },
]

async function main() {
  console.log('=== BAD_CASES (should stop producing the wrong rumour) ===')
  for (const c of BAD_CASES) {
    console.log(`\n--- rumour ${c.rumourId} ---`)
    console.log(c.note)
    const results = await extractRumoursFromText(c.headline, c.summary)
    console.log(JSON.stringify(results, null, 2))
  }

  console.log('\n=== GOOD_CASES (must keep working) ===')
  for (const c of GOOD_CASES) {
    console.log(`\n--- rumour ${c.rumourId} ---`)
    const results = await extractRumoursFromText(c.headline, c.summary)
    console.log(JSON.stringify(results, null, 2))
  }
}

main().then(() => process.exit(0))
