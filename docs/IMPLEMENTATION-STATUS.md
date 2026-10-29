> Historical planning-stage document. The current file-based family/currency/billing continuation is described in [CONTINUATION-STATUS.md](CONTINUATION-STATUS.md), which supersedes the pending-feature statements below.

# Implementation status — 29 October 2026

This branch continues the recovered handover overlay on top of main e312982d52f8c12ff06ff048d0cb616564d0b9c9. The overlay was compared with that exact base; unchanged icons, manifests, workflows and platform sources were retained. No AGENTS.md was found in the repository or its applicable parent directories.

## Implemented locally

| Area | Behavior and evidence |
| --- | --- |
| Budget forecast | Actual activity plus remaining budget; single-bill mode, completion/reopening, uncapped overspending, actuals on another account, remaining plan rows in Transactions. Pure and real application-engine tests. |
| Month close | No automatic close on balance entry. Ordered close, actual-only per-account reconciliation, required review and reason for discrepancies, atomic audit/settings save, latest-month reopen audit. Planner/controller tests include offsetting differences and skipping denial. Device IDs are explicitly attribution, not authenticated people. |
| Durable saves | Awaited writes, visible save state, recoverable in-memory unsaved edits, explicit retry, corrupt-source editing block, temp/rename on native storage. Tests cover failed writes and acknowledgement timing. |
| Desktop close | Renderer acknowledgement waits for ready state, focused input blur, current tool operations and asynchronous saves. Main process prevents close until acknowledgement; failures veto close. Bridge tested with mocks; real Electron packaging is pending. |
| Restore | Validates size/schema/unsafe keys before mutation, recovery export cancellation aborts, unreadable source export, revision rebuild and removed-field tombstones. Tests cover corruption, cancellation and restored revisions. |
| Personal sync | Field/month and transfer-ID revisions, tombstones, deterministic ties, legacy revision seeding, logical timestamps after observed revisions, bounded durable conflict copies. Mocked Drive tests cover 412 retry and lost acknowledgements. |
| Drive safeguards | Always reads and merges remote, conditional PATCH only with an ETag, three race attempts, duplicate-file stop, local errors block sync, OAuth access tokens stay in memory. If the actual Drive endpoint does not expose/support the required precondition, upload stops instead of blindly overwriting. Real OAuth/Drive validation remains a release blocker. |
| Credit cards | Purchases are expenses, repayments are transfers, negative balance is debt, positive balance is an asset, cards excluded from liquid cash/minimum suggestions, explicitly linked manual card liabilities excluded from totals. Existing unlinked manual duplicates require user review. |
| Planning tools | Four primary tabs; guided setup in one batch; scenarios separate from base; savings goals/earmarks; loan prepayment estimates; contract rotations and manual FX conversion; date assumptions and daily per-account cash forecast. Daily forecast tests detect an EMI before salary despite a positive month end. |
| CSV | Preview/mapping/duplicate review, stable operation state and stable row IDs across partial failures/retries; quoted fields/dates/amount validation; formula-safe export. Controller test simulates a write that succeeded before its acknowledgement was lost. |
| Encryption | Optional AES-GCM working-ledger and new synced-copy encryption, PBKDF2 passphrase derivation, encrypted exports, unlock after opening and explicit lock/reload. Round-trip, wrong-passphrase, tamper, second-session unlock and lock tests. No biometrics, automatic idle lock, key reset or separate family key sharing. |
| Offline assets | New modules cached together; installed core is not refreshed piecemeal; new worker waits for old clients to close. Font bundling is path-safe on Windows and idempotent. |

## Pending — this is not a release approval

- **Secure family service:** no independent identities, invitations, owner/editor/viewer service authorization, private-account boundary, revocation or household key sharing is implemented. The personal adapter still gives the device owner full rights. See SERVICE-DESIGN.md. UI flags must not be represented as service security.
- **Billing:** Plans remains informational. No checkout, trials, provider entitlement validation, webhook processing, restore purchases, refund/expiry or offline grace integration is implemented or tested. No features are paywalled and existing users keep their data and exports.
- **Multi-currency ledger:** manual contract salary conversion only; no currency-denominated accounts, transaction FX history or valuation ledger.
- **Usability:** Simple/Advanced mode, recent transaction defaults, optional summaries/notifications and isolated demo ledger remain to be implemented.
- **Browser/device verification:** the first GitHub Actions run passed all 31 Node tests and the desktop/mobile-width Chromium flows, with six screenshots. Reviewing those screenshots found that the mobile daily-forecast table expanded the document beyond the viewport. This follow-up constrains grid tracks/panels and adds page-width assertions; those new assertions still need CI after pushing this follow-up. Real native device checks remain pending.
- **Native builds:** Android, iOS and Windows installers have not been built. Real filesystem rename, suspension/kill/recovery, Electron close and platform encryption support need device tests. iOS signing needs owner setup.
- **Sync limits:** first-time simultaneous Drive file creation can produce duplicates, which stop sync for recovery. A conditional write is only safe if the real provider honors it. Conflicts are bounded to 200 copies and may include sequential edits. Local conflict dismissals can reappear from another device; no distributed review tombstone is claimed.
- **Atomicity:** the standalone adapter supports atomic month/setup batches. Another host adapter without applyBatch will reject these actions rather than silently making partial audit/settings changes.
- **Access:** the owner pushed the prepared branch from authenticated PowerShell and opened draft PR #1. Codex attached and verified it; no merge or deployment occurred. Codex's connector/sandbox write limitation remains, so the local follow-up needs the same normal PowerShell push.

## Verification performed

- `node --test tests/*.test.cjs`: 31 passing tests, 0 failures, using synthetic records only.
- All shipped JavaScript and the inline app script compile; included in the tests.
- `node scripts/prepare-web.mjs`: succeeded with system-font fallback (font dependencies not installed locally).
- Browser script, desktop source/preload syntax and `git diff --check` checked separately before packaging.
- Initial CI browser flows **passed** at head 5e11ed709e9d480e51920fb05a23890ef8d49049: https://github.com/charlesjoserajcjr-Master/family-cashbook/actions/runs/40828240179 . The job logs report both desktop and mobile flows passed and six screenshots were uploaded. Artifact SHA256: 114a6b75f0588ff780387045042746babd767fb5164990c67393b78a3517b585. Browser checks at that head did not assert page width, so screenshot review exposed the overflow. The new page-width assertions are pending the follow-up push/CI. The verify workflow tests only and does not deploy.

Do not merge until browser/device/sync checks and the pending service scope have been reviewed explicitly. Main-push workflows can publish builds and Pages.
