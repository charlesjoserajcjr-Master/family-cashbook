# Proposed service boundary — not yet implemented

The current application is a personal offline ledger. It cannot securely create independent family identities by adding membership fields to its local JSON or by hiding accounts.

## Proposed next implementation

Use a dedicated authenticated service with PostgreSQL row-level security and Supabase Auth as the proposed identity host. This is a design selection for review, not a configured or deployed service. Before implementation, the owner must confirm the project, region, approved login methods and data-retention policy.

- Households have immutable IDs and membership records keyed by authenticated user subject, with owner/editor/viewer roles. Only an owner may invite or revoke members; owner transfer is transactional and cannot leave the household ownerless.
- Accounts have a visibility boundary. Private accounts, their entries, categories, balances, transfer details and aggregate results must be inaccessible at the database/API query boundary. A whole-ledger download is prohibited for a partially authorized member. Cross-boundary transfers require a redacted counterparty representation.
- Every request validates the provider token and server-side membership. Never trust a device ID, a role sent by the browser or a local paid flag. Anonymous and revoked clients must fail direct API queries, not just see fewer controls.
- Invitation tokens are random, hashed at rest, expiring and one-use, bound to the intended verified identity. Acceptance/revocation and their audit events are atomic.
- Service revisions use server transactions/compare-and-swap; client clock order is not the authority for cross-member edits. Idempotency keys cover requests whose acknowledgements are lost.
- Offline revocation cannot erase data already copied to an offline device. Explain this before sharing. Revoke server access immediately; on next contact clear cached keys/data for removed scopes and rotate shared keys. Offline writes after revocation are rejected with a recoverable local export, never silently uploaded.
- If household end-to-end encryption is required, design per-account content keys and authenticated per-member key wrapping, recovery and rotation before sharing. The current single-passphrase working-ledger feature is not that design.

## Billing integration boundary

Choose the owner's merchant provider for web and a store-compliant product/receipt route for Android/iOS; do not insert an unapproved web checkout into native builds. A possible web adapter is Razorpay, but no merchant integration or prices are activated here.

Purchases belong to authenticated households on the service. The server validates receipts/provider state, stores provider-event IDs under unique constraints, processes duplicate/out-of-order webhooks idempotently and derives entitlement state from authoritative subscription periods. Cancellations preserve paid access through its verified end; refunds/revocations and purchase ownership changes need explicit rules. Restore purchases revalidates with the provider, rather than copying device state.

Clients may cache short-lived signed entitlements with a documented, bounded offline grace period. Public verification keys can ship in clients; signing keys and merchant secrets cannot. Basic records and export stay accessible after expiry, refunds or cancellation. Existing users are grandfathered into the current feature set until the owner chooses and communicates a migration policy. No gates are implemented in this branch.

## Concrete owner setup needed

- A service project and region, approved Auth sign-in methods, callback domains and a secure secret store; test accounts for owner/editor/viewer and revoked-member scenarios.
- Web merchant sandbox account/provider selection, product identifiers, approved prices/trial/refund policy and webhook endpoint ownership.
- Android package/store products and test track, Apple bundle/store products and sandbox testers, signing credentials stored in the platform/CI secret store.
- Google OAuth client IDs and approved redirect origins for personal Drive sync testing.
- Decision on cache retention, key recovery and offline grace before service implementation.

Provide public project/product IDs and decisions through the implementation process; enter private keys directly into the provider or CI secret store, not chat or the repository.

Required acceptance tests include direct unauthorized read/write denial, private-account inference/leakage, viewer write denial, invitation replay, revoked/offline member behavior, key rotation, trial/active/cancelled/refunded/expired/restore states, duplicate/out-of-order webhooks and offline-grace expiry. These tests and integrations remain pending.
