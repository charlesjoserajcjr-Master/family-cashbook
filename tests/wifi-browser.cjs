/* Actual QR image decode, two isolated profiles, production crypto and real relay.
   Only OS camera/file/socket bridges are simulated; no Google/network service. */
const { chromium } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict"),
  jsQR = require("jsqr"),
  { PNG } = require("pngjs");
const { createRelay } = require("../desktop/wifi-relay.cjs");
const root = path.resolve(__dirname, "../www"),
  out = path.resolve(__dirname, "../test-artifacts");
fs.mkdirSync(out, { recursive: true });
const seed = {
  app: "family-cashbook",
  version: 2,
  docs: {
    "settings/main": { start: "2026-01", end: "2026-12" },
    "accounts/bank": { name: "Preview bank", opening: 1000 },
    "categories/food": {
      name: "Food",
      type: "expense",
      account: "bank",
      amounts: {},
    },
  },
  times: {},
};
const server = http.createServer((req, res) => {
  const name = path.resolve(
    root,
    "." + (req.url === "/" ? "/index.html" : req.url.split("?")[0]),
  );
  if (!name.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(name, (e, data) => {
    if (e) res.writeHead(404).end();
    else {
      res.setHeader(
        "Content-Type",
        name.endsWith(".js")
          ? "text/javascript"
          : name.endsWith(".html")
            ? "text/html"
            : "application/octet-stream",
      );
      res.end(data);
    }
  });
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true }),
    contexts = [],
    errors = [];
  let laptop,
    phone,
    port,
    scanned = "";
  const hostDisk = new Map([["data", JSON.stringify(seed)]]),
    phoneDisk = new Map();
  const relay = createRelay(
    (msg) => {
      laptop
        .evaluate((value) => window.__wifiRequest(value), msg)
        .catch(() => relay.respond(msg.id, null));
    },
    { allowLoopback: true, port: 0 },
  );
  try {
    async function profile(isPhone) {
      const context = await browser.newContext({
        viewport: isPhone
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1100 },
        serviceWorkers: "block",
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
      const disk = isPhone ? phoneDisk : hostDisk;
      await page.exposeFunction("testRead", (key) => disk.get(key) ?? null);
      await page.exposeFunction("testWrite", (key, value) => {
        if (value === null) disk.delete(key);
        else disk.set(key, value);
        return true;
      });
      await page.exposeFunction("testStart", async () => {
        const r = await relay.start();
        port = r.port;
        return { addresses: ["192.168.10.2"], port };
      });
      await page.exposeFunction("testStop", () => relay.stop());
      await page.exposeFunction("testReply", (id, value) =>
        relay.respond(id, value),
      );
      await page.exposeFunction("testScan", () => scanned);
      await page.exposeFunction(
        "testRequest",
        async ({ host, port: target, route, body }) => {
          assert.equal(host, "192.168.10.2");
          assert.equal(target, port);
          const r = await fetch("http://127.0.0.1:" + port + route, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          if (!r.ok) throw Error("Request rejected");
          return { body: await r.text() };
        },
      );
      await page.route("**/vendor/native-plugins.js", (route) =>
        route.fulfill({ body: "", contentType: "text/javascript" }),
      );
      await page.addInitScript((isPhone) => {
        if (!isPhone) {
          window.cashbookDesktop = {
            read: () => window.testRead("data"),
            write: (text) => window.testWrite("data", text),
            readDeviceVault: () => window.testRead("vault"),
            writeDeviceVault: (text) => window.testWrite("vault", text),
            saveFile: async () => true,
            wifiStart: () => window.testStart(),
            wifiStop: () => window.testStop(),
            wifiReply: (id, value) => window.testReply(id, value),
            onWifiRequest: (fn) => (window.__wifiRequest = fn),
          };
        } else {
          window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
          window.CashbookNative = {
            Filesystem: {
              readFile: async ({ path }) => {
                const data = await window.testRead(path);
                if (data === null) throw Error("not found");
                return { data };
              },
              writeFile: ({ path, data }) => window.testWrite(path, data),
              rename: async ({ from, to }) => {
                await window.testWrite(to, await window.testRead(from));
                await window.testWrite(from, null);
              },
              deleteFile: ({ path }) => window.testWrite(path, null),
            },
          };
          window.CashbookScanner = { scan: () => window.testScan() };
          window.CashbookLocalTransport = {
            request: (opts) => window.testRequest(opts),
          };
        }
      }, isPhone);
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.getByRole("tab", { name: "Home", exact: true }).waitFor();
      return page;
    }
    laptop = await profile(false);
    phone = await profile(true);
    async function open(page) {
      if (!(await page.locator("#wifi-panel").count())) {
        await page
          .getByRole("button", { name: "Phone & laptop sync", exact: true })
          .first()
          .click();
      }
    }
    // Home shortcuts are inserted after the computed ledger is ready.
    await laptop.getByRole("tab", { name: "More", exact: true }).click();
    await open(laptop);
    await open(phone);
    for (const page of [laptop, phone]) {
      await page.locator("#wifi-pass").fill("device-specific safe passphrase");
      await page
        .locator("#wifi-confirm")
        .fill("device-specific safe passphrase");
      await page
        .getByRole("button", { name: "Protect this device", exact: true })
        .click();
      await page.locator("#wifi-pass").waitFor({ state: "detached" });
    }
    await laptop
      .getByRole("button", { name: "Connect phone · show QR", exact: true })
      .click();
    const dataURL = await (
      await laptop.waitForFunction(
        () => document.querySelector("#wifi-qr")?.getAttribute("src") || false,
      )
    ).jsonValue();
    const png = PNG.sync.read(Buffer.from(dataURL.split(",")[1], "base64")),
      decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(decoded, "QR must be decodable from the displayed image");
    scanned = decoded.data;
    assert.ok(!scanned.includes("Preview bank"));
    await laptop.screenshot({
      path: path.join(out, "wifi-laptop-qr.png"),
      animations: "disabled",
    });
    await phone
      .getByRole("button", { name: "Scan laptop QR", exact: true })
      .click();
    await laptop
      .getByRole("button", { name: "Codes match · approve", exact: true })
      .waitFor();
    const code = await laptop
      .locator("#wifi-panel p")
      .filter({ hasText: /^\d{6}$/ })
      .textContent();
    assert.equal(
      await phone
        .locator("#wifi-panel p")
        .filter({ hasText: /^\d{6}$/ })
        .textContent(),
      code,
    );
    await phone.screenshot({
      path: path.join(out, "wifi-phone-verify.png"),
      animations: "disabled",
    });
    await laptop
      .getByRole("button", { name: "Codes match · approve", exact: true })
      .click();
    await phone
      .getByRole("button", {
        name: "Codes match · finish pairing",
        exact: true,
      })
      .click();
    await phone.getByRole("button", { name: "Sync now", exact: true }).click();
    await phone.waitForFunction(
      async () =>
        !!(await window.__cashbookLocal.getSnapshot()).docs["accounts/bank"],
    );
    await phone.evaluate(async () => {
      const db = await window.claude.use("db");
      await db
        .doc("entries/mobile-offline")
        .set({
          date: "2026-11-02",
          month: "2026-11",
          categoryId: "food",
          accountId: "bank",
          amount: 87,
          note: "Synthetic phone purchase",
        });
    });
    await phone
      .getByRole("button", { name: "Sync now", exact: true })
      .waitFor({ state: "visible" });
    await phone.waitForFunction(
      () => !document.querySelector('[data-wifi="sync"]').disabled,
    );
    await phone.getByRole("button", { name: "Sync now", exact: true }).click();
    await laptop.waitForFunction(
      async () =>
        !!(await window.__cashbookLocal.getSnapshot()).docs[
          "entries/mobile-offline"
        ],
    );
    await phone.waitForFunction(
      () => !document.querySelector('[data-wifi="sync"]').disabled,
    );
    await phone.getByRole("button", { name: "Sync now", exact: true }).click();
    await phone.waitForFunction(
      () => !document.querySelector('[data-wifi="sync"]').disabled,
    );
    assert.equal(
      await laptop.evaluate(
        async () =>
          Object.keys((await window.__cashbookLocal.getSnapshot()).docs).filter(
            (p) => p.startsWith("entries/"),
          ).length,
      ),
      1,
    );
    await phone.screenshot({
      path: path.join(out, "wifi-phone-synced.png"),
      animations: "disabled",
    });
    assert.equal(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "phone layout must fit",
    );
    assert.equal(
      JSON.parse(hostDisk.get("vault")).app,
      "family-cashbook-encrypted",
    );
    assert.equal(
      JSON.parse(phoneDisk.get("family-cashbook-local-devices.json")).app,
      "family-cashbook-encrypted",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Wi-Fi browser: displayed QR decode, mutual verification, empty phone import, encrypted vaults, round-trip transaction and retry passed.",
    );
  } finally {
    await relay.stop();
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
