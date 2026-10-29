# Phone quick entry and laptop sync

Implementation draft. Google OAuth IDs remain blank. Live Google sync is not active. Nothing has been deployed.

## Workflow

Home > Quick transaction saves an amount, account, category, date and note locally before uploading. More > Phone & laptop sync shows the Google account, last successful sync and pending uploads. The header opens these controls too.

A new phone can encrypt its empty saved copy with the desktop's exact passphrase, then load the encrypted cloud ledger. Do not create a separate ledger on the phone. Personal sync requires encryption. Earlier plaintext cloud records are merged and rewritten encrypted on successful sync; earlier backups remain unchanged.

Transactions retain their IDs across failed-save and upload retries. Offline entries survive reopening. Concurrent edits merge by record/field; conflicting values appear in Sync history. The connection remembers the Google account identity and stops an unexpected account change before cloud access.

Sync runs while the app is open and online, on foreground/online events and periodically. Reopening or expired authorization may require a tap on Sync now. Background sync does not open a sign-in dialog. No sync is guaranteed while the app is closed. Keep the app open until sync completes.

## Setup required

1. Create a Google Cloud project. Enable Google Drive API, configure OAuth consent and add the intended Google account as a test user.
2. Create a Web OAuth client for the exact browser origins. The local preview origin is http://127.0.0.1:8080. A phone needs an approved HTTPS web origin or a native build; its localhost is not the laptop. Hosting requires separate approval.
3. Set the public googleWebClientId in www/config.js. Do not include private credentials. Use the same project across devices so drive.file access sees the same app-created ledger.
4. Native Android also needs a client matching the preview package and signing-certificate SHA-1. Preview and production identities differ. The existing native persistence check still needs fixing and real-device validation.
5. Native iPhone needs the matching iOS client, googleIosClientId, SocialLogin Google URL scheme configuration and Apple signing for physical installation.

## First pairing

Keep an untouched backup and use a disposable copy. On the laptop browser, open Phone & laptop sync, enable encryption with a passphrase of 12+ characters, connect the right Google account and wait for success. On the new phone, open the same controls from the welcome screen, enter the exact same passphrase and connect the same Google account. Wait for accounts/categories to load before entering records.

Save one synthetic transaction offline, reopen/unlock, go online and sync. Sync the laptop and confirm exactly one matching transaction. Repeat with concurrent offline edits, wrong passphrase, cancelled sign-in and interrupted upload. Review Sync history.

## Limits

Use the laptop browser for this Google sign-in path. The Windows EXE blocks web OAuth popups; its installed-app sign-in flow is separate work and this connection is explicitly disabled there. A Drive desktop folder is not equivalent to the app's conditional merge protocol.

Family ledgers keep using signed attachment exchange. Personal sync rejects local and remote family rosters to preserve one authoritative membership history.

Automated tests use mocked Google endpoints and synthetic records. Real consent, Drive conditional writes and physical-device persistence remain unverified until OAuth setup. No claim is made that live sync is activated.
