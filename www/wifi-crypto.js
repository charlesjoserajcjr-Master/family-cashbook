/* Local Wi-Fi protocol v1. WebCrypto primitives; no network or storage side effects.
   QR = short-lived 256-bit pairing capability. Every request has a fresh P-256
   ECDH challenge; HKDF binds it to the capability and challenge transcript.
   AES-GCM authenticates direction and transcript. Host consumes challenges once. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CashbookWifiCrypto = api;
})(globalThis, () => {
  "use strict";
  const enc = new TextEncoder(),
    dec = new TextDecoder(),
    MAX = 30 * 1024 * 1024;
  function b64(bytes) {
    let s = "";
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function bytes(s, size) {
    if (
      typeof s !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(s) ||
      s.length > MAX * 1.4
    )
      throw Error("Invalid encrypted message.");
    const a = Uint8Array.from(
      atob(s.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    if (size && a.length !== size) throw Error("Invalid key or nonce.");
    return a;
  }
  const random = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)));
  function privateIPv4(host) {
    const p = String(host).split(".");
    if (
      p.length !== 4 ||
      p.some(
        (x) =>
          !/^\d{1,3}$/.test(x) || String(Number(x)) !== x || Number(x) > 255,
      )
    )
      return false;
    const a = p.map(Number);
    return (
      a[0] === 10 ||
      (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
      (a[0] === 192 && a[1] === 168)
    );
  }
  function endpoint(value) {
    const u = new URL(value);
    if (
      u.protocol !== "http:" ||
      !privateIPv4(u.hostname) ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      !u.port ||
      Number(u.port) < 1024
    )
      throw Error("Use a QR code from your laptop on a private Wi-Fi network.");
    return u.origin;
  }
  function parseQR(text, now = Date.now()) {
    if (
      typeof text !== "string" ||
      text.length > 1800 ||
      !text.startsWith("readytrove-pair:")
    )
      throw Error("This is not a ReadyTrove pairing QR code.");
    let q;
    try {
      q = JSON.parse(dec.decode(bytes(text.slice(16))));
    } catch {
      throw Error("The pairing QR code is damaged.");
    }
    if (
      q.v !== 1 ||
      !Number.isSafeInteger(q.expires) ||
      q.expires <= now ||
      q.expires > now + 125000
    )
      throw Error(
        "This pairing QR code expired. Show a new code on the laptop.",
      );
    bytes(q.id, 16);
    bytes(q.secret, 32);
    q.endpoint = endpoint(q.endpoint);
    return q;
  }
  function qr(q) {
    return "readytrove-pair:" + b64(enc.encode(JSON.stringify(q)));
  }
  async function ephemeral() {
    const keys = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    return {
      privateKey: keys.privateKey,
      publicKey: b64(await crypto.subtle.exportKey("raw", keys.publicKey)),
    };
  }
  function transcript(challenge, clientPublic) {
    bytes(challenge.id, 16);
    bytes(challenge.nonce, 32);
    bytes(challenge.publicKey, 65);
    bytes(clientPublic, 65);
    return JSON.stringify([
      "readytrove-wifi-v1",
      challenge.id,
      challenge.nonce,
      challenge.publicKey,
      clientPublic,
    ]);
  }
  async function derive(secret, privateKey, remotePublic, context) {
    const pub = await crypto.subtle.importKey(
      "raw",
      bytes(remotePublic, 65),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const shared = await crypto.subtle.deriveBits(
      { name: "ECDH", public: pub },
      privateKey,
      256,
    );
    const material = await crypto.subtle.importKey(
      "raw",
      shared,
      "HKDF",
      false,
      ["deriveBits"],
    );
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: bytes(secret, 32),
          info: enc.encode(context),
        },
        material,
        256,
      ),
    );
  }
  async function seal(key, context, direction, value) {
    const plain = enc.encode(JSON.stringify(value));
    if (plain.length > MAX)
      throw Error("Sync exceeds the local transfer size limit.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
      "encrypt",
    ]);
    const cipher = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: enc.encode(context + "|" + direction),
      },
      k,
      plain,
    );
    return { iv: b64(iv), data: b64(cipher) };
  }
  async function open(key, context, direction, packet) {
    const iv = bytes(packet?.iv, 12),
      data = bytes(packet?.data);
    if (data.length > MAX + 16)
      throw Error("Sync exceeds the local transfer size limit.");
    try {
      const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
        "decrypt",
      ]);
      return JSON.parse(
        dec.decode(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv,
              additionalData: enc.encode(context + "|" + direction),
            },
            k,
            data,
          ),
        ),
      );
    } catch {
      throw Error("Device authentication failed. Nothing was synced.");
    }
  }
  async function code(key, context) {
    const h = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array([...key, ...enc.encode(context + "|verify")]),
      ),
    );
    return String(new DataView(h.buffer).getUint32(0) % 1000000).padStart(
      6,
      "0",
    );
  }
  return {
    MAX,
    b64,
    bytes,
    random,
    privateIPv4,
    endpoint,
    parseQR,
    qr,
    ephemeral,
    transcript,
    derive,
    seal,
    open,
    code,
  };
});
