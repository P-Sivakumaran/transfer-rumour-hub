// Privacy-conscious product-event instrumentation (requirement 5). No
// third-party analytics SDK — everything is an internal ProductEvent row,
// never sent off this application's own database. See
// docs/monetisation-proposal.md "Privacy and data-licensing considerations"
// for the reasoning behind each design choice referenced in comments below.

export type ProductEventType =
  | 'WATCHLIST_CREATED'
  | 'ALERT_ACTIVATED'
  | 'PROVENANCE_PANEL_VIEWED'
  | 'FORECAST_HISTORY_VIEWED'
  | 'UPGRADE_INTEREST_CLICKED'

export interface ProductEventDb {
  productEvent: {
    create: (args: { data: { userId: number | null; eventType: ProductEventType; metadata?: object } }) => Promise<unknown>
  }
}

// `metadata` deliberately never carries a claimId/playerId for
// PROVENANCE_PANEL_VIEWED or FORECAST_HISTORY_VIEWED — aggregate usage
// counts answer the product question these events exist for, and per-claim
// viewing history is a more sensitive behavioral profile than is needed to
// answer it. Callers for those two event types must not pass one in; there
// is no field here that would accept it.
export async function logProductEvent(
  db: ProductEventDb,
  userId: number | null,
  eventType: ProductEventType,
  metadata?: Record<string, string | number | boolean>,
): Promise<void> {
  await db.productEvent.create({ data: { userId, eventType, metadata } })
}
