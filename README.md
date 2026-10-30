# Family Cashbook

Plan, track and forecast a family's money in one app: bank accounts and minimum balances, monthly income and
expenses, loans and EMIs, transfers between accounts, and businesses (a rental, villa, shop or farm) tracked on
their own. Family members log what actually happened; the forecast updates from their entries.

GitHub builds the app for you. No Mac is needed, not even for iPhone.

## First time: Android test app (about 15 minutes)

1. Push or upload these files to the `main` branch of this repository.
2. Open the **Actions** tab. "Build Android app" starts by itself and takes about 8–12 minutes.
   A green tick means done; a red cross means send a screenshot of the failed step.
3. **Install on your phone**: open the repository on your phone, tap **Releases** → *Test build N* → the `.apk`.
   Allow "Install unknown apps" for your browser when Android asks.
4. In the app, open **Accounts & setup → Restore from a backup** to load your data from a backup file.

## Before Google Play: create your upload key (once)

1. **Settings → Secrets and variables → Actions → New repository secret**: name `KEYSTORE_PASSWORD`,
   value: a strong password (at least 8 characters). **Write it down.**
2. **Actions → Create upload key (run once) → Run workflow.**
3. Open the finished run and download **upload-key-DOWNLOAD-AND-KEEP-SAFE** (deleted after 1 day).
   Keep `familycashbook-upload.jks` and the password in two safe places. Losing it means you cannot update the app.
