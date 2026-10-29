/* Personal mobile companion: same owner, encrypted ledger, offline entry. */
(() => {
  "use strict";
  let A,
    busy = false;
  const esc = (value) =>
    String(value ?? "").replace(
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
  const button = (action, label, disabled = false) =>
    `<button class="btn" data-companion="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
  function render() {
    const L = window.__cashbookLocal,
      D = L?.drive;
    if (!D) return "<p>Device sync is available in the standalone app.</p>";
    const family = !!A?.state().family?.main;
    const state = !D.supported
      ? "Use your laptop browser for Google sign-in"
      : !D.configured()
        ? "Google sync setup pending"
        : !D.connected
          ? "Saved only on this device"
          : D.pending
            ? "Saved here · waiting to sync"
            : D.status === "synced"
              ? "Synced with your Google Drive"
              : "Ready to sync";
    return `<section class="section"><h2>Phone & laptop sync</h2><div class="panel pad"><p><b>${esc(state)}</b></p>
      <p>Enter transactions on your phone, even offline. When you open the app online, sync with the same Google account on your laptop. Each device keeps its own saved copy.</p>
      ${A?.state().settings ? button("entry", "Quick transaction") : "<p>Connect to your existing desktop ledger before entering transactions on a new phone.</p>"}
      <p class="hint">${D.connected ? `Connected as ${esc(D.email)}. ` : ""}${D.lastSync ? `Last successful sync: ${esc(new Date(D.lastSync).toLocaleString())}. ` : ""}Saving here and uploading to Drive are separate steps. Keep the app open until sync completes.</p>
      ${family ? "<p>Family ledgers use signed attachment exchange. Personal device sync is unavailable for this ledger.</p>" : !D.supported ? "<p>Open the browser version on your laptop. The Windows EXE does not yet support this Google sign-in flow.</p>" : !D.configured() ? "<p>Google OAuth client IDs have not been configured. Quick entry works locally; cross-device sync is not active yet.</p>" : !L.encrypted ? `<h3>Protect this device copy</h3><p>On your first device, choose a passphrase of at least 12 characters. On your second device, use the exact same passphrase. Keep it separately; it cannot be recovered.</p><div class="form"><label class="f">Shared ledger passphrase<input id="device-pass" type="password" autocomplete="new-password"></label><label class="f">Confirm passphrase<input id="device-confirm" type="password" autocomplete="new-password"></label></div>${button("encrypt", "Enable encrypted device sync")}` : `<p>The working ledger and new Drive uploads are encrypted. Unlock each device with the same passphrase after reopening. Older plaintext copies remain unchanged.</p>${button("connect", D.connected ? "Sync now" : "Connect my Google account")}${D.connected || D.email ? button("disconnect", "Disconnect this device") : ""}`}
      ${D.error ? `<p role="status" style="color:var(--bad)">${esc(D.error)}</p>` : ""}
      <p class="hint">For first setup: connect the laptop first, finish its sync, then connect your phone. Use the same Google account and OAuth project. Do not create a separate ledger on the phone. Conflicting edits are recorded in Sync history.</p></div></section>`;
  }
  function open() {
    A.modal(render());
  }
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-companion]");
    if (!target || !A || busy) return;
    busy = true;
    target.disabled = true;
    try {
      const L = window.__cashbookLocal,
        action = target.dataset.companion;
      if (action === "entry") {
        A.close();
        A.quickEntry();
        return;
      }
      if (action === "encrypt") {
        const pass = document.getElementById("device-pass").value;
        if (pass !== document.getElementById("device-confirm").value)
          throw Error("Passphrases do not match.");
        if (pass.length < 12) throw Error("Use at least 12 characters.");
        if (
          !confirm(
            "Encrypt this saved device copy? Keep your original backup and remember the passphrase.",
          )
        )
          return;
        await L.encryptLedger(pass);
        document.getElementById("device-pass").value = "";
        document.getElementById("device-confirm").value = "";
        A.toast("Encrypted. Now connect your Google account.");
      }
      if (action === "connect") {
        if (
          !L.drive.connected &&
          A.state().settings &&
          !confirm(
            "Sync this saved ledger with your Google Drive copy? Matching records merge; unique records are combined. Preserve a backup first.",
          )
        )
          return;
        await L.drive.connect();
        A.toast(
          L.drive.status === "synced"
            ? "Synced with Google Drive."
            : "Saved here. Connect to the internet to sync.",
        );
      }
      if (action === "disconnect") {
        if (
          !confirm(
            "Disconnect this device? Saved copies here and in Drive will remain.",
          )
        )
          return;
        await L.drive.disconnect();
      }
      if (target.closest("#modal")) open();
    } catch (error) {
      A.toast(
        error.message ||
          "Sync did not complete. Your saved device copy is kept.",
      );
    } finally {
      busy = false;
      if (target.isConnected) target.disabled = false;
      A.refresh();
    }
  });
  window.CashbookCompanion = {
    attach: (api) => {
      A = api;
    },
    render,
    open,
    get busy() {
      return busy;
    },
  };
})();
