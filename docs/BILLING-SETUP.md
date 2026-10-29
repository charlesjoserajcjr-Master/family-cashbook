# Billing setup — purchases remain disabled

No merchant, RevenueCat or app-store accounts are configured. The code is an integration to prepare/test, not evidence of a live validated purchase. Do not enable live billing or deploy the service until explicitly authorized.

## Owner account setup

- Create the web merchant account and sandbox monthly/annual subscription products in Razorpay. Decide final prices, renewal disclosure, refunds, trials and support policy. Current example prices are proposals; the app must show the actual provider/store price.
- Create RevenueCat and the Apple/Google store apps/products. Connect the store credentials directly in their dashboards. Map recurring products to the `plus` entitlement and configure trial offers in the stores. Use store sandbox testers/test tracks; a JavaScript `sandbox` label alone does not make a native store purchase a test.
- Public product/app IDs may be supplied through configuration. Keep merchant secrets, signing private keys and store credentials in the service/CI secret store, never the client, repository, chat or logs.

## Service

Node 22.13+ is required (`node:sqlite`). `node server/index.cjs` binds to loopback only; a production-like sandbox host requires HTTPS, persistence, monitoring/backups and explicitly allowed app origins. The service receives identity fingerprints/purchase metadata, never ledger balances or financial entries.

| Environment variable | Purpose |
| --- | --- |
| BILLING_MODE | sandbox by default; live is a separate reviewed configuration |
| BILLING_DATA_DIR | Private durable SQLite directory; keep sandbox/live databases separate |
| BILLING_ALLOWED_ORIGINS | Comma-separated exact browser/native origins; no wildcard |
| BILLING_SIGNING_KEY | ECDSA P-256 PKCS8 PEM supplied through the secret store |
| RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET | Matching sandbox merchant credentials |
| RAZORPAY_MONTHLY_PLAN / RAZORPAY_ANNUAL_PLAN | Actual provider subscription plan IDs |
| RAZORPAY_WEBHOOK_SECRET | Raw-body HMAC validation secret |
| REVENUECAT_SECRET_KEY | Server API validation key |
| REVENUECAT_ENTITLEMENT | plus by default; match configured entitlement |
| REVENUECAT_WEBHOOK_AUTH | Exact configured Authorization value; required |
| REVENUECAT_WEBHOOK_SIGNING_SECRET | Optional stronger timestamped HMAC verification; configure if enabled in the dashboard |

`node server/create-signing-key.cjs` creates private/public files in ignored server/data and refuses to overwrite existing keys. It never prints private material. Move the private key directly to the deployment secret store; only the public JWK belongs in app configuration. Back it up securely and plan key rotation before production.

Webhook endpoints are `/webhooks/razorpay` and `/webhooks/revenuecat`. Each verifies the raw provider request, validates ownership and refreshes authoritative provider state. Event IDs are durable/idempotent. A full Razorpay refund revokes that subscription conservatively and remains revoked until support reconciles it or a new subscription is used; do not automatically re-grant based on a stale active subscription status. Lost checkout acknowledgements stop retries for reconciliation rather than creating another charge.

Owner login uses a single-use challenge signed by the unlocked family-owner key. The service registers an owner only after proof; knowing a public fingerprint is insufficient. The same recovered owner key proves cross-device ownership. Losing the key requires verified support recovery; a new local paid flag or device ID cannot claim another owner's purchases.

## Client

`www/config.js` billing settings remain blank and purchasesEnabled=false. After approved sandbox setup, enter the sandbox service HTTPS URL, public entitlement JWK and RevenueCat public app keys. PurchasesEnabled is an explicit rollout switch; it is not an entitlement. Native products/prices come from the store SDK. Web checkout subscriptions are created by the server from an allowlisted plan, not client-supplied amounts.

The client verifies signed entitlement identity, environment and time. Offline cached Plus access needs verification within 72 hours and cannot exceed paid-through time. Offline revocation is bounded by that cache window, not instantaneous. No existing record/export or tool is gated during this migration.

## Acceptance before activation

Run actual sandbox purchase, trial, renewal, cancelled-but-paid-through, expiry, refund, restore on a second device, duplicate/out-of-order webhook, provider outage, uncertain checkout acknowledgement and offline-expiry tests. Check simultaneous purchases/devices and operational support recovery. Local tests mock provider APIs and cannot replace those checks. Physical store restoration also needs correctly configured RevenueCat transfer/restore policy and authentic store test receipts.

References: https://razorpay.com/docs/webhooks/validate-test/ ; https://razorpay.com/docs/api/payments/subscriptions/create-subscription/ ; https://www.revenuecat.com/docs/integrations/webhooks ; https://www.revenuecat.com/docs/getting-started/installation/capacitor .
