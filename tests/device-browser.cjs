/* Two browser profiles exercise the personal companion against a synthetic Drive endpoint. */
const { chromium } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../www");
let remote = null,
  version = 0,
  uploads = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost"),
    file = path.resolve(
      root,
      "." + (url.pathname === "/" ? "/index.html" : url.pathname),
    );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".html")
          ? "text/html"
          : "application/octet-stream",
    );
    res.end(data);
  });
});
const seed = {
  app: "family-cashbook",
  version: 2,
  docs: {
    "settings/main": { start: "2026-01", end: "2026-12" },
    "accounts/bank": { name: "Test bank", opening: 10000, kind: "Savings" },
    "categories/food": {
      name: "Food",
      type: "expense",
      account: "bank",
      amounts: {},
    },
  },
  times: {},
};
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true });
  try {
    const origin = "http://127.0.0.1:" + server.address().port,
      contexts = [],
      errors = [];
    async function profile(mobile, initial) {
      const context = await browser.newContext({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
        serviceWorkers: "block",
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("dialog", (d) => d.accept());
      await page.addInitScript((initial) => {
        if (initial && !localStorage.getItem("test-seed")) {
          localStorage.setItem(
            "family-cashbook-data.json",
            JSON.stringify(initial),
          );
          localStorage.setItem("test-seed", "1");
        }
        window.google = {
          accounts: {
            oauth2: {
              initTokenClient: (options) => ({
                requestAccessToken: () =>
                  options.callback({
                    access_token: "fake-browser-token",
                    expires_in: 3600,
                  }),
              }),
            },
          },
        };
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (window.failNextLocalSave && key === "family-cashbook-data.json") {
            window.failNextLocalSave = false;
            throw Error("Synthetic disk error");
          }
          return original.call(this, key, value);
        };
      }, initial);
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/config.js" && url.origin === origin)
          return route.fulfill({
            contentType: "application/javascript",
            body: 'window.CASHBOOK_CONFIG={googleWebClientId:"synthetic-browser-client"};',
          });
        if (url.hostname === "www.googleapis.com") {
          if (url.pathname.endsWith("/about"))
            return route.fulfill({
              json: {
                user: {
                  permissionId: "same-owner",
                  emailAddress: "synthetic@example.invalid",
                },
              },
            });
          if (url.searchParams.has("q"))
            return route.fulfill({
              json: { files: remote ? [{ id: "shared-ledger" }] : [] },
            });
          if (url.searchParams.get("alt") === "media")
            return route.fulfill({
              contentType: "application/json",
              body: remote,
              headers: {
                ETag: '"' + version + '"',
                "Access-Control-Expose-Headers": "ETag",
              },
            });
          if (route.request().method() === "POST") {
            const pieces = route.request().postData().split("\r\n\r\n");
            remote = pieces[2].split("\r\n--")[0];
          } else if (route.request().method() === "PATCH") {
            assert.equal(
              route.request().headers()["if-match"],
              '"' + version + '"',
            );
            remote = route.request().postData();
          } else throw Error("Unexpected cloud request");
          assert.equal(JSON.parse(remote).app, "family-cashbook-encrypted");
          uploads++;
          version++;
          return route.fulfill({ json: { id: "shared-ledger", version } });
        }
        if (url.origin === origin) return route.continue();
        return route.abort();
      });
      await page.goto(origin);
      await page.getByRole("tab", { name: "Home", exact: true }).waitFor();
      return page;
    }
    const pass = "shared browser test passphrase",
      laptop = await profile(false, seed);
    await laptop.getByRole("tab", { name: "More", exact: true }).click();
    await laptop
      .getByRole("button", { name: "Phone & laptop sync", exact: true })
      .click();
    async function encrypt(page) {
      await page.locator("#device-pass").fill(pass);
      await page.locator("#device-confirm").fill(pass);
      await page
        .getByRole("button", {
          name: "Enable encrypted device sync",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Connect my Google account", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Connect my Google account", exact: true })
        .click();
      await page.waitForFunction(
        () => window.__cashbookLocal.drive.status === "synced",
      );
    }
    await encrypt(laptop);
    const phone = await profile(true, null);
    await phone
      .getByRole("button", { name: "Phone & laptop sync", exact: true })
      .click();
    await encrypt(phone);
    await phone.locator("#modal").evaluate((el) => (el.innerHTML = ""));
    await phone.getByRole("tab", { name: "Home", exact: true }).click();
    await phone.evaluate(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => false,
      });
    });
    await phone
      .getByRole("button", { name: "Quick transaction", exact: true })
      .click();
    assert.equal(await phone.locator("#e-amt").inputValue(), "");
    await phone.locator("#e-cat").selectOption("food");
    await phone.locator("#e-amt").fill("125");
    await phone.locator("#e-note").fill("Offline mobile purchase");
    await phone.evaluate(() => (window.failNextLocalSave = true));
    await phone.getByRole("button", { name: "Save", exact: true }).click();
    await phone.waitForFunction(() => !window.failNextLocalSave);
    await phone.getByRole("button", { name: "Save", exact: true }).click();
    await phone.locator("#e-amt").waitFor({ state: "hidden" });
    await phone.reload();
    await phone.locator("#unlock-pass").fill(pass);
    await phone.getByRole("button", { name: "Unlock", exact: true }).click();
    await phone
      .getByRole("heading", { name: "Unlock Family Cashbook", exact: true })
      .waitFor({ state: "hidden" });
    await phone.locator("#sync").click();
    await phone.getByRole("button", { name: "Sync now", exact: true }).click();
    await phone
      .waitForFunction(() => window.__cashbookLocal.drive.status === "synced")
      .catch(async (error) => {
        console.error(
          "Phone reconnect",
          await phone.evaluate(() => ({
            status: __cashbookLocal.drive.status,
            error: __cashbookLocal.drive.error,
            online: navigator.onLine,
            busy: CashbookUI.busy,
            toast: document.querySelector("#toast")?.textContent,
          })),
        );
        throw error;
      });
    await laptop.getByRole("button", { name: "Sync now", exact: true }).click();
    await laptop.waitForFunction(
      () => window.__cashbookLocal.drive.status === "synced",
    );
    for (const page of [phone, laptop]) {
      const snapshot = await page.evaluate(() =>
        window.__cashbookLocal.getSnapshot(),
      );
      const entries = Object.entries(snapshot.docs).filter(([p]) =>
        p.startsWith("entries/"),
      );
      assert.equal(entries.length, 1);
      assert.equal(entries[0][1].amount, 125);
      assert.equal(entries[0][1].note, "Offline mobile purchase");
    }
    assert.ok(uploads >= 2);
    await phone.locator("#modal").evaluate((el) => (el.innerHTML = ""));
    await phone.getByRole("tab", { name: "More", exact: true }).click();
    await phone
      .getByRole("button", { name: "Phone & laptop sync", exact: true })
      .click();
    const size = await phone.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(size.scroll <= size.width + 1);
    fs.mkdirSync(path.resolve(__dirname, "../test-artifacts"), {
      recursive: true,
    });
    await phone.screenshot({
      path: path.resolve(__dirname, "../test-artifacts/mobile-device-sync.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Phone quick entry, failed-save retry, encrypted reopen and laptop sync browser flow passed (mock Drive).",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
