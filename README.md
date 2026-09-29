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

## Where the data lives (this version)

Everything is stored **only on the phone**, in one file private to the app. Nothing is sent anywhere.
Use **Accounts & setup → Save a backup** regularly (e.g. to Google Drive). Family sharing with sign-in
comes in a later version: `www/local-store.js` is the only file that changes for that.

## What is in here

| Path | What it is |
| --- | --- |
| `www/index.html` | The app: screens, forecast calculations, charts |
| `www/local-store.js` | On-phone storage and backup/restore (replaced by cloud sync later) |
| `assets/` | App icon and splash screen (placeholders, replace with final artwork) |
| `capacitor.config.json` | App name and ID `com.familycashbook.app`. **Never change the ID after publishing** |
| `scripts/` | Build helpers: bundle fonts, set version and signing |
| `.github/workflows/` | Android build, upload-key creator, iPhone check build |

Never put real financial data or backup files in this repository.
