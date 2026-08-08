import Parser from 'rss-parser'
import type { NormalizedRumour } from '../sportmonks.js'

const parser = new Parser({ timeout: 10_000 })

const TRANSFER_KEYWORDS = [
  'transfer', 'sign', 'signing', 'bid', 'offer', 'deal', 'move',
  'loan', 'fee', 'rumour', 'rumor', 'target', 'linked', 'interest',
  'approach', 'negotiate', 'contract', 'here we go', 'medical',
  'agreed', 'swap', 'sell', 'buy', 'complete',
]

function isTransferRelated(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase()
  return TRANSFER_KEYWORDS.some((kw) => text.includes(kw))
}

function guessWindow(text: string): NormalizedRumour['window'] {
  const lower = text.toLowerCase()
  if (['winter', 'january'].some((w) => lower.includes(w))) return 'WINTER'
  if (['summer', 'july', 'august', 'june'].some((w) => lower.includes(w))) return 'SUMMER'
  const month = new Date().getMonth() + 1
  return month >= 6 && month <= 8 ? 'SUMMER' : 'WINTER'
}

// Tier/reliability signal from community posts like "[BeSoccer - Tier 3]"
function extractTierFromTitle(title: string): number | null {
  const m = title.match(/tier\s*(\d)/i)
  if (!m) return null
  const tier = parseInt(m[1], 10)
  return Math.max(0, Math.min(1, 1 - (tier - 1) * 0.2)) // Tier1→1.0, Tier5→0.2
}

export interface RSSRumourSignal {
  headline: string
  summary: string
  link: string
  publishedAt: Date
  sourceName: string
  feedUrl: string
  window: NormalizedRumour['window']
  rawText: string
  impliedReliability: number | null // from tier tags or source defaults
}

export async function fetchRSSSignals(
  feedUrl: string,
  sourceName: string,
): Promise<RSSRumourSignal[]> {
  let feed: Awaited<ReturnType<typeof parser.parseURL>>
  try {
    feed = await parser.parseURL(feedUrl)
  } catch (err) {
    console.error(`[rss] Failed to fetch "${sourceName}" (${feedUrl}):`, err)
    return []
  }

  const signals: RSSRumourSignal[] = []

  for (const item of feed.items ?? []) {
    const title = item.title ?? ''
    const summary = item.contentSnippet ?? item.content ?? ''
    if (!isTransferRelated(title, summary)) continue

    signals.push({
      headline: title,
      summary,
      link: item.link ?? '',
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
      sourceName,
      feedUrl,
      window: guessWindow(`${title} ${summary}`),
      rawText: `${title} ${summary}`,
      impliedReliability: extractTierFromTitle(title),
    })
  }

  return signals
}

export const RSS_FEEDS: Array<{ url: string; name: string; defaultReliability: number }> = [
  // Direct journalism — highest reliability
  {
    url: 'https://www.skysports.com/rss/12040',
    name: 'Sky Sports Transfers',
    defaultReliability: 0.78,
  },
  {
    url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
    name: 'BBC Sport',
    defaultReliability: 0.80,
  },
  {
    url: 'https://www.theguardian.com/football/rss',
    name: 'The Guardian Football',
    defaultReliability: 0.75,
  },
  {
    url: 'https://www.espn.com/espn/rss/soccer/news',
    name: 'ESPN Soccer',
    defaultReliability: 0.72,
  },
  {
    url: 'https://www.marca.com/en/rss/football.xml',
    name: 'Marca Football',
    defaultReliability: 0.70,
  },
  // Google News — wide sweep across all outlets
  {
    url: 'https://news.google.com/rss/search?q=football+transfer+rumour&hl=en-GB&gl=GB&ceid=GB:en',
    name: 'Google News Transfers',
    defaultReliability: 0.60,
  },
  {
    url: 'https://news.google.com/rss/search?q="here+we+go"+transfer&hl=en-GB&gl=GB&ceid=GB:en',
    name: 'Google News Here We Go',
    defaultReliability: 0.88, // "here we go" = Romano signal
  },
  {
    url: 'https://news.google.com/rss/search?q=transfer+confirmed+football&hl=en-GB&gl=GB&ceid=GB:en',
    name: 'Google News Confirmed',
    defaultReliability: 0.82, // "confirmed" signals = outcome detector fuel
  },
  // Community tier-tagged sources
  {
    url: 'https://www.reddit.com/r/footballtransfers/new.rss',
    name: 'Reddit Transfers',
    defaultReliability: 0.45,
  },
  {
    url: 'https://www.reddit.com/r/soccer/search.rss?q=transfer+rumour&sort=new',
    name: 'Reddit Soccer',
    defaultReliability: 0.40,
  },
]
