/* Simple native Wi-Fi pairing UI. Pairing capabilities never enter URLs, logs or analytics. */
(() => {
  "use strict";
  let A,
    controller,
    actionBusy = false,
    qrCache = { text: null, src: null, promise: null };
  const $ = (s) => document.querySelector(s),
    esc = (x) =>
      String(x ?? "").replace(
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
  const button = (act, label, disabled = false, extra = "") =>
    `<button class="btn" data-wifi="${act}" ${disabled ? "disabled" : ""} ${extra}>${label}</button>`;
  const native = () => !!window.Capacitor?.isNativePlatform?.();
  async function request(base, route, body) {
    const url = new URL(CashbookWifiCrypto.endpoint(base));
    if (!native() || !window.CashbookLocalTransport)
      throw Error(
        "Install the Android or iPhone app to connect locally. Browser previews do not support native Wi-Fi transport.",
      );
    const response = await window.CashbookLocalTransport.request({
      host: url.hostname,
      port: Number(url.port),
      route,
      body: JSON.stringify(body),
    });
    if (
      typeof response.body !== "string" ||
      response.body.length > 42 * 1024 * 1024
    )
      throw Error("Invalid local response.");
    return JSON.parse(response.body);
  }
  function ensure() {
    if (controller) return controller;
    const D = window.cashbookDesktop;
    controller = CashbookWifi.create({
      store: window.__cashbookLocal,
      hostTransport: D?.wifiStart
        ? {
            start: () => D.wifiStart(),
            stop: () => D.wifiStop(),
            reply: (id, value) => D.wifiReply(id, value),
            onRequest: (fn) => D.onWifiRequest(fn),
          }
        : null,
      request,
      cancelTransport: () =>
        window.CashbookLocalTransport?.cancel?.() || Promise.resolve(),
      onChange: paint,
    });
    return controller;
  }
  function inner() {
    const L = window.__cashbookLocal;
    if (!L) return "<p>Open the standalone app to pair devices.</p>";
    const s = ensure().state();
    let out =
      "<h3>Sync directly over your Wi-Fi</h3><p>No Google account or internet connection needed. Keep both apps open and unlocked on the same private Wi-Fi.</p>";
    if (A?.state().family?.main)
      return (
        out +
        "<p>This family ledger uses signed family-file exchange. Personal device pairing is unavailable.</p>"
      );
    if (L.drive?.connected)
      return (
        out +
        "<p>Disconnect Google Drive below before switching to local Wi-Fi sync.</p>"
      );
    if (!window.cashbookDesktop?.wifiStart && !native())
      return (
        out +
        "<p>Use the installed Windows app on your laptop and the installed app on your phone. This browser preview cannot connect to local devices.</p>"
      );
    if (!L.encrypted || L.locked)
      return (
        out +
        (window.CASHBOOK_TEST_SKIP_PIN
          ? '<div class="form"><label class="f">Device passphrase (12+ characters)<input id="wifi-pass" type="password" autocomplete="new-password"></label><label class="f">Confirm passphrase<input id="wifi-confirm" type="password" autocomplete="new-password"></label></div>'
          : "<p>First protect this device with a PIN. Each device has its own PIN.</p>") +
        button("protect", "Protect this device", actionBusy)
      );
    if (window.cashbookDesktop?.wifiStart) {
      out +=
        "<p>Paired phones receive full access to this personal ledger. Pair only devices you control.</p>";
      out +=
        button("show", "Connect phone · show QR", actionBusy || !!s.pending) +
        button(
          s.active ? "stop" : "listen",
          s.active ? "Stop local sync" : "Allow paired phones to sync",
          actionBusy,
        );
      if (s.active)
        out +=
          '<p role="status">Listening for your paired phone. Tap <b>Sync now</b> on the phone.</p>';
      if (s.qr) {
        out += `<div style="text-align:center;background:white;border-radius:16px;padding:12px;margin:12px 0;color:#102f49"><p><b>On your phone, tap Scan laptop QR</b></p><img id="wifi-qr" ${qrCache.text === s.qr && qrCache.src ? `src="${qrCache.src}"` : ""} alt="One-use secure device pairing QR code" width="280" height="280" style="max-width:100%;height:auto"><p id="wifi-expiry"></p><p>Keep this code private. It expires after two minutes.</p></div>`;
        if (s.addresses.length > 1)
          out +=
            '<label class="f">Laptop Wi-Fi address<select id="wifi-address">' +
            s.addresses
              .map(
                (ip) =>
                  `<option value="${esc(ip)}" ${s.endpoint?.includes("//" + ip + ":") ? "selected" : ""}>${esc(ip)}</option>`,
              )
              .join("") +
            '</select></label><p class="hint">If the phone cannot connect, select the address for the Wi-Fi shared with your phone and show a new QR.</p>';
      }
      if (s.pending)
        out += `<div class="panel pad" role="status"><h3>Pair ${esc(s.pending.name)}?</h3><p>Check that the phone shows this same code:</p><p style="font-size:2rem;letter-spacing:.2em;font-weight:bold">${esc(s.pending.code)}</p>${button("approve", "Codes match · approve")}${button("reject", "Reject")}</div>`;
    } else {
      out += button(
        "scan",
        s.peers.length
          ? "Pair again / update laptop connection"
          : "Scan laptop QR",
        actionBusy || s.busy,
      );
      if (s.candidate)
        out += `<div class="panel pad" role="status"><p>Check this code on your laptop:</p><p style="font-size:2rem;letter-spacing:.2em;font-weight:bold">${esc(s.candidate.code)}</p><p>${s.candidate.approved ? "Laptop approved. Confirm the code matches before continuing." : "Approve this matching code on the laptop. No records have been shared."}</p>${s.candidate.approved ? button("confirm", "Codes match · finish pairing") : ""}${button("cancel", "Cancel pairing")}</div>`;
    }
    for (const peer of s.peers)
      out += `<div class="panel pad" style="margin-top:12px"><b>${esc(peer.name)}</b><p>${peer.lastSync ? "Last sync: " + esc(new Date(peer.lastSync).toLocaleString()) : "Paired · first sync pending"}</p>${s.role === "phone" ? button("sync", "Sync now", actionBusy || s.busy, `data-id="${esc(peer.id)}"`) : ""}${button("remove", "Remove device", actionBusy || s.busy, `data-id="${esc(peer.id)}"`)}</div>`;
    if (s.error) out += `<p role="alert">${esc(s.error)}</p>`;
    out +=
      '<p class="hint">Removing a device stops future transfers; copies already received remain on that device. Backups do not contain device-pairing keys. Restoring a backup requires pairing again.</p><details><summary>Connection help</summary><p>Use the same private Wi-Fi, keep the laptop awake, and allow Family Money through Windows Firewall on private networks. On iPhone, allow Local Network access. Guest Wi-Fi may block devices from talking to each other. If the laptop’s address changes, scan a new QR code.</p></details>';
    return out;
  }
  function render() {
    return (
      '<div id="wifi-panel" class="panel pad" style="margin-bottom:18px">' +
      inner() +
      "</div>"
    );
  }
  function paint() {
    if (!A) return;
    window.dispatchEvent(new Event("cashbook-wifi"));
    let el = $("#wifi-panel");
    const s = controller?.state();
    if (!el && s?.pending) {
      A.modal(window.CashbookCompanion.render());
      el = $("#wifi-panel");
    }
    if (!el) return;
    if (s?.qr && qrCache.text !== s.qr) {
      const text = s.qr;
      qrCache = { text, src: null, promise: window.CashbookQR.toDataURL(text) };
      qrCache.promise
        .then((src) => {
          if (qrCache.text === text) {
            qrCache.src = src;
            if (controller.state().qr === text && $("#wifi-qr"))
              $("#wifi-qr").src = src;
          }
        })
        .catch(() => A.toast("Could not display the QR code. Try again."));
    }
    if (!s?.qr) qrCache = { text: null, src: null, promise: null };
    el.innerHTML = inner();
  }
  setInterval(() => {
    const el = $("#wifi-expiry"),
      s = controller?.state();
    if (el && s) {
      const seconds = Math.max(0, Math.ceil((s.expires - Date.now()) / 1000));
      el.textContent = seconds
        ? "Expires in " + seconds + " seconds"
        : "Expired · show a new QR on the laptop";
      if (!seconds && $("#wifi-qr")) $("#wifi-qr").hidden = true;
    }
  }, 1000);
  document.addEventListener("change", async (e) => {
    if (e.target.id !== "wifi-address") return;
    try {
      await ensure().showQR(e.target.value);
    } catch (err) {
      A.toast(err.message);
    }
  });
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-wifi]");
    if (!t || !A) return;
    const action = t.dataset.wifi,
      c = ensure();
    if (["approve", "reject"].includes(action)) {
      c.decide(action === "approve");
      return;
    }
    if (action === "cancel") {
      c.cancel();
      return;
    }
    if (actionBusy) return;
    actionBusy = true;
    t.disabled = true;
    try {
      if (action === "protect" && !window.CASHBOOK_TEST_SKIP_PIN) {
        A.close();
        await window.CashbookLock.protect(() => window.CashbookCompanion?.open?.());
      } else if (action === "protect") {
        const pass = $("#wifi-pass").value;
        if (pass !== $("#wifi-confirm").value)
          throw Error("Passphrases do not match.");
        if (pass.length < 12) throw Error("Use at least 12 characters.");
        await window.__cashbookLocal.encryptLedger(pass);
        await c.refresh();
        A.toast("This device is encrypted. Keep its passphrase safe.");
      }
      if (action === "show") await c.showQR();
      if (action === "listen") {
        await c.start();
        A.toast("Ready. Tap Sync now on your phone.");
      }
      if (action === "stop") await c.stop();
      if (action === "scan") {
        const value = await window.__cashbookLocal.hold(() => window.CashbookScanner.scan());
        if (!value) return;
        await c.scan(
          value,
          /iPhone|iPad|iPod/.test(navigator.userAgent)
            ? "My iPhone"
            : /Android/.test(navigator.userAgent)
              ? "My Android phone"
              : "My phone",
        );
      }
      if (action === "confirm") {
        await c.confirmPhone();
        A.toast("Paired. Tap Sync now to copy your ledger from the laptop.");
      }
      if (action === "sync") {
        await c.sync(t.dataset.id);
        A.toast(
          "Both devices synced. Conflicting edits, if any, are in Sync history.",
        );
      }
      if (
        action === "remove" &&
        confirm(
          "Remove this device? It will no longer sync. Copies already received remain on that device.",
        )
      )
        await c.remove(t.dataset.id);
    } catch (err) {
      A.toast(
        err.message ||
          "Local connection did not complete. Your saved records are kept.",
      );
    } finally {
      actionBusy = false;
      paint();
      A.refresh();
    }
  });
  window.addEventListener("cashbook-ledger-replaced", () =>
    controller?.reset(),
  );
  window.addEventListener("cashbook-unlock", () => {
    if (controller) controller.refresh().catch(() => {});
  });
  window.addEventListener("cashbook-modal-closed", () => {
    if (controller?.state().candidate) controller.cancel();
  });
  window.CashbookWifiUI = {
    attach(api) {
      A = api;
      ensure();
      if (window.__cashbookLocal?.encrypted && !window.__cashbookLocal.locked)
        controller.refresh().catch(() => {});
    },
    render,
    refresh() {
      if (window.__cashbookLocal?.encrypted && !window.__cashbookLocal.locked)
        ensure()
          .refresh()
          .catch((e) => A.toast(e.message));
      else paint();
    },
    get status() {
      const s = controller?.state();
      return {
        paired: !!s?.peers.length,
        active: !!s?.active,
        busy: !!s?.busy,
        lastSync: Math.max(0, ...(s?.peers || []).map((p) => p.lastSync || 0)),
      };
    },
    get busy() {
      return actionBusy || !!controller?.state().busy;
    },
  };
})();
