# Native verification and physical-device checklist

New native CI is build/test only and has contents:read permission. It never publishes releases, deploys Pages or uploads to app stores. Builds use `com.familycashbook.preview` and Family Cashbook Preview; Windows stores preview data separately. Do not use real family financial records for initial tests.

## Automated checks prepared

- Android: debug APK, emulator launch, synthetic initial setup, native Filesystem save, encryption, force-stop/reopen/unlock and screenshot.
- Windows: Electron synthetic data in an isolated workspace folder, native file save, encrypted close/reopen/unlock, screenshot and unsigned portable EXE build.
- iOS: unsigned simulator compile, install/launch and screenshot. This only verifies simulator build/startup; it does not test a physical iPhone, store billing or all lifecycle paths.

These jobs must run on the pushed head before any success is claimed. Download build/screenshot artifacts from the native-verify workflow after it passes. An unsigned simulator `.app` cannot be installed on a physical iPhone; Apple development/ad-hoc/TestFlight signing must be configured separately. No signing credentials are invented or activated here.

## On Windows, Android and iPhone

Record device/OS/build commit and pass/fail for each:

1. Use the preview app and synthetic opening balances. Verify separate storage from the production app.
2. Enter/save native transactions, close/force-stop during/after saving, reopen and confirm saved records. Retry disk/storage-full failures; verify unsaved-state messaging and recoverable export. iOS suspension and Android backgrounding require physical tests.
3. Enable working-ledger encryption, lock/reopen, verify correct and wrong passphrases and restore a disposable backup. Verify actual saved files are encrypted and earlier plaintext backups remain separately accounted for.
4. Create separate member keys on two devices. Compare fingerprints independently. Send encrypted files through WhatsApp/email using the native share sheet; save and import the attachment through file selection. Verify viewer denial, editor proposals, private accounts absent, cancellation, corrupt files, duplicate imports and revoked/stale-member denial.
5. Test USD/AED/EUR/JPY/KWD accounts as needed: source and received amounts, fees, explicit rates, native precision, remittance to an INR/NRE-labelled account, monthly reconciliation and INR valuation. Do not log remittance principal as income/expense again.
6. With merchant/store sandbox setup only, complete purchases, platform confirmation/background return, restore, cancellation, expiry/refund and offline signed-entitlement checks. Check actual localized price/renewal terms. The unconfigured preview must collect no payment.
7. Check mobile layout, keyboard, dark mode, file picker, share-sheet cancellation and accessibility.

Provide results without financial data, passphrases or private keys. Keep main and deployments unchanged until the results and remaining provider configuration are reviewed.
