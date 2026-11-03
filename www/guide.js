/* Guided setup and recovery. Progress stays on this device; it never changes ledger records. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CashbookGuide = api;
})(globalThis, (root) => {
  "use strict";
  const manualHTML = `<h1>ReadyTrove Family Money — setup &amp; user guide</h1><p>Start small: restore your old records or add one account, add your regular income and bills, record one transaction, then save a backup. The setup card on Home takes you through each step. You can take the tour again from More. Other tools are optional.</p>
<h2>1. Start or restore</h2><p>On the welcome screen choose <b>Restore a backup</b> or <b>Start fresh</b>. An older backup needs <b>no code</b>. Select the original file, read the record summary, then confirm replacement. Encrypted backups ask for their recovery code or passphrase. A ZIP, APK, EXE, image or bank-statement CSV is not a full backup.</p><p>The current device copy is offered as a recovery export before replacement. On Android, finish the share/save step; on Windows, save the recovery file. Cancelling that save cancels a desktop restore. Verify that recovery copies were kept. Restore replaces this device's ledger; connected copies can change on later sync. Keep the original backup untouched and disconnect Drive before testing an old copy.</p>
<h2>2. Review accounts and opening balances</h2><p>Open <b>More → Accounts &amp; backup</b>. Add each bank/cash account with its balance at the start of the plan. Keep the plan start month consistent with those balances. Add credit cards with negative opening balances for debt; a positive card balance is a credit. </p>
<h2>3. Build the monthly plan</h2><p>Open <b>Plan</b>. Add income and spending categories and assign their usual account. A <b>Budget</b> retains the expected unspent remainder after partial spending. A <b>Single bill</b> uses the recorded actual instead of adding another full forecast bill. Mark a category complete if nothing else is expected that month. Home forecasts include planned future activity; recorded cash uses entered transactions, not a live bank feed.</p>
<h2>4. Record everyday transactions</h2><p>Tap <b>Quick transaction</b> on Home or <b>+ Transaction</b> in Transactions. Choose money out or money in, category, amount, date, account and optional note. One-off miscellaneous entries need a description. Wait for a saved acknowledgement. A failed save is not a confirmed entry: retry and check the list. Edit the existing transaction when correcting it.</p><p>Use a <b>Transfer</b> for movement between your own accounts and for credit-card repayments. A transfer is not new income or spending. Card purchases are expenses. Statement import is under More; preview supported CSV rows, assign categories and review duplicates before importing. A statement CSV cannot restore a ledger.</p>
<h2>5. Review and close a month</h2><p>Open <b>More → Monthly review</b>. Enter the actual statement balance for every account, compare with recorded activity and explain differences. Differences on two accounts can offset while still needing correction. Review currency reconciliations too if used. Close the earliest open month only after checking every account; closed periods reject edits. Reopening is a deliberate review action.</p>
<h2>6. Protect your records</h2><p>Your records are encrypted on this device. Your PIN opens them here, and the app locks itself when you leave it. Your recovery code and a backup file bring them back on any device. Write the code on paper and keep it away from the device; ReadyTrove cannot reset it.</p><p>Use <b>Accounts &amp; backup → Save a backup</b>. Keep a copy away from the device and check that it opens in backup review. Each backup shows the ID of the recovery code it needs. Older plain backups stay readable, so delete them once you have a new backup. Avoid clearing browser data or uninstalling before saving a backup.</p>
<h2>7. Loans, goals, scenarios and net worth</h2><p><b>Loans &amp; EMIs</b> uses statement principal, date, annual rate and monthly payment. <b>Loan prepayment</b> compares estimates without changing your loan or plan. It excludes lender fees and future rate changes. <b>Savings goals</b> earmark existing money; earmarks are not extra assets. <b>What-if scenarios</b> compare temporary changes without changing the main plan. <b>Net worth</b> combines assets and liabilities; avoid adding a card liability twice. Businesses and loans are in INR.</p>
<h2>8. Foreign accounts and remittances</h2><p>Open <b>Multi-currency accounts &amp; remittances</b>. Create an account in its native currency, enter an opening balance and explicit INR valuation rate, then record native-currency income/expense. Keep the original transaction rate for history. For remittances, enter the source principal, source fee and actual received amount. Principal is a transfer; fees are separate. Do not also record principal as income/expense. Review native balances monthly. There is no live FX feed, NRE/NRO eligibility decision or tax calculation.</p>
<h2>9. Phone and laptop sync</h2><p>Install the Windows app and the phone app. On both, open <b>Phone &amp; laptop sync</b>. Each device has its own PIN. On the laptop choose <b>Connect phone · show QR</b>. On the phone choose <b>Scan laptop QR</b>. Compare the six-digit code and approve on both devices. Then tap <b>Sync now</b> on the phone. The first sync copies the laptop ledger into an empty phone app; later syncs merge records in both directions. Pair only your own devices: they receive full access.</p><p>Keep both apps open and unlocked on the same private Wi-Fi. After restarting the laptop app, choose <b>Allow paired phones to sync</b>. No internet, Google account or router configuration is needed. Windows Firewall may require permission on private networks; iPhone requires Local Network and camera permission. Guest Wi-Fi may isolate devices. If the laptop address changes, scan a new QR. Remove a lost device in the same screen. Received copies cannot be remotely erased. Restoring a backup clears pairings, so pair again afterwards. Wi-Fi sync does not work in a web browser, and it does not combine two separate sets of records. The phone must start empty.</p>
<h2>10. Encrypted family file sharing</h2><p>Create separate member keys, compare fingerprints independently and grant only needed accounts. Viewers cannot propose edits; editors return signed proposals which the owner reviews. Send encrypted attachments through WhatsApp/email and import the saved file on the other device. This is manual exchange, not instant server collaboration. A revoked recipient may retain an old copy. Family ledgers use this workflow instead of personal Drive sync. Restoring an owner backup clears old grants; re-invite members.</p>
<h2>When something goes wrong</h2><p><b>No backup files visible:</b> choose the original exported file from Downloads/Files; the restore picker allows any extension and checks the contents. <b>No passphrase:</b> plain backups do not need one; encrypted backups require the original. <b>File not recognized:</b> keep it unchanged and share the exact error, device and filename extension with support, not the file contents. <b>Saved ledger unreadable:</b> editing is blocked; export the original source before recovery. <b>Not saved:</b> keep the app open, export recoverable data and retry. <b>Sync failed:</b> local saving can still work; check pending status and preserve every copy before resolving conflicts.</p><p>Support needs device/OS, build version, steps and error text; never send passphrases, private keys or financial backups.</p>`;
  function checklist(state, flags = {}) {
    const want = flags.want || {},
      skip = flags.skip || {},
      accounts = Object.values(state.accounts || {}),
      foreign = Object.values(state.fxAccounts || {}),
      categories = Object.values(state.categories || {}),
      entries =
        Object.keys(state.entries || {}).length +
        Object.keys(state.fxEntries || {}).length;
    return [
      { id: "accounts", title: "Add your other bank accounts", sub: "Savings, current, NRE, NRO and cash", done: accounts.length + foreign.length >= 2, target: "setup" },
      want.cards && { id: "cards", title: "Add your credit cards", sub: "Enter what you owe today", done: accounts.some((a) => a.kind === "Credit") || foreign.some((a) => a.kind === "card"), target: "card" },
      { id: "plan", title: "Add your regular income and bills", sub: "Salary, rent, school fees, insurance", done: categories.length >= 3, target: "plan" },
      want.loans && { id: "loans", title: "Add your loans and EMIs", sub: "Use your latest loan statement", done: categories.some((c) => c.group === "Loans & EMIs"), target: "loans" },
      want.foreign && { id: "foreign", title: "Set up foreign or contract income", sub: "Months on contract and on leave, or money in other currencies", done: foreign.length > 0, target: "contract" },
      want.business && { id: "business", title: "Add your business", sub: "A rental, shop, farm or side business", done: Object.keys(state.businesses || {}).length > 0, target: "business" },
      flags.canRemind && { id: "remind", title: "Turn on bill and EMI reminders", sub: "Add a due day to each bill, and your phone tells you before it falls due", done: !!flags.remindOn, target: "reminders" },
      { id: "entry", title: "Record your first transaction", sub: "Something you spent or received today", done: entries > 0, target: "entry" },
      { id: "backup", title: "Save a backup and check it opens", sub: "This file and your recovery code bring everything back", done: !!flags.backupVerified, target: "backup" },
    ]
      .filter(Boolean)
      .map((x) => ({ ...x, skipped: !x.done && !!skip[x.id] }));
  }
  const TOUR = [
    ["See all your money", "Bank accounts, credit cards and loans in one place.", "M4 8h16v11H4zM4 8l12-4 2 4M15 13h5"],
    ["Spot a tight month early", "See the lowest point ahead, before it arrives.", "M4 5v14h16M7 9l4 5 3-3 5 4"],
    ["Plan the month", "Add income, EMIs and bills once. The forecast fills itself in.", "M5 6h14v14H5zM5 10h14M9 3v5M15 3v5"],
    ["Record what really happened", "A few seconds to add spending, then a quick bank check at month end.", "M5 19l1-4L16 5l3 3L9 18zM13 8l3 3"],
    ["Tools when you need them", "Loans, goals, businesses and foreign income stay out of the way until you want them.", "M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M8 16v4"],
    ["Private on your devices", "No account and no ads. Your PIN protects your records, and they are not uploaded to us.", "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4"],
  ];
  function tour(then, { replay = false } = {}) {
    if (root.CASHBOOK_TEST_SKIP_PIN && !replay) {
      then?.();
      return;
    }
    const box = document.createElement("div");
    box.id = "tour-root";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.style.cssText =
      "position:fixed;inset:0;z-index:60;background:var(--bg);overflow:auto;display:flex;justify-content:center;padding:24px 16px";
    document.body.appendChild(box);
    const finish = () => {
      box.remove();
      then?.();
    };
    const show = (i) => {
      const [title, text, icon] = TOUR[i],
        last = i === TOUR.length - 1;
      box.innerHTML = `<div style="width:100%;max-width:420px;margin:auto;text-align:center"><div class="panel pad"><div aria-hidden="true" style="width:72px;height:72px;margin:8px auto 12px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center"><svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${icon}"/></svg></div><p class="hint" id="tour-step">${i + 1} of ${TOUR.length}</p><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row" style="justify-content:center;margin-top:16px"><button class="btn" id="${i ? "tour-back" : "tour-skip"}">${i ? "Back" : "Skip"}</button><button class="btn primary" id="tour-next">${last ? "Continue" : "Next"}</button></div></div></div>`;
      box.querySelector("#tour-next").onclick = () => (last ? finish() : show(i + 1));
      const skip = box.querySelector("#tour-skip"),
        back = box.querySelector("#tour-back");
      if (skip) skip.onclick = finish;
      if (back) back.onclick = () => show(i - 1);
      box.querySelector("#tour-next").focus();
    };
    show(0);
  }
  const TIPS = {
    plan: "This is your monthly plan. Add your income and regular bills, and the forecast on Home updates itself.",
    transactions: "Record what really happened. Tick a planned item to confirm it, or add a new one.",
    month: "At month end, type each account's real bank balance. Any difference shows money you did not record.",
    loans: "Add each loan from your latest statement. The schedule and debt-free date fill in for you.",
  };
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
  function progress() {
    try {
      return JSON.parse(root.localStorage.getItem(KEY) || "{}").flags || {};
    } catch {
      return {};
    }
  }
  function save(flags) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify({ flags }));
    } catch {}
  }
  function mark(flag) {
    save({ ...progress(), [flag]: true });
  }
  function skipStep(id) {
    const flags = progress();
    save({ ...flags, skip: { ...flags.skip, [id]: true } });
  }
  const device = () => ({ canRemind: !!root.CashbookReminders?.available, remindOn: !!root.CashbookReminders?.settings.on });
  const live = () => ({ ...progress(), ...device() });
  function tip(key) {
    return progress().tips?.[key] || !TIPS[key]
      ? ""
      : `<div class="panel pad guide-banner"><p style="margin:0 0 8px">${esc(TIPS[key])}</p>${btn("tip", "Got it", `data-k="${key}"`)}</div>`;
  }
  function cancelRestore() {
    session++;
    candidate = null;
  }
  const open_ = (x) => !x.done && !x.skipped;
  const stepButton = (x) =>
    x.target === "backup"
      ? btn("open", "Start")
      : btn("tool", "Start", `data-tool="${x.target}"`);
  function render() {
    const flags = progress();
    if (flags.hidden) save({ ...flags, hidden: false }); // opening the guide brings the Home card back
    const steps = checklist(A.state(), live()),
      next = steps.find(open_),
      count = steps.filter((x) => !open_(x)).length;
    return `<section class="section"><h2>Setup guide &amp; user manual</h2><div class="panel pad"><p><b>${next ? `Step ${count + 1} of ${steps.length}: ${esc(next.title)}` : "Your setup is complete."}</b></p><ol>${steps.map((x) => `<li>${x.done ? "✓ " : x.skipped ? "Skipped: " : ""}${esc(x.title)}</li>`).join("")}</ol>${next ? stepBody(next) : btn("restart", "Show the setup steps again")}<div class="row" style="margin-top:16px">${btn("restore", "Restore a backup")}${btn("manual", "Read the full user manual")}</div></div></section>`;
  }
  function stepBody(step) {
    if (step.id === "backup")
      return `<p>${esc(step.sub)}. A download or share sheet alone does not prove the file was kept, so check that it opens.</p><div class="row">${btn("tool", "Save a backup", 'data-tool="backup"')}${btn("review-only", "Inspect a saved backup")}${btn("mark", "I have saved and checked a backup", 'data-flag="backupVerified"')}${btn("skip", "Skip", 'data-step="backup"')}</div>`;
    return `<p>${esc(step.sub)}.</p><div class="row">${stepButton(step)}${btn("skip", "Skip", `data-step="${step.id}"`)}</div>`;
  }
  function banner() {
    if (!A?.state().settings || !A.canWrite()) return "";
    const flags = progress(),
      steps = checklist(A.state(), { ...flags, ...device() }),
      next = steps.find(open_);
    if (!next || flags.hidden) return "";
    const count = steps.filter((x) => !open_(x)).length;
    return `<div class="panel pad guide-banner"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b>Set up Family Money: ${count} of ${steps.length} done</b>${btn("hide", "Hide", 'style="min-height:0;padding:2px 8px"')}</div><div aria-hidden="true" style="height:6px;border-radius:3px;background:var(--sunk);margin:8px 0 12px;overflow:hidden"><div style="height:100%;width:${Math.round((count / steps.length) * 100)}%;background:var(--accent)"></div></div><p style="margin:0"><b>${esc(next.title)}</b></p><p class="hint">${esc(next.sub)}</p><div class="row">${stepButton(next)}${btn("skip", "Skip", `data-step="${next.id}"`)}${btn("open", "See all steps")}</div></div>`;
  }
  function open() {
    cancelRestore();
    A.modal(render() + btn("close", "Close guide"));
  }
  function fresh() {
    cancelRestore();
    A.modal(
      `<h2>Start with the essentials</h2><p id="guide-fresh-step">Step 1 of 2 · your first account</p><section id="guide-account"><p>Start with your main account. Not sure of the balance on the 1st? Use today's balance. You can add other accounts next.</p><div class="form"><label class="f">Account name<input id="ob-name" value="Main savings"></label><label class="f">Balance on the 1st of this month (₹)<input id="ob-balance" inputmode="decimal" placeholder="0"></label><label class="f">Start month<input id="ob-start" type="month" value="${new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0")}"></label></div>${btn("fresh-next", "Next: income & spending")}</section><section id="guide-income" hidden><p>Rough monthly figures are fine. You can add the details later.</p><div class="form"><label class="f">Monthly income (₹)<input id="ob-income" type="number" min="0" placeholder="0"></label><label class="f">Monthly household budget (₹)<input id="ob-expense" type="number" min="0" placeholder="0"></label></div>${btn("fresh-back", "Back")}<button class="btn primary" data-feature="ob-save">Create my plan</button></section>${btn("close", "Cancel")}`,
    );
  }
  /* After the first numbers: show what the forecast found, then ask what applies. */
  async function afterStart() {
    if (root.CASHBOOK_TEST_SKIP_PIN) return;
    for (let i = 0; i < 40 && !A.computed()?.ms?.length; i++) {
      A.refresh();
      await new Promise((r) => setTimeout(r, 50));
    }
    const c = A.computed(),
      ahead = (c?.ms || []).filter((m) => m >= c.cur);
    let low = ahead[0];
    ahead.forEach((m) => {
      if (c.total[m] < c.total[low]) low = m;
    });
    const label = low ? new Date(low + "-01T12:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "";
    const amount = low ? (c.total[low] < 0 ? "−" : "") + "₹" + Math.abs(Math.round(c.total[low])).toLocaleString("en-IN") : "";
    const box = (id, text) =>
      `<label class="f" style="display:flex;gap:8px;align-items:center;flex-direction:row"><input id="${id}" type="checkbox" style="width:auto">${text}</label>`;
    A.modal(
      `<h2>Your forecast is ready</h2>${low ? `<p>On these figures, your cash is lowest in <b>${esc(label)}</b>, at <b>${esc(amount)}</b>. It gets more accurate as you add details.</p>` : ""}<p><b>What applies to you?</b> We will add only these steps.</p>${box("want-cards", "Credit cards")}${box("want-loans", "Loans or EMIs")}${box("want-foreign", "Foreign or contract income")}${box("want-business", "A business or rental")}${btn("want-save", "Continue")}`,
    );
  }
  function openRestore(file, reviewOnly = false) {
    cancelRestore();
    A.modal(
      `<h2>${reviewOnly ? "Inspect a backup" : "Restore a backup"}</h2><p>Older backups need <b>no code</b>. Choose the original exported file; its contents will be checked before anything is replaced.</p><label class="f">Your backup file<input id="guide-backup" type="file"></label><p id="guide-file-status" role="status"></p><label class="f" id="guide-pass-label" hidden>Recovery code or passphrase<input id="guide-pass" type="password" autocomplete="current-password"></label>${btn("review", "Review backup", reviewOnly ? 'data-review-only="true"' : "")}<div id="guide-restore-summary" aria-live="polite"></div>${btn("close", "Cancel")}`,
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
        ? "Encrypted backup detected. Enter its recovery code or passphrase."
        : "Older backup detected. No code is needed.";
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
      const flags = progress();
      if (flags.hidden) save({ ...flags, hidden: false });
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
    if (a === "skip") {
      skipStep(target.dataset.step);
      if (document.getElementById("modal")?.textContent.includes("Setup guide")) open();
      return;
    }
    if (a === "hide") {
      save({ ...progress(), hidden: true });
      A.toast("Setup hidden. Open it again from More.");
      return;
    }
    if (a === "tip") {
      const flags = progress();
      save({ ...flags, tips: { ...flags.tips, [target.dataset.k]: true } });
      return;
    }
    if (a === "want-save") {
      const on = (id) => !!document.getElementById("want-" + id)?.checked;
      save({ ...progress(), want: { cards: on("cards"), loans: on("loans"), foreign: on("foreign"), business: on("business") } });
      A.close();
      return;
    }
    if (a === "mark") {
      if (
        target.dataset.flag === "backupVerified" &&
        !confirm(
          "Have you kept the backup and checked that you can open it? Keep your recovery code separately.",
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
      else if (tool === "card" || tool === "contract" || tool === "reminders" || tool === "business") await root.CashbookUI.run(tool);
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
        `<div class="panel pad" style="margin-top:14px"><h3>Backup recognized</h3><p>${summary.encrypted ? "Encrypted backup unlocked." : "Older backup. No code needed."}</p><p>${summary.records} records · ${(counts.accounts || 0) + (counts.fxAccounts || 0)} accounts · ${counts.categories || 0} plan categories · ${(counts.entries || 0) + (counts.fxEntries || 0)} transactions.</p><p>Plan: ${esc(summary.start)} to ${esc(summary.end)}. ${summary.familyOwner ? "Owner family grants will be cleared; re-invite members after restoring." : ""}</p>${target.dataset.reviewOnly ? "This inspection has not changed your ledger." : `<p>Restore replaces the records on this device. It does not add to them. A recovery export of the current copy will be offered first. Finish that save/share step. Connected copies can change on later sync.</p><label class="f"><span><input id="guide-replace-ok" type="checkbox"> I kept my original backup and want to replace the records on this device.</span></label>${btn("confirm-restore", "Restore this backup")}`}</div>`;
      return;
    }
    if (a === "confirm-restore") {
      if (!candidate || !document.getElementById("guide-replace-ok")?.checked)
        throw Error("Review the backup and confirm replacement first.");
      if (
        !confirm(
          "Replace the records on this device with this backup? Keep the recovery export when prompted.",
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
    tour,
    tip,
    afterStart,
    cancelRestore,
    get busy() {
      return busy;
    },
  };
});
