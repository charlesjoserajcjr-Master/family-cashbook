# Data protection

Every ledger is encrypted on the device. There is no plain mode for new users.

- **Ledger key:** a random 25-character recovery code (about 125 bits). A ledger that already used a passphrase keeps that passphrase.
- **PIN:** 6 to 8 digits. It only opens the ledger key on this device. It is never in a backup.
- **Device key:** on Android the PIN is combined with a secret sealed by the Android Keystore. On Windows the secret is sealed by Electron `safeStorage`. A copy of the app's files then has nothing to guess a PIN against. The web preview and iPhone do not have this yet, so there a copied lock file could be guessed offline.
- **Wrong PINs:** after five wrong tries there is a wait, starting at 30 seconds and rising to 15 minutes. The recovery code still works during a wait. Records are never erased.
- **Backups:** sealed with the ledger key and marked with the code ID, also shown in the file name and on the Privacy screen. A new recovery code does not change older backups.
- **Auto-lock:** default one minute after leaving the app, and after 10 idle minutes on a computer. Share sheets, the QR scanner, file pickers and a running Wi-Fi listener do not trigger it.
- **Android:** `allowBackup` is off, so records stay out of Google device backup. Release builds block screenshots and recent-apps previews. Preview builds allow them for testing. Files made for the share sheet are deleted when it closes.

Not yet done: fingerprint unlock, the device key on iPhone, and screen protection on iPhone and Windows.

Tests: `tests/lock.test.cjs` and `tests/lock-browser.cjs`. Browser tests that exercise other features set `CASHBOOK_TEST_SKIP_PIN`, which only skips the prompt and never opens encrypted data.
