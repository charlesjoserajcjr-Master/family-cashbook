/* Guided setup and recovery. Progress stays on this device; it never changes ledger records. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CashbookGuide = api;
})(globalThis, (root) => {
  "use strict";
  const manualHTML = `<h1>ReadyTrove Family Money — setup &amp; user guide</h1><p>Start small: restore your old ledger or add one account, review your monthly plan, record one transaction, then make a backup. Advanced tools are optional. This is a preview build; payments are disabled and Google sync still needs configuration and live testing.</p>
<h2>1. Start or restore</h2><p>On the welcome screen choose <b>Restore a backup</b> or <b>Start a new ledger</b>. A normal old Family Cashbook JSON backup needs <b>no passphrase</b>. Select the original file, read the record summary, then confirm replacement. Only encrypted backups ask for their original passphrase. A ZIP, APK, EXE, image or bank-statement CSV is not a full backup.</p><p>The current device copy is offered as a recovery export before replacement. On Android, finish the share/save step; on Windows, save the recovery file. Cancelling that save cancels a desktop restore. Verify that recovery copies were kept. Restore replaces this device's ledger; connected copies can change on later sync. Keep the original backup untouched and disconnect Drive before testing an old copy.</p>
<h2>2. Review accounts and opening balances</h2><p>Open <b>More → Accounts &amp; backup</b>. Add each bank/cash account with its balance at the start of the plan. Keep the plan start month consistent with those balances. Add credit cards with negative opening balances for debt; a positive card balance is a credit. Imported accounts remain in INR; do not relabel their past amounts as a different currency.</p>
<h2>3. Build the monthly plan</h2><p>Open <b>Plan</b>. Add income and spending categories and assign their usual account. A <b>Budget</b> retains the expected unspent remainder after partial spending. A <b>Single bill</b> uses the recorded actual instead of adding another full forecast bill. Mark a category complete if nothing else is expected that month. Home forecasts include planned future activity; recorded cash uses entered transactions, not a live bank feed.</p>
<h2>4. Record everyday transactions</h2><p>Tap <b>Quick transaction</b> on Home or <b>+ Transaction</b> in Transactions. Choose money out or money in, category, amount, date, account and optional note. One-off miscellaneous entries need a description. Wait for a saved acknowledgement. A failed save is not a confirmed entry: retry and check the list. Edit the existing transaction when correcting it.</p><p>Use a <b>Transfer</b> for movement between your own accounts and for credit-card repayments. A transfer is not new income or spending. Card purchases are expenses. Statement import is under More; preview supported CSV rows, assign categories and review duplicates before importing. A statement CSV cannot restore a ledger.</p>
<h2>5. Review and close a month</h2><p>Open <b>More → Monthly review</b>. Enter the actual statement balance for every account, compare with recorded activity and explain differences. Differences on two accounts can offset while still needing correction. Review currency reconciliations too if used. Close the earliest open month only after checking every account; closed periods reject edits. Reopening is a deliberate review action.</p>
<h2>6. Protect your records</h2><p>Use <b>Accounts &amp; backup → Save a backup</b>. Keep a copy away from the device and check that it opens in backup review. Under <b>Privacy &amp; encrypted backups</b>, you may enable working-ledger encryption with a long passphrase. Keep the passphrase separately; ReadyTrove cannot reset it. Plain old backups remain plaintext. Lock before sharing a device, and unlock after reopening. Avoid clearing browser data or uninstalling before exporting.</p>
<h2>7. Loans, goals, scenarios and net worth</h2><p><b>Loans &amp; EMIs</b> uses statement principal, date, annual rate and monthly payment. <b>Loan prepayment</b> compares estimates without changing your loan or plan. It excludes lender fees and future rate changes. <b>Savings goals</b> earmark existing money; earmarks are not extra assets. <b>What-if scenarios</b> compare temporary changes without changing the main plan. <b>Net worth</b> combines assets and liabilities; avoid adding a card liability twice. Business planning and legacy loan tools retain INR semantics.</p>
<h2>8. Foreign accounts and remittances</h2><p>Open <b>Multi-currency accounts &amp; remittances</b>. Create an account in its native currency, enter an opening balance and explicit INR valuation rate, then record native-currency income/expense. Keep the original transaction rate for history. For remittances, enter the source principal, source fee and actual received amount. Principal is a transfer; fees are separate. Do not also record principal as income/expense. Review native balances monthly. There is no live FX feed, NRE/NRO eligibility decision or tax calculation.</p>
<h2>9. Phone and laptop sync</h2><p>Quick entry works locally offline. <b>Phone &amp; laptop sync</b> needs configured Google OAuth before real account use. After setup, connect the laptop first, wait for success, then pair a new phone with the same Google account and ledger passphrase. Do not start a second ledger on the phone. Open the app online and tap Sync now if requested. Saved here and synced are different states. Windows EXE Google sign-in remains separate work; the laptop browser is the supported sign-in path. Review simultaneous edits in Sync history.</p>
<h2>10. Encrypted family file sharing</h2><p>Create separate member keys, compare fingerprints independently and grant only needed accounts. Viewers cannot propose edits; editors return signed proposals which the owner reviews. Send encrypted attachments through WhatsApp/email and import the saved file on the other device. This is manual exchange, not instant server collaboration. A revoked recipient may retain an old copy. Family ledgers use this workflow instead of personal Drive sync. Restoring an owner backup clears old grants; re-invite members.</p>
<h2>When something goes wrong</h2><p><b>No backup files visible:</b> choose the original exported file from Downloads/Files; the restore picker allows any extension and checks the contents. <b>No passphrase:</b> plain backups do not need one; encrypted backups require the original. <b>File not recognized:</b> keep it unchanged and share the exact error, device and filename extension with support, not the file contents. <b>Saved ledger unreadable:</b> editing is blocked; export the original source before recovery. <b>Not saved:</b> keep the app open, export recoverable data and retry. <b>Sync failed:</b> local saving can still work; check pending status and preserve every copy before resolving conflicts.</p><p>Test previews with copies, not your only financial record. Support needs device/OS, build version, steps and error text; never send passphrases, private keys or financial backups.</p>`;
  function checklist(state, flags = {}) {
    return [
      {
        id: "accounts",
        title: "Review accounts and opening balances",
        done: !!flags.accountsReviewed,
        target: "setup",
      },
      {
        id: "plan",
        title: "Review monthly income and spending",
        done: !!flags.planReviewed,
        target: "plan",
      },
      {
        id: "entry",
        title: "Try your first transaction",
        done:
          Object.keys(state.entries || {}).length +
            Object.keys(state.fxEntries || {}).length >
            0 || !!flags.entrySkipped,
        target: "entry",
      },
      {
        id: "backup",
        title: "Save and check a backup",
        done: !!flags.backupVerified,
        target: "backup",
      },
      {
        id: "optional",
        title: "Choose optional tools",
        done: !!flags.optionalReviewed,
        target: "optional",
      },
    ];
  }
  let A,
    busy = false,
    candidate = null,
    session = 0;
  const KEY = "fcb-guided-setup-v1";
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const btn = (action, label, extra = "") =>
    `<button class="btn" data-guide="${action}" ${extra}>${label}</button>`;
  function signature() {
    const s = A.state();
    return [
      s.settings?.start,
      s.settings?.end,
      ...Object.keys(s.accounts || {}).sort(),
      ...Object.keys(s.fxAccounts || {}).sort(),
    ].join("|");
  }
  function progress() {
    try {
      const o = JSON.parse(root.localStorage.getItem(KEY) || "{}");
      return o.signature === signature() ? o.flags || {} : {};
    } catch {
      return {};
    }
  }
  function mark(flag) {
    const flags = { ...progress(), [flag]: true };
    root.localStorage.setItem(
      KEY,
      JSON.stringify({ signature: signature(), flags }),
    );
  }
  function cancelRestore() {
    session++;
    candidate = null;
  }
  function render() {
    const s = A.state(),
      steps = checklist(s, progress()),
      next = steps.find((x) => !x.done),
      count = steps.filter((x) => x.done).length;
    return `<section class="section"><h2>Setup guide &amp; user manual</h2><div class="panel pad"><p><b>${next ? `Step ${count + 1} of ${steps.length}: ${esc(next.title)}` : "Your essential setup is reviewed."}</b></p><p>Work through the steps in order. You can pause and return here; the checklist is saved on this device. Checking a step does not change financial records.</p><ol>${steps.map((x) => `<li>${x.done ? "✓ " : ""}${esc(x.title)}</li>`).join("")}</ol>${!next ? btn("restart", "Review setup again") : stepBody(next)}<div class="row" style="margin-top:16px">${btn("restore", "Restore a backup")}${btn("manual", "Read the full user manual")}</div></div></section>`;
  }
  function stepBody(step) {
    const copy = {
      accounts:
        "Use balances from the start of your plan. Check every imported account; card debt should be negative.",
      plan: "Review your plan dates, monthly income and spending. Budget and Single bill treat actual entries differently.",
      entry:
        "Save a genuine transaction when ready, then check it in Transactions. You can skip this step without creating sample data.",
      backup:
        "Save a recovery copy away from this device and inspect it before relying on it. A browser download or share sheet alone does not prove the file was kept.",
      optional:
        "Start with the basics. Currency accounts, loan tools and goals are optional. Google sync needs configuration; family sharing is manual file exchange. Payments remain disabled.",
    };
    const flags = {
      accounts: "accountsReviewed",
      plan: "planReviewed",
      entry: "entrySkipped",
      backup: "backupVerified",
      optional: "optionalReviewed",
    };
    return `<p>${copy[step.id]}</p><div class="row">${btn("tool", step.id === "entry" ? "Quick transaction" : step.id === "backup" ? "Save a backup" : step.id === "optional" ? "See optional tools" : "Open " + (step.id === "accounts" ? "accounts" : "Plan"), `data-tool="${step.target}"`)}${step.id === "backup" ? btn("review-only", "Inspect a saved backup") : ""}${btn("mark", step.id === "entry" ? "Skip entry for now" : step.id === "backup" ? "I have saved and checked a backup" : step.id === "optional" ? "Finish setup review" : "I have reviewed this step", `data-flag="${flags[step.id]}"`)}</div>`;
  }
  function banner() {
    if (!A?.state().settings || !A.canWrite()) return "";
    const next = checklist(A.state(), progress()).find((x) => !x.done);
    return next
      ? `<div class="panel pad guide-banner"><b>Continue setup: ${esc(next.title)}</b><p class="hint">Follow the steps in order, or open the user manual whenever you need it.</p>${btn("open", "Continue setup")}${btn("manual", "User manual")}</div>`
      : "";
  }
  function open() {
    cancelRestore();
    A.modal(render() + btn("close", "Close guide"));
  }
  function fresh() {
    cancelRestore();
    A.modal(
      `<h2>Start with the essentials</h2><p id="guide-fresh-step">Step 1 of 2 · your first account</p><section id="guide-account"><p>Enter the balance at the start of the plan month. Add other accounts after creating your ledger.</p><div class="form"><label class="f">Account name<input id="ob-name" value="Main savings"></label><label class="f">Opening balance at start of month (₹)<input id="ob-balance" inputmode="decimal" value="0"></label><label class="f">Start month<input id="ob-start" type="month" value="${new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0")}"></label></div>${btn("fresh-next", "Next: income & spending")}</section><section id="guide-income" hidden><p>Use monthly estimates. Leave a value at zero if you want to add detailed categories later. The plan initially covers 24 months.</p><div class="form"><label class="f">Monthly income (₹)<input id="ob-income" type="number" min="0" value="0"></label><label class="f">Monthly household budget (₹)<input id="ob-expense" type="number" min="0" value="0"></label></div>${btn("fresh-back", "Back")}<button class="btn primary" data-feature="ob-save">Create my plan</button></section>${btn("close", "Cancel")}`,
    );
  }
  function openRestore(file, reviewOnly = false) {
    cancelRestore();
    A.modal(
      `<h2>${reviewOnly ? "Inspect a backup" : "Restore a backup"}</h2><p>Older plain Family Cashbook backups need <b>no passphrase</b>. Choose the original exported file; its contents will be checked before anything is replaced.</p><label class="f">Family Cashbook backup<input id="guide-backup" type="file"></label><p id="guide-file-status" role="status"></p><label class="f" id="guide-pass-label" hidden>Original backup passphrase<input id="guide-pass" type="password" autocomplete="current-password"></label>${btn("review", "Review backup", reviewOnly ? 'data-review-only="true"' : "")}<div id="guide-restore-summary" aria-live="polite"></div>${btn("close", "Cancel")}`,
    );
    if (file) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.getElementById("guide-backup").files = transfer.files;
      detect(file);
    }
  }
  async function detect(file) {
    candidate = null;
    const token = ++session;
    const status = document.getElementById("guide-file-status"),
      label = document.getElementById("guide-pass-label");
    if (!file) return;
    if (file.size > 30e6) {
      status.textContent =
        "File is too large. Choose the original JSON backup under 30 MB.";
      return;
    }
    try {
      const raw = await file.text();
      if (token !== session) return;
      const encrypted =
        JSON.parse(raw.replace(/^\uFEFF/, "")).app ===
        "family-cashbook-encrypted";
      label.hidden = !encrypted;
      status.textContent = encrypted
        ? "Encrypted backup detected. Enter its original passphrase."
        : "Plain backup detected — no passphrase is needed.";
    } catch {
      if (token !== session) return;
      label.hidden = true;
      status.textContent =
        "This file is not readable JSON. Choose the original backup, not an installer, ZIP or image.";
    }
  }
  function manual() {
    return `<section class="section"><div class="panel pad guide-manual">${manualHTML}</div></section>`;
  }
  async function action(target) {
    const a = target.dataset.guide;
    if (a === "close") {
      cancelRestore();
      A.close();
      return;
    }
    if (a === "open") {
      open();
      return;
    }
    if (a === "manual") {
      cancelRestore();
      A.modal(
        btn(
          "close",
          "Close manual",
          'style="position:sticky;top:0;z-index:1"',
        ) + manual(),
      );
      return;
    }
    if (a === "restore" || a === "review-only") {
      openRestore(null, a === "review-only");
      return;
    }
    if (a === "fresh") {
      fresh();
      return;
    }
    if (a === "fresh-next") {
      if (!document.getElementById("ob-name").value.trim())
        throw Error("Name your first account.");
      if (
        !Number.isFinite(
          Number(
            document.getElementById("ob-balance").value.replaceAll(",", ""),
          ),
        )
      )
        throw Error("Enter a valid opening balance.");
      document.getElementById("guide-account").hidden = true;
      document.getElementById("guide-income").hidden = false;
      document.getElementById("guide-fresh-step").textContent =
        "Step 2 of 2 · monthly income and spending";
      document.getElementById("ob-income").focus();
      return;
    }
    if (a === "fresh-back") {
      document.getElementById("guide-account").hidden = false;
      document.getElementById("guide-income").hidden = true;
      document.getElementById("guide-fresh-step").textContent =
        "Step 1 of 2 · your first account";
      return;
    }
    if (a === "restart") {
      root.localStorage.removeItem(KEY);
      open();
      return;
    }
    if (a === "mark") {
      if (
        target.dataset.flag === "backupVerified" &&
        !confirm(
          "Have you kept the backup and checked that you can open it? Keep any passphrase separately.",
        )
      )
        return;
      mark(target.dataset.flag);
      open();
      return;
    }
    if (a === "tool") {
      const tool = target.dataset.tool;
      if (tool === "backup") {
        const result = await root.__cashbookLocal.exportData();
        A.toast(
          result === "cancelled"
            ? "Backup save cancelled."
            : "Backup offered. Check the saved file before completing this step.",
        );
        return;
      }
      A.close();
      if (tool === "entry") A.quickEntry();
      else if (tool === "optional") A.go("more");
      else A.go(tool);
      return;
    }
    if (a === "review") {
      const file = document.getElementById("guide-backup").files[0];
      if (!file) throw Error("Choose your backup first.");
      if (file.size > 30e6) throw Error("Backup is too large.");
      const token = session,
        raw = await file.text(),
        password = document.getElementById("guide-pass").value;
      const summary = await root.__cashbookLocal.inspectBackup(raw, password);
      if (token !== session) return;
      candidate = { raw, password, summary };
      const counts = summary.counts;
      document.getElementById("guide-restore-summary").innerHTML =
        `<div class="panel pad" style="margin-top:14px"><h3>Backup recognized</h3><p>${summary.encrypted ? "Encrypted backup unlocked." : "Plain backup — no passphrase required."}</p><p>${summary.records} records · ${(counts.accounts || 0) + (counts.fxAccounts || 0)} accounts · ${counts.categories || 0} plan categories · ${(counts.entries || 0) + (counts.fxEntries || 0)} transactions.</p><p>Plan: ${esc(summary.start)} to ${esc(summary.end)}. ${summary.familyOwner ? "Owner family grants will be cleared; re-invite members after restoring." : ""}</p>${target.dataset.reviewOnly ? "This inspection has not changed your ledger." : `<p>Restore replaces this device’s ledger; it does not append records. A recovery export of the current copy will be offered first. Finish that save/share step. Connected copies can change on later sync.</p><label class="f"><span><input id="guide-replace-ok" type="checkbox"> I kept my original backup and want to replace this device’s ledger.</span></label>${btn("confirm-restore", "Restore this backup")}`}</div>`;
      return;
    }
    if (a === "confirm-restore") {
      if (!candidate || !document.getElementById("guide-replace-ok")?.checked)
        throw Error("Review the backup and confirm replacement first.");
      if (
        !confirm(
          "Replace this device ledger with the reviewed backup? Keep the recovery export when prompted.",
        )
      )
        return;
      if (root.__cashbookLocal.drive.connected)
        throw Error(
          "Disconnect Google Drive in Phone & laptop sync before restoring. This keeps other devices unchanged during review.",
        );
      await root.__cashbookLocal.importData(candidate.raw, candidate.password);
      root.localStorage.removeItem(KEY);
      cancelRestore();
      A.close();
      A.go("overview");
      A.toast(
        "Backup restored. Continue setup to review accounts and balances.",
      );
      return;
    }
  }
  if (root.document) {
    document.addEventListener("change", (event) => {
      if (event.target.id === "guide-backup") {
        candidate = null;
        document.getElementById("guide-restore-summary").innerHTML = "";
        document.getElementById("guide-pass").value = "";
        detect(event.target.files[0]);
      }
      if (event.target.id === "guide-pass") {
        candidate = null;
        document.getElementById("guide-restore-summary").innerHTML = "";
      }
    });
    document.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-guide]");
      if (!target || !A || busy || target.disabled) return;
      busy = true;
      target.disabled = true;
      try {
        await action(target);
      } catch (error) {
        A.toast(error.message || "Unable to complete this step.");
        const status = document.getElementById("guide-file-status");
        if (status) status.textContent = error.message;
      } finally {
        busy = false;
        if (target.isConnected) target.disabled = false;
        A.refresh();
      }
    });
  }
  return {
    checklist,
    manualHTML,
    attach: (api) => (A = api),
    render,
    manual,
    banner,
    open,
    openRestore,
    fresh,
    cancelRestore,
    get busy() {
      return busy;
    },
  };
});
