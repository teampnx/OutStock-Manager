# GDPR Compliance — Curatify Collection Sort & Merch

This document describes how Curatify satisfies Shopify’s mandatory GDPR webhooks and data-deletion requirements.

## Mandatory webhooks

Registered in `shopify.app.toml` and implemented as React Router actions:

| Topic | Route | Handler |
|-------|-------|---------|
| `customers/data_request` | `/webhooks/customers/data_request` | `app/routes/webhooks.customers.data_request.tsx` |
| `customers/redact` | `/webhooks/customers/redact` | `app/routes/webhooks.customers.redact.tsx` |
| `shop/redact` | `/webhooks/shop/redact` | `app/routes/webhooks.shop.redact.tsx` |

All handlers verify HMAC via `authenticate.webhook(request)` from the Shopify app library.

## Customer data

**Curatify does not store Shopify customer PII** (names, emails, addresses, order history, or customer IDs in persistent tables).

The app only stores **shop-scoped** operational data:

- Products and inventory status (for sold-out sorting)
- Collections and product positions
- Activity logs (product/collection events)
- Billing subscription metadata
- App settings

### `customers/data_request`

When a merchant’s customer requests their data:

1. Webhook is deduplicated and recorded in `WebhookEvent`.
2. A compliance log line is written (`[gdpr-compliance]`).
3. **No customer export is required** because the app does not persist customer PII.
4. Handler returns `200 OK`.

If you later add customer-facing features, extend `logCustomerDataRequest` and this handler to export any new customer-linked fields.

### `customers/redact`

When a merchant’s customer requests deletion:

1. Webhook is recorded (same dedupe pattern).
2. Compliance log notes that no customer PII exists to delete.
3. Handler returns `200 OK`.

## Shop data deletion

### `shop/redact`

Sent by Shopify after app uninstall (typically ~48 hours). Handler:

1. Records the webhook receipt.
2. Calls `deleteAllShopData(shopDomain, "shop_redact")` in `app/models/shop-cleanup.server.ts`.
3. Returns `500` on failure so Shopify retries.

### `app/uninstalled`

On uninstall:

1. Sessions are deleted immediately (revoke API access).
2. A `CLEANUP_SHOP` background job is enqueued via `ingestWebhook`.
3. The job worker runs the same `deleteAllShopData` routine.

This provides prompt cleanup on uninstall; `shop/redact` acts as a guaranteed second pass.

## What `deleteAllShopData` removes

**Inside a single Prisma transaction** (per cleanup path):

| Data | Model(s) |
|------|----------|
| Activity logs | `ActivityLog` |
| Collection positions | `CollectionProductPosition` |
| Legacy membership positions | `OriginalCollectionPosition`, `CollectionMembership` |
| Inventory history | `InventoryStatusHistory` |
| Collections | `Collection` |
| Pinned products | `PinnedProduct` |
| Products | `TrackedProduct` |
| Background jobs | `Job` (by `shopId` or `shopDomain`) |
| Webhook audit rows | `WebhookEvent` |
| Billing | `Subscription` |
| Settings | `Settings` |
| Shop record | `Shop` |
| OAuth sessions | `Session` (by shop domain) |

If the shop row is already gone, orphan `Job`, `WebhookEvent`, and `Session` rows for that domain are still removed in one transaction.

## Logging

All compliance actions use the `[gdpr-compliance]` log prefix via `logGdprCompliance` in `app/models/shop-cleanup.server.ts` and helpers in `app/lib/gdpr-compliance.server.ts`.

Logs include:

- Webhook topic and `shopifyWebhookId`
- Shop domain
- Deletion counts per table
- Duplicate webhook skips

**Do not log** full webhook payloads containing customer emails in production.

## Deployment checklist

1. Run `shopify app deploy` (or `shopify app dev`) so GDPR webhooks register with Shopify.
2. Confirm all three compliance topics appear in Partners → App setup → Webhooks.
3. Use Shopify’s “Send test webhook” for each compliance topic on a dev store.
4. Verify logs show `[gdpr-compliance]` entries and that `shop/redact` removes rows from the database.

## Related files

- `app/models/shop-cleanup.server.ts` — transactional deletion
- `app/lib/gdpr-compliance.server.ts` — webhook receipt + customer handlers
- `app/workers/handlers/process-cleanup-shop.server.ts` — uninstall job
- `app/routes/webhooks.app.uninstalled.tsx` — uninstall + session revoke
- `shopify.app.toml` — webhook registration
