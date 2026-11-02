/* Deliberately opaque LAN relay: never receives ledger keys or plaintext records.
   Only explicit app activation opens a listener. No static pages, CORS or redirects. */
"use strict";
const http = require("node:http"),
  os = require("node:os"),
  { randomUUID } = require("node:crypto");
function privateIP(ip) {
  const a = String(ip)
    .replace(/^::ffff:/, "")
    .split(".")
    .map(Number);
  return (
    a.length === 4 &&
    (a[0] === 10 ||
      (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
      (a[0] === 192 && a[1] === 168))
  );
}
function addresses() {
  return [
    ...new Set(
      Object.values(os.networkInterfaces())
        .flat()
        .filter(
          (x) =>
            x && x.family === "IPv4" && !x.internal && privateIP(x.address),
        )
        .map((x) => x.address),
    ),
  ];
}
function createRelay(
  deliver,
  { timeout = 90000, allowLoopback = false, port = 49152 } = {},
) {
  let server = null;
  const pending = new Map(),
    rates = new Map();
  const reply = (res, status, body) => {
    if (res.destroyed || res.writableEnded) return;
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Connection: "close",
    });
    res.end(data);
  };
  function respond(id, value) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimeout(p.timer);
    reply(p.res, value ? 200 : 403, value || { error: "Request rejected" });
    return true;
  }
  async function start() {
    if (server) return { port: server.address().port, addresses: addresses() };
    server = http.createServer(async (req, res) => {
      const ip = req.socket.remoteAddress?.replace(/^::ffff:/, "");
      if (
        (!privateIP(ip) && !(allowLoopback && ip === "127.0.0.1")) ||
        req.headers.origin ||
        req.method !== "POST" ||
        !["/v1/challenge", "/v1/message"].includes(req.url) ||
        !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
      ) {
        reply(res, 403, { error: "Local app requests only" });
        return;
      }
      const now = Date.now();
      for (const [k, v] of rates) if (now - v.start > 60000) rates.delete(k);
      const rate = rates.get(ip) || { start: now, n: 0 };
      rate.n++;
      rates.set(ip, rate);
      if (rate.n > 60 || pending.size >= 8) {
        reply(res, 429, { error: "Try again shortly" });
        return;
      }
      let body = "",
        size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 42 * 1024 * 1024) {
            reply(res, 413, { error: "Transfer too large" });
            req.destroy();
            return;
          }
          body += chunk.toString("utf8");
        }
        const value = JSON.parse(body);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw Error();
        const id = randomUUID(),
          timer = setTimeout(() => respond(id, null), timeout);
        pending.set(id, { res, timer });
        res.on("close", () => {
          const p = pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(id);
          }
        });
        deliver({ id, route: req.url, body: value });
      } catch {
        reply(res, 400, { error: "Invalid request" });
      }
    });
    server.headersTimeout = 10000;
    server.requestTimeout = 30000;
    server.maxConnections = 16;
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", resolve);
      });
    } catch (e) {
      server = null;
      throw e;
    }
    return { port: server.address().port, addresses: addresses() };
  }
  async function stop() {
    for (const id of [...pending.keys()]) respond(id, null);
    rates.clear();
    if (server) {
      const s = server;
      server = null;
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
  }
  return { start, stop, respond };
}
module.exports = { createRelay, addresses, privateIP };
