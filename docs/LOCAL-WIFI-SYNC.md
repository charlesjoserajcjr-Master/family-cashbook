# Local Wi-Fi pairing and personal-device sync (preview)

## What the user does

1. Install matching updated Windows and Android/iPhone builds. Keep the original backup. Browser previews cannot host or use the native local socket bridge.
2. Restore/set up the ledger on the laptop. The first phone copy must be empty; an unrelated existing phone ledger is refused instead of silently merged.
3. Open **Phone & laptop sync** on both devices. Protect each device with its own PIN. Pairing keys and saved financial records are encrypted on each device.
4. Laptop: **Connect phone · show QR**. Phone: **Scan laptop QR**. Allow camera permission. On iPhone, also allow Local Network access.
5. Compare the six-digit code on the devices. Approve on the laptop, then finish pairing on the phone. No financial records transfer during pairing.
6. Phone: **Sync now**. The first sync copies the laptop ledger to the phone. Enter transactions offline on either device; open both apps on the same private Wi-Fi and tap **Sync now** on the phone to merge them.
7. After restarting the laptop app, unlock it and select **Allow paired phones to sync**. The listener is deliberately off until explicitly enabled. Keep the laptop awake and both apps unlocked.

No Google OAuth, internet connection, hosted relay, router setup, UPnP or port forwarding is used. Windows Firewall may require allowing the installed app on **private networks**. Guest/client-isolated Wi-Fi and VPN routing can prevent connection. The listener uses TCP 49152; if another program owns it, stop that listener before retrying. When the laptop's IP changes, scan a new QR and approve again. Remove old pairings on the laptop afterwards.

A paired phone has full owner access to this personal ledger. Family ledgers with scoped editors/viewers must continue using signed family-file exchange. Google Drive must be disconnected before local sync; concurrent cloud and LAN transports are refused. Android QR scanning requires Android 8/API 26 or later. The existing Capacitor target SDK is 36; before upgrading to 37, implement Android's ACCESS_LOCAL_NETWORK runtime permission flow.

## Security design

This is a new protocol implementation using standard WebCrypto primitives, not a security certification or an independently audited protocol.

- One-use QR pairing capability: 256 random bits, opaque 128-bit invitation ID, private IPv4 endpoint and two-minute lifetime. It contains no financial records or ledger passphrase. Treat the displayed QR as a temporary secret. It is consumed after a valid authenticated request and before asking for approval.
- Every request begins with a fresh P-256 ECDH server challenge, including a 256-bit nonce, bound to the invitation or paired device ID. Challenges expire after 45 seconds and are consumed once. There are at most 16 pending challenges. Ephemeral private keys remain in the renderer's memory and are discarded when consumed/stopped.
- HKDF-SHA256 derives an AES-256-GCM key from the ECDH result, salted with the pairing capability or a dedicated 256-bit paired-device secret. Context binds protocol version, ID, challenge nonce and both public keys. Authenticated additional data distinguishes phone-to-laptop from laptop-to-phone messages. Fresh 96-bit IVs protect requests and responses; reflected, changed and replayed packets are rejected.
- Both screens display a six-digit digest of the authenticated key and transcript. Host approval writes a fresh random paired-device secret, returned only in the encrypted response. Phone confirmation is required before storing it. No financial snapshot is included in the pairing response. A cancelled/lost response may leave an unused host pairing, removable in the device list.
- Pairing IDs/secrets, ledger binding and last-sync information live in a separate encrypted device vault using the existing PBKDF2/AES-GCM ledger passphrase protection. They are not exported in financial backups. Each device can use a different passphrase. Restore deletes the local pairing vault and stops the listener, requiring new pairing.
- Native transport accepts only canonical RFC1918 IPv4 literals, ports 1024–65535 and two fixed routes. It has no DNS resolution, redirects, cookies, static-file service or website access. Network metadata (IP addresses, lengths and timing) is visible. Financial payloads and names are application-encrypted before entering the native bridge or Electron main process.
- Android uses a narrow socket plugin; iOS uses Network.framework. No global Android cleartext setting or iOS ATS exception is enabled. Camera and local-network purpose strings are generated at the iOS plist root. HTTPS handling for other services is unchanged.
- Electron's relay opens only on explicit user action, checks the main-frame IPC sender, denies website Origin headers and non-private remote addresses, caps connections/pending requests/body sizes, rate-limits requests, and closes pending exchanges on Stop, reload or application shutdown. It never handles financial plaintext or pairing keys. A network attacker can still interrupt service; encryption does not prevent denial of service.
- Incoming snapshots go through the ledger schema, encryption/unlock/Drive/family guards and existing field-revision merge. Stable transaction IDs, tombstones and conflict history are retained. The phone retries another round when edits arrived during the transfer, and asks for another tap if continuous edits prevent convergence. Save errors remain visible; an unsuccessful transfer never means the source edits should be deleted.
- Device removal prevents future authenticated transfers. It cannot erase records already copied or stop a compromised unlocked device from reading its existing records. OS compromise, screenshots and an attacker controlling the app process are outside this transport's protection. Passphrases and device backup hygiene remain necessary.

## Verification

Automated tests exercise real WebCrypto, real localhost HTTP, an actual QR image decode, two isolated browser profiles with only the OS bridges simulated, matching approvals, empty-phone bootstrap, two-way offline entries, retry convergence, encryption at rest, replay/tamper/wrong-secret rejection, expired challenges/QRs, cancellation, device removal, unrelated-ledger refusal, restore invalidation and native project generation. Existing web/family/Drive/native-shaped onboarding/restore browser regressions are included.

GitHub native verification additionally compiles Android and iOS and smoke-tests Windows Electron with the relay packaged. Physical Android camera/network behavior, Windows firewall prompts and a signed iPhone/TestFlight build remain release gates. Do not claim these were verified by browser simulations. An independent protocol/security review is required before marketing this as audited financial software.

## Physical smoke test

Use synthetic records first. Install matching native preview builds and follow the user steps above. Verify code mismatch/rejection shares nothing; allow the matching code and sync. Add a distinct entry on each device offline; reconnect and sync twice, checking there are exactly two entries. Reopen both apps and unlock; allow the laptop listener and sync again. Deny/re-enable iPhone Local Network access and camera permission to check recovery guidance. Remove the phone on the laptop; sync must fail while existing copies remain intact. Restore a backup on the laptop; the old phone pairing must fail. Repeat on both Android and a physical signed iPhone build before release.

References: [Android local-network permission](https://developer.android.com/privacy-and-security/local-network-permission), [Apple local-network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), [OWASP MASVS](https://mas.owasp.org/MASVS/).