4. Add a second secret: name `ANDROID_KEYSTORE_BASE64`, value: the whole text of `familycashbook-upload-key-base64.txt`.
5. **Actions → Build Android app → Run workflow.** This build also makes `Family-Cashbook-N.aab`
   (in the run's *Artifacts* zip). That `.aab` is what you upload to Google Play.

## iPhone

**Actions → Build iPhone app (check) → Run workflow** compiles the iPhone app on a Mac that GitHub rents out.
Run it by hand only: Mac minutes use the free GitHub allowance about 10x faster.
App Store signing and upload get added once the Apple Developer account (paid yearly) is set up.

## Windows desktop app (fully offline)

Windows builds are manual (**Actions → Build Windows desktop app → Run workflow**). Leave **publish** off for build-only checks; publishing requires an explicit main-branch run with **publish** enabled.
On the **Releases** page, open the newest *Windows desktop app* and download
`Family-Cashbook-Setup-….exe` (installs with Start-menu and desktop shortcuts) or the Portable `.exe`
(runs without installing, e.g. from a USB stick). It needs no internet at all. The ledger is saved as
`Documents\Family Cashbook\family-cashbook-data.json`, with a dated copy in `Backups` every day;
**Accounts & setup → Change folder…** can move it (e.g. into a Google Drive or OneDrive folder).
Windows may show "Windows protected your PC" because the app isn't code-signed: click **More info → Run anyway**.

## Where the data lives

Each device keeps a working copy, so the app works offline. With **Google Drive sync** on, the ledger is
also saved in *your own* Google Drive as `Family Cashbook data.json`, and every device signed in to the same
Google account (phone, tablet, laptop) uses the same ledger. The app can only see files it created itself
(Google's `drive.file` permission). Nothing is stored anywhere else. Edits merge item by item: the latest
change to each item wins.

## Turn on Google Drive sync (once, about 30 minutes)

**A. Put the web app online (for laptop and tablet browsers)**
1. Repository **Settings → General → Danger Zone → Change visibility → Public**.
   Only the app's code becomes public; your data is never in this repository.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Actions → Publish web app → Run workflow.** The app appears at
   `https://charlesjoserajcjr-master.github.io/family-cashbook/`

**B. Create the Google sign-in (Google Cloud Console, free)**
1. Go to <https://console.cloud.google.com>, create a project named **Family Cashbook**.
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **Google Auth Platform → Branding**: app name *Family Cashbook*, your email as support and developer contact.
   **Audience**: *External*; while testing, add your own Gmail address under **Test users**.
   **Data access → Add or remove scopes**: add `.../auth/drive.file`.
4. **Clients → Create client → Web application.** Name *Family Cashbook web*.
   Under **Authorized JavaScript origins** add `https://charlesjoserajcjr-master.github.io`. Create, and copy the
   **Client ID** (ends in `.apps.googleusercontent.com`).
5. Put that Client ID in `www/config.js` as `googleWebClientId` (or send it to Claude to do it).

**C. Allow the Android app to sign in** (needs the upload key from "Before Google Play" above)
1. Run **Build Android app**. On the finished run's summary page, copy the **SHA-1 for Google sign-in**.
2. Google Cloud **Clients → Create client → Android**: package name `com.familycashbook.app`, paste the SHA-1.
3. After you upload to Google Play, also add the **App signing key SHA-1** from Play Console
   (*Test and release → App integrity*) as a second Android client, or Play Store installs cannot sign in.

In the app: **Accounts & setup → Google Drive sync → Connect Google Drive**. On a new device, choose
**Load my ledger from Google Drive**.

While the Google project is in *Testing*, only the test users you listed can sign in, which is right for
personal use. Before a public Play Store / App Store release, set the audience to *In production*.

## What is in here

| Path | What it is |
| --- | --- |
| `www/index.html` | The app: screens, forecast calculations, charts |
| `www/local-store.js` | On-device storage, Google Drive sync and backup/restore |
| `www/config.js` | Google sign-in client IDs (public, no secrets) |
| `assets/` | App icon and splash screen (placeholders, replace with final artwork) |
| `capacitor.config.json` | App name and ID `com.familycashbook.app`. **Never change the ID after publishing** |
| `scripts/` | Build helpers: bundle fonts, set version and signing |
| `desktop/` | Windows desktop app (Electron): window, data file, daily backups |
| `.github/workflows/` | Android build, upload-key creator, iPhone check build, web app publishing |

Never put real financial data or backup files in this repository.

## Continuing the planning/reliability draft

This branch is an implementation draft. Read [docs/IMPLEMENTATION-STATUS.md](docs/IMPLEMENTATION-STATUS.md) for completed work, exact test evidence and release blockers; [docs/MIGRATION.md](docs/MIGRATION.md) before using a copied ledger; and [docs/SERVICE-DESIGN.md](docs/SERVICE-DESIGN.md) for the proposed authenticated family/billing boundary.

With Node 22+:

```sh
npm install
npm test
npm run prepare-web
npx playwright install chromium
npm run test:browser
```

`npm test` uses synthetic records and needs no merchant credentials. Browser checks produce images in `test-artifacts/`. Native release builds and real Drive OAuth/conditional writes need separate validation. The added `verify.yml` workflow runs on pull requests and does not publish an app.

Working-ledger encryption is optional and uses an unrecoverable passphrase. Earlier plaintext backups remain plaintext. Lock is manual; independent family identities, private-account authorization, full multi-currency and real purchase validation are not implemented by this draft. Do not describe the Plans preview or device IDs as those features.


## Family files, currency and purchase integration

Read [CONTINUATION-STATUS.md](docs/CONTINUATION-STATUS.md) for the current implementation scope and validation limits, [FAMILY-FILES.md](docs/FAMILY-FILES.md) for the owner/member workflow, [BILLING-SETUP.md](docs/BILLING-SETUP.md) for merchant/store setup, and [NATIVE-VERIFICATION.md](docs/NATIVE-VERIFICATION.md) for preview builds and physical-device checks.

Use `npm ci`, `npm test`, `npm run prepare-web`, and `npm run test:browser`. The new native CI jobs build isolated previews and do not publish. Billing is disabled until actual provider settings and approved products are configured. INR is the reporting currency; foreign accounts keep their native amounts in the Currency workspace.

## Personal phone companion

See [Phone quick entry and laptop sync](docs/PHONE-SYNC.md) for encrypted pairing, offline entry, OAuth setup and current browser/native limits. Google OAuth remains unconfigured.

## Merge and publishing are separate

Merging to main does not deploy Pages or publish Android/Windows releases. Publishing workflows are manual-only and require the publish switch on the main branch. PR checks remain build/test only. Keep publishing off until physical-device and provider setup checks are complete.

## Guided setup and user manual

The welcome screen can restore a plain or encrypted backup. Plain older Family Cashbook backups need no passphrase. More > Setup guide & user manual walks through the essential setup steps; www/user-guide.html is the offline printable manual. See docs/GUIDED-SETUP-RESTORE.md.
