# OutStock Manager — Shopify App Store Submission Checklist

Use this checklist before submitting for Shopify App Store review.

## Partners & distribution

- [ ] **Public distribution enabled** — Partners → Apps → OutStock Manager → Distribution → Shopify App Store (can remain draft/unlisted). Required for Billing API.
- [ ] **App URL** — Production `SHOPIFY_APP_URL` matches the deployed app host.
- [ ] **Allowed redirection URL(s)** — Callback and billing return URLs registered in Partners.
- [ ] **API scopes** — Documented and minimal; match `shopify.app.toml` and privacy policy.
- [ ] **Webhooks** — `app/uninstalled`, `app_subscriptions/update`, and inventory/collection webhooks registered and healthy in production.

## Billing

- [ ] **Growth ($9.99) and Pro ($19.99) plans** — Configured in `shopify.server.ts` and Partners billing.
- [ ] **Test billing verified** — Upgrade flow completes on a dev store with `SHOPIFY_BILLING_TEST=true`.
- [ ] **Production billing** — Set `SHOPIFY_BILLING_TEST=false` before launch; verify proration and downgrade to Free.
- [ ] **Billing callback** — `/app/billing/callback` redirects correctly after merchant approval.
- [ ] **Plan limits enforced** — Free/Growth/Pro collection and product caps block over-limit actions with clear messaging.

## App experience (merchant-facing)

- [ ] **Embedded app loads** — No console errors in Shopify Admin iframe.
- [ ] **Navigation** — Home, Dashboard, Collections, Activity, Pricing, Settings all reachable.
- [ ] **Onboarding path** — Settings → enable app → enable collections → verify activity log.
- [ ] **Empty states** — Dashboard, Collections, Activity show helpful copy when no data.
- [ ] **Error states** — Load failures show banners without raw stack traces or internal codes.
- [ ] **Mobile admin** — Key pages usable at narrow widths (tables scroll, grids stack).

## Functional smoke test

- [ ] Enable OutStock Manager in Settings and save.
- [ ] Enable push-down on a **manual** collection; confirm sort runs.
- [ ] Mark a product sold out; confirm it moves to bottom and Activity logs the event.
- [ ] Restock product; confirm restore behavior matches Settings (original vs. top).
- [ ] Run **Sync sold-out products** backfill; confirm result counts display.
- [ ] **Sort enabled collections** from Collections page completes without error.
- [ ] Upgrade/downgrade on Pricing page (after distribution fix).

## Legal & trust

- [ ] **Privacy policy URL** — Public URL listed in Partners listing and in-app if required.
- [ ] **Support email / contact** — Listed in Partners and reachable.
- [ ] **Data handling** — Document what is stored (shop, collections, activity log) and retention on uninstall.
- [ ] **GDPR / data request** — Process documented if storing merchant or customer data.

## Listing assets

- [ ] **App name & subtitle** — Clear value prop (sold-out sorting for manual collections).
- [ ] **App icon** — 1200×1200 PNG, no Shopify trademark misuse.
- [ ] **Screenshots** — Dashboard, Collections, Activity, Pricing, Settings (desktop admin).
- [ ] **Demo video** (recommended) — Install → enable → sold-out move → restore.
- [ ] **Search keywords** — inventory, sold out, collection sort, out of stock.
- [ ] **Pricing copy** — Matches in-app plans (Free, Growth, Pro).

## Technical production readiness

- [ ] **Database migrations** — Applied on production (`prisma migrate deploy`).
- [ ] **Background worker / jobs** — Collection sort and webhook processing running.
- [ ] **Logging** — No verbose `[pricing]` debug logs in production builds.
- [ ] **Secrets** — `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, DB URL in secure env only.
- [ ] **Health monitoring** — Alerts on webhook failures and job queue backlog.

## Known blockers (as of last audit)

| Item | Status | Action |
|------|--------|--------|
| Billing API on dev store | **Blocked** | Enable Shopify App Store distribution in Partners |
| Privacy policy URL | **Verify** | Add public policy before submission |
| Production deploy URL | **Verify** | Confirm hosting and SSL |
| Listing screenshots | **Missing** | Capture from polished UI |
| Demo store for reviewers | **Recommended** | Pre-seed manual collections + sold-out products |

## Reviewer notes (suggested)

Include in submission notes:

1. Install on a development store with manual collections.
2. Enable the app under **Settings**, then enable push-down on one or more manual collections under **Collections**.
3. Reduce inventory on a collection product to zero to trigger a move; check **Activity**.
4. For billing, use test mode or approve the test charge on the Pricing page.

---

*Generated for App Store review preparation. Update checkboxes as items are completed.*
