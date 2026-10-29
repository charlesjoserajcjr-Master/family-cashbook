const { chromium } = require("playwright"),
  http = require("http"),
  fs = require("fs"),
  path = require("path");
const root = path.resolve(__dirname, "../www");
const server = http.createServer((req, res) => {
  let f = path.join(root, new URL(req.url, "http://localhost").pathname);
  if (f === root + path.sep) f = path.join(root, "index.html");
  fs.readFile(f, (e, d) => {
    if (e) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      f.endsWith(".js")
        ? "application/javascript"
        : f.endsWith(".html")
          ? "text/html"
          : "application/octet-stream",
    );
    res.end(d);
  });
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      hasTouch: true,
    });
    await context.addInitScript(() => {
      window.cashbookDesktop = {
        read: async () => localStorage.getItem("native-test-data"),
        write: async (text) => localStorage.setItem("native-test-data", text),
        onBeforeClose() {},
        closeReady() {},
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
    await page.route("**/*", (r) =>
      new URL(r.request().url()).hostname === "127.0.0.1"
        ? r.continue()
        : r.abort(),
    );
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page
      .getByRole("button", { name: "Start a new ledger", exact: true })
      .click();
    await page.locator("#ob-name").fill("Native synthetic account");
    await page.locator("#ob-balance").fill("5000");
    await page
      .getByRole("button", { name: "Create my plan", exact: true })
      .click();
    await page.getByRole("tab", { name: "More", exact: true }).click();
    await page
      .getByRole("button", { name: "Privacy & encrypted backups", exact: true })
      .click();
    await page.locator("#sec-ledger").fill("native test passphrase 123");
    await page
      .locator("#sec-ledger-confirm")
      .fill("native test passphrase 123");
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", {
        name: "Enable working-ledger encryption",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () => __cashbookLocal.encrypted && !CashbookUI.busy,
    );
    await page.reload();
    await page.locator("#unlock-pass").fill("native test passphrase 123");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await page
      .getByText("Native synthetic account", { exact: true })
      .waitFor({ timeout: 5000 })
      .catch(async (e) => {
        console.log(await page.locator("body").innerText());
        throw e;
      });
    console.log("Minimal native-shaped onboarding/reopen browser passed");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
