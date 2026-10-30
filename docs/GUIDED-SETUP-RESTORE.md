# Guided setup and backup restore

This follow-up adds Restore a backup and User manual to the welcome screen. More > Setup guide & user manual and a Home continuation banner make setup resumable. Fresh setup uses two pages (first account, then monthly income/spending); the remaining review sequence is accounts, plan, first transaction, backup and optional tools. Progress stays on this device and never changes financial records merely by checking a step.

The restore picker accepts any filename extension and checks the file contents, avoiding mobile file-provider MIME filtering. Plain Family Cashbook backups do not need a passphrase. Encrypted backups are detected and ask for their original passphrase. Review shows counts and dates before replacement. Legacy raw maps and UTF-8 BOM are supported without changing financial values. Installers, ZIPs, statements, malformed records and future formats are rejected.

Inspection is read-only. The original backup is not edited. Replacement requires explicit acknowledgement and confirmation, with a distinct recovery-before-restore filename for an existing working copy. Cancelling desktop recovery save aborts restore. Guided restore requires personal Drive to be disconnected first. An encrypted backup restored onto a fresh device keeps the working copy encrypted; an existing working-ledger passphrase remains in use.

A locally found older backup was recognized as plain JSON with six accounts and 35 categories; only structural metadata was inspected, with zero writes. No private backup was added to this repository or test fixtures. Screenshots/tests use synthetic records.

The offline manual covers setup, restore, daily entries, plans versus actuals, cards/transfers, monthly review, backups/encryption, loan estimates, goals, scenarios, currencies, personal sync, family sharing and troubleshooting. www/user-guide.html can print/save as PDF in a browser. A standalone printable copy is supplied separately in outputs.

New native artifacts are required for the installed Windows/Android previews. A browser preview uses the changed files after a hard reload. Earlier downloaded artifacts do not update automatically. Keep the original backup unchanged; do not invent a passphrase for a plain backup.

No merge, deployment, public release, Google OAuth or billing activation is part of this follow-up. Native build/OS file-picker behavior must be checked on the new PR artifacts.
