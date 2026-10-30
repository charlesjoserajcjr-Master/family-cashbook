const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const root = path.resolve(__dirname, "../www"),
  artifacts = path.resolve(__dirname, "../test-artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const backup = {
  app: "family-cashbook",
  version: 2,
  docs: {
    "settings/main": { start: "2026-08", end: "2028-12" },
    "accounts/old": {
      name: "Old backup account",
      opening: 5000,
      kind: "Savings",
      min: 0,
    },
    "categories/food": {
      name: "Food",
      type: "expense",
      account: "old",
      amounts: { "2026-10": 1000 },
    },
    "transfers/2026-10": { items: [] },
  },
  times: {},
  tomb: {},
};
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
  fs.readFile(file, (e, d) => {
    if (e) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".html")
          ? "text/html"
          : file.endsWith(".png")
            ? "image/png"
            : file.endsWith(".css")
              ? "text/css"
              : "application/octet-stream",
    );
    res.end(d);
  });
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      const context = await browser.newContext({
          viewport,
          hasTouch: name === "mobile",
          serviceWorkers: "block",
        }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
      const url = "http://127.0.0.1:" + server.address().port;
      await page.route("**/*", (r) =>
        new URL(r.request().url()).hostname === "127.0.0.1"
          ? r.continue()
          : r.abort(),
      );
      await page.goto(url);
      await page
        .getByRole("button", { name: "Restore a backup", exact: true })
        .click();
      await page.locator("#guide-backup").setInputFiles({
        name: "old-family-backup.backup",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(JSON.stringify(backup)),
      });
      await page
        .getByText("Plain backup detected — no passphrase is needed.", {
          exact: true,
        })
        .waitFor();
      assert.equal(await page.locator("#guide-pass-label").isVisible(), false);
      await page
        .getByRole("button", { name: "Review backup", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Backup recognized", exact: true })
        .waitFor();
      assert.equal(
        Object.keys(
          (await page.evaluate(() => __cashbookLocal.getSnapshot())).docs,
        ).length,
        0,
      );
      await page.screenshot({
        path: path.join(artifacts, name + "-plain-backup-review.png"),
        fullPage: true,
        animations: "disabled",
      });
      await page.locator("#guide-replace-ok").check();
      await page
        .getByRole("button", { name: "Restore this backup", exact: true })
        .click();
      await page.getByText("Old backup account", { exact: true }).waitFor();
      assert.equal(
        (await page.evaluate(() => __cashbookLocal.getSnapshot())).docs[
          "accounts/old"
        ].opening,
        5000,
      );
      await page
        .getByRole("button", { name: "Continue setup", exact: true })
        .click();
      await page
        .getByRole("button", { name: "I have reviewed this step", exact: true })
        .click();
      await page
        .getByText("Step 2 of 5: Review monthly income and spending", {
          exact: true,
        })
        .waitFor();
      await page
        .getByRole("button", { name: "Close guide", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: "Continue setup", exact: true })
        .click();
      await page
        .getByText("Step 2 of 5: Review monthly income and spending", {
          exact: true,
        })
        .waitFor();
      await page
        .getByRole("button", { name: "Read the full user manual", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "ReadyTrove Family Money — setup & user guide",
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: path.join(artifacts, name + "-user-manual.png"),
        fullPage: false,
        animations: "disabled",
      });
      await page
        .getByRole("button", { name: "Close manual", exact: true })
        .click();
      // A second restore offers a recovery download and does not silently overwrite on review.
      await page.getByRole("tab", { name: "More", exact: true }).click();
      await page
        .getByRole("button", { name: "Setup guide & user manual", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Restore a backup", exact: true })
        .click();
      await page.locator("#guide-backup").setInputFiles({
        name: "not-a-backup.json",
        mimeType: "application/json",
        buffer: Buffer.from("Not JSON"),
      });
      await page
        .getByRole("button", { name: "Review backup", exact: true })
        .click();
      await page
        .getByText(
          "This file is not readable backup JSON. Choose the original Family Cashbook backup, not an installer, ZIP, image or statement.",
          { exact: true },
        )
        .first()
        .waitFor();
      assert.equal(
        (await page.evaluate(() => __cashbookLocal.getSnapshot())).docs[
          "accounts/old"
        ].opening,
        5000,
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      const size = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(size.scroll <= size.width + 1);
      assert.deepEqual(errors, []);
      await context.close();
      // Fresh users get a two-step wizard without writing a partial ledger when going back.
      const fresh = await browser.newContext({
          viewport,
          serviceWorkers: "block",
        }),
        newPage = await fresh.newPage();
      await newPage.route("**/*", (r) =>
        new URL(r.request().url()).hostname === "127.0.0.1"
          ? r.continue()
          : r.abort(),
      );
      await newPage.goto(url);
      await newPage
        .getByRole("button", { name: "Start a new ledger", exact: true })
        .click();
      await newPage.locator("#ob-name").fill("Fresh account");
      await newPage.locator("#ob-balance").fill("2000");
      await newPage
        .getByRole("button", { name: "Next: income & spending", exact: true })
        .click();
      await newPage.locator("#ob-income").fill("3000");
      await newPage.locator("#ob-expense").fill("1000");
      await newPage.getByRole("button", { name: "Back", exact: true }).click();
      assert.equal(
        Object.keys(
          (await newPage.evaluate(() => __cashbookLocal.getSnapshot())).docs,
        ).length,
        0,
      );
      assert.equal(
        await newPage.locator("#ob-name").inputValue(),
        "Fresh account",
      );
      await newPage
        .getByRole("button", { name: "Next: income & spending", exact: true })
        .click();
      await newPage
        .getByRole("button", { name: "Create my plan", exact: true })
        .click();
      await newPage.getByText("Fresh account", { exact: true }).waitFor();
      await newPage
        .getByRole("button", { name: "Continue setup", exact: true })
        .click();
      await newPage.screenshot({
        path: path.join(artifacts, name + "-guided-setup.png"),
        fullPage: false,
        animations: "disabled",
      });
      await fresh.close();
      console.log(
        name +
          " plain backup restore, review-only safety, resumable setup, manual and fresh wizard passed.",
      );
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
