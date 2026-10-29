# Encrypted family files

Use a preview installation or backed-up copy for initial tests. Enable working-ledger encryption first; each member's signing/encryption private keys are additionally protected by their own member-key passphrase. No shared Google password or shared ledger passphrase is needed.

## Pair and send

1. Start the owner's ledger, enable working-ledger encryption in Privacy, then open More → Encrypted family file sync. Create the owner's member key with a separate passphrase. Disconnect personal Drive sync, then create the family ledger as owner.
2. Each recipient starts their own preview ledger, enables working-ledger encryption, creates their own member key and chooses Share my invitation request. Send that public-key request using WhatsApp/email or save/attach the JSON file. This request contains public keys and a name, not private keys or balances.
3. The owner verifies the recipient's complete fingerprint through an independent trusted channel, opens their request file, chooses viewer or editor and selects exactly the accounts to share. Foreign accounts are identified by currency. Do not assume the name in an attachment proves who sent it.
4. Share latest file produces an encrypted, signed attachment for that member only. On Android/iOS the share sheet lets the user select WhatsApp, email or another installed app. Windows saves an attachment for sending manually. No messaging account is accessed by the application.
5. The recipient saves the attachment, opens Receive a family file, enters the independently verified owner fingerprint and reviews the replacement. A recovery export is offered before replacing that device's ledger. The shared view contains only selected accounts. Crossing transfers and private totals are omitted; it may not reconcile independently.

## Propose and accept edits

Editors can modify existing shared category plans and open-period entries, balances, transfers and permitted currency records. Account definitions, rate history and global settings remain owner-controlled. Viewers cannot submit proposals. The receiving owner independently rejects a hostile client attempting unauthorized edits, even if its file is correctly signed by a viewer/member key.

An editor chooses Share my proposed changes and sends the encrypted file back to the owner. The owner opens it, reviews the before/proposed values and accepts it. Acceptance revalidates against the current roster and current ledger. Conflict paths stop the whole acceptance; share a fresh owner snapshot and reapply the intended edits. Stable IDs and packet receipts prevent reapplying accepted proposals.

One owner profile is the authoritative ledger. Do not edit independent owner copies concurrently. Personal Drive sync is disabled in family-file mode to keep it from rolling back the roster.

## Revocation and recovery

Remove member deletes their grant and rotates the membership epoch. Previously issued files remain readable by their intended recipient. No offline system can erase copied plaintext or old keys. Removed members receive no new encrypted files and the owner refuses their pending edits. Other editors must receive a refreshed owner file before returning more proposals.

Restoring an owner backup clears all grants. Verify and invite members again; old proposals are not silently reauthorized. If a recovered owner starts sequence numbers again, the member can explicitly select Re-pair after owner recovery and verify the same owner fingerprint before accepting a fresh file. Export unsent proposals first. A changed owner key needs a new independently verified pairing; it is never silently trusted.

Keep encrypted ledger backups and both passphrases separately. The full owner backup includes encrypted member-key vault material and is sensitive. Private keys are not sent in family attachments. A lost owner key cannot be reset by this file protocol; recover its encrypted vault or establish a new owner identity and re-pair. If an owner key/device is compromised, rotating member grants alone is insufficient; replace the owner identity and verify it with every recipient.

Shared snapshots are limited to approximately 9 MB of selected records so the recipient can keep its local change baseline within the ledger's storage bound. This is manual file exchange, not automatic WhatsApp/email inbox synchronization, delivery verification or real-time consensus.
