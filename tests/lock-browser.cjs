/* The real first-run, unlock, recovery, auto-lock and upgrade screens, in a phone-sized browser. */
const { chromium } = require("playwright"), http = require("http"), fs = require("fs"), path = require("path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../www"), PIN = "907264";
const server = http.createServer((req, res) => {
  let f = path.join(root, new URL(req.url, "http://localhost").pathname);
  if (f === root + path.sep) f = path.join(root, "index.html");
  fs.readFile(f, (e, d) => { if (e) return res.writeHead(404).end(); res.setHeader("Content-Type", f.endsWith(".js") ? "application/javascript" : f.endsWith(".html") ? "text/html" : "application/octet-stream"); res.end(d); });
});
const shot = (p, n) => (fs.mkdirSync("test-artifacts", { recursive: true }), p.screenshot({ path: "test-artifacts/lock-" + n + ".png" }));
const set = async (p, pin = PIN) => { await p.locator("#pin-new").fill(pin); await p.locator("#pin-confirm").fill(pin); await p.locator("#pin-next").click(); };
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ headless: true });
  const fresh = async () => { const c = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 800 } }), p = await c.newPage(), errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept()); await p.route("**/*", (r) => new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort()); await p.goto(url); return { c, p, errors }; };
  try {
    // New user: PIN and code come before the first record.
    const { p, errors } = await fresh();
    await p.getByRole("button", { name: "Start fresh", exact: true }).click();
    await shot(p, "0-tour"); await p.locator("#tour-next").click(); await p.locator("#tour-back").click(); await p.locator("#tour-skip").click();
    await p.locator("#pin-new").fill("123456"); await p.locator("#pin-confirm").fill("123456"); await p.locator("#pin-next").click();
    await p.getByText("too easy to guess").waitFor();
    await p.locator("#pin-new").fill(PIN); await p.locator("#pin-confirm").fill("907265"); await p.locator("#pin-next").click();
    await p.getByText("do not match").waitFor();
    await shot(p, "1-pin");
    await set(p);
    const code = await p.locator("#pin-code-show").textContent();
    assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
    assert.equal(await p.locator("#pin-finish").isDisabled(), true);
    await shot(p, "2-code");
    await p.locator("#pin-got").check(); await p.locator("#pin-finish").click();
    await p.locator("#ob-name").fill("Main savings"); await p.locator("#ob-balance").fill("5000");
    await p.getByRole("button", { name: "Next: income & spending", exact: true }).click();
    await p.locator("#ob-income").fill("100000"); await p.locator("#ob-expense").fill("120000");
    await p.getByRole("button", { name: "Create my plan", exact: true }).click();
    await p.getByText("Your forecast is ready").waitFor();
    await p.getByText("your cash is lowest in").waitFor(); await shot(p, "5-forecast");
    await p.locator("#want-loans").check(); await p.getByRole("button", { name: "Continue", exact: true }).click();
    await p.getByText("Set up Family Money: 0 of 5 done").waitFor(); await shot(p, "6-home");
    // Skip counts, adding an account does not reset progress, and a step ticks itself.
    await p.getByRole("button", { name: "Skip", exact: true }).click();
    await p.getByText("Set up Family Money: 1 of 5 done").waitFor();
    await p.getByText("Add your regular income and bills").waitFor();
    await p.getByRole("button", { name: "Start", exact: true }).click();
    await p.getByText("This is your monthly plan").waitFor();
    await p.getByRole("button", { name: "Got it", exact: true }).click();
    await p.getByText("This is your monthly plan").waitFor({ state: "detached" });
    await p.getByRole("tab", { name: "More", exact: true }).click(); await p.getByRole("heading", { name: "Safety and help" }).waitFor();
    await p.screenshot({ path: "test-artifacts/lock-7-more.png", fullPage: true });
    await p.getByRole("button", { name: "Accounts & backup", exact: true }).click();
    await p.locator('[data-act="addacc"]').click();
    await p.getByRole("tab", { name: "Home", exact: true }).click();
    await p.getByText("Set up Family Money: 1 of 5 done").waitFor();
    await p.getByRole("button", { name: "Hide", exact: true }).click();
    await p.getByText("Set up Family Money").waitFor({ state: "detached" });
    await p.getByRole("tab", { name: "More", exact: true }).click();
    await p.getByRole("button", { name: "Setup guide & user manual", exact: true }).click();
    await p.getByRole("tab", { name: "Home", exact: true }).click();
    await p.getByText("Set up Family Money: 1 of 5 done").waitFor();
    await p.getByRole("tab", { name: "More", exact: true }).click();
    await p.getByRole("button", { name: "All tools", exact: true }).click().catch(() => {});
    await p.getByRole("button", { name: "Take the tour", exact: true }).click();
    assert.equal(await p.locator("#tour-step").textContent(), "1 of 6");
    for (let i = 0; i < 6; i++) await p.locator("#tour-next").click();
    await p.locator("#tour-root").waitFor({ state: "detached" });
    await p.getByRole("tab", { name: "Home", exact: true }).click();
    await p.getByText("Main savings").first().waitFor();
    await p.evaluate(() => __cashbookLocal.flush());
    assert.doesNotMatch(await p.evaluate(() => localStorage.getItem("family-cashbook-data.json")), /Main savings/);
    // Reopen: wrong PIN, then right PIN.
    await p.reload(); await p.locator("#pin-entry").fill("000111"); await p.locator("#pin-open").click();
    await p.getByText("That PIN is not right").waitFor(); await shot(p, "3-unlock");
    await p.locator("#pin-entry").fill(PIN); await p.locator("#pin-open").click();
    await p.locator("#lock-root").waitFor({ state: "detached" }); await p.getByText("Main savings").first().waitFor();
    // Forgot PIN: the code opens it and asks for a new PIN.
    await p.reload(); await p.locator("#pin-forgot").click();
    await p.locator("#pin-recover").fill("AAAAA-AAAAA-AAAAA-AAAAA-AAAAA"); await p.locator("#pin-recover-go").click();
    await p.getByText("did not open your records").waitFor();
    await p.locator("#pin-recover").fill(code.toLowerCase()); await p.locator("#pin-recover-go").click();
    await set(p, "482915"); await p.locator("#lock-root").waitFor({ state: "detached" });
    // Settings: change PIN, auto-lock, lock now.
    await p.getByRole("tab", { name: "More", exact: true }).click();
    await p.getByRole("button", { name: "PIN, recovery code and lock", exact: true }).click();
    await p.getByText("Your records are encrypted on this device").waitFor(); await shot(p, "4-settings");
    await p.locator("#sec-autolock").selectOption("0");
    await p.waitForFunction(() => __cashbookLocal.lockInfo().autolock === 0);
    await p.getByRole("button", { name: "Change PIN", exact: true }).click();
    await p.locator("#pin-now").fill("111222"); await p.locator("#pin-new").fill(PIN); await p.locator("#pin-confirm").fill(PIN); await p.locator("#pin-next").click();
    await p.getByText("current PIN is not right").waitFor();
    await p.locator("#pin-now").fill("482915"); await p.locator("#pin-next").click();
    await p.locator("#lock-root").waitFor({ state: "detached" });
    // Leaving the app locks it, unless a share or file picker is open.
    const leave = () => p.evaluate(() => { const v = (s) => Object.defineProperty(document, "visibilityState", { value: s, configurable: true }); v("hidden"); document.dispatchEvent(new Event("visibilitychange")); return new Promise((r) => setTimeout(() => { v("visible"); document.dispatchEvent(new Event("visibilitychange")); r(); }, 20)); });
    await p.evaluate(() => __cashbookLocal.holdFor(5000)); await leave(); await p.waitForTimeout(300);
    assert.equal(await p.locator("#pin-entry").count(), 0); await p.evaluate(() => __cashbookLocal.holdFor(0));
    await leave(); await p.locator("#pin-entry").waitFor();
    await p.locator("#pin-entry").fill(PIN); await p.locator("#pin-open").click(); await p.locator("#lock-root").waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    // An older plain ledger is upgraded on opening, with nothing lost.
    const old = await fresh();
    await old.p.evaluate(() => localStorage.setItem("family-cashbook-data.json", JSON.stringify({ app: "family-cashbook", version: 2, docs: { "settings/main": { start: "2026-01", end: "2027-12", currency: "INR" }, "accounts/a": { name: "Old savings", opening: 900, min: 0, kind: "Savings", order: 0 } }, times: {}, tomb: {}, fieldMeta: {}, conflicts: {} })));
    await old.p.reload(); await old.p.locator("#pin-new").waitFor();
    await set(old.p); await old.p.getByText("Backups you saved earlier").waitFor();
    await old.p.reload();
    assert.match(await old.p.evaluate(() => localStorage.getItem("family-cashbook-data.json")), /Old savings/, "closing before Finish changes nothing");
    await set(old.p); const liveCode = await old.p.locator("#pin-code-show").textContent(); await old.p.locator("#pin-got").check(); await old.p.locator("#pin-finish").click();
    await old.p.locator("#lock-root").waitFor({ state: "detached" }); await old.p.getByText("Old savings").first().waitFor();
    await old.p.evaluate(() => __cashbookLocal.flush());
    assert.doesNotMatch(await old.p.evaluate(() => localStorage.getItem("family-cashbook-data.json")), /Old savings/);
   
    // Restore on a new device with the code, then choose a PIN.
    const backup = await old.p.evaluate(async () => { let t; const c = URL.createObjectURL; URL.createObjectURL = (b) => { t = b; return c.call(URL, b); }; await __cashbookLocal.exportData(); URL.createObjectURL = c; return t.text(); });
    assert.ok(JSON.parse(backup).keyId);
    const code2 = await old.p.evaluate(() => __cashbookLocal.lockInfo().keyId); assert.equal(JSON.parse(backup).keyId, code2);
    assert.deepEqual(old.errors, []);
    const next = await fresh();
    await next.p.getByRole("button", { name: "Restore a backup", exact: true }).click();
    await next.p.locator("#guide-backup").setInputFiles({ name: "family-money-backup.json", mimeType: "application/json", buffer: Buffer.from(backup) });
    await next.p.locator("#guide-pass").fill("AAAAA-AAAAA-AAAAA-AAAAA-AAAAA");
    await next.p.getByRole("button", { name: "Review backup", exact: true }).click();
    await next.p.getByText("needs the recovery code with ID " + code2).first().waitFor();
    await next.p.locator("#guide-pass").fill(liveCode.toLowerCase());
    await next.p.getByRole("button", { name: "Review backup", exact: true }).click();
    await next.p.locator("#guide-replace-ok").check();
    await next.p.getByRole("button", { name: "Restore this backup", exact: true }).click();
    await next.p.getByText("Choose a PIN").waitFor(); await set(next.p);
    await next.p.locator("#lock-root").waitFor({ state: "detached" });
    await next.p.getByText("Old savings").first().waitFor();
    await next.p.reload(); await next.p.locator("#pin-entry").fill(PIN); await next.p.locator("#pin-open").click();
    await next.p.locator("#lock-root").waitFor({ state: "detached" }); await next.p.getByText("Old savings").first().waitFor();
    assert.deepEqual(next.errors, []);
    // A foreign account with no rate keeps Home and Net worth on screen, with a warning.
    const fx = await fresh();
    await fx.c.addInitScript(() => { window.CASHBOOK_TEST_SKIP_PIN = true; });
    await fx.p.evaluate(() => localStorage.setItem("family-cashbook-data.json", JSON.stringify({ app: "family-cashbook", version: 2, docs: { "settings/main": { start: "2026-01", end: "2027-12", currency: "INR" }, "accounts/a": { name: "Home savings", opening: 900, min: 0, kind: "Savings", order: 0 }, "fxAccounts/u": { name: "US account", currency: "USD", kind: "bank", opened: "2026-01-01", opening: 100, openingRateToINR: 83 } }, times: {}, tomb: {}, fieldMeta: {}, conflicts: {} })));
    await fx.p.reload();
    await fx.p.locator("#fx-warning").waitFor(); await fx.p.getByText("Foreign accounts are left out").waitFor();
    await fx.p.getByText("Home savings").first().waitFor(); await shot(fx.p, "9-rates");
    assert.equal(await fx.p.locator("#fx-warning .hint").textContent(), "Add an exchange rate for: USD");
    await fx.p.locator('#fx-warning [data-feature="currency"]').click();
    await fx.p.getByText("Multi-currency accounts").first().waitFor();
    assert.deepEqual(fx.errors, []);
    // Reminders: asked for in setup, scheduled without amounts, off again cleanly.
    const rem = await fresh();
    await rem.p.addInitScript(() => { window.__sent = []; window.CASHBOOK_TEST_NOTIFY = { checkPermissions: async () => ({ display: "prompt" }), requestPermissions: async () => ({ display: "granted" }), getPending: async () => ({ notifications: [] }), cancel: async () => {}, schedule: async ({ notifications }) => { window.__sent.push(...notifications); } }; });
    await rem.p.reload();
    await rem.p.getByRole("button", { name: "Start fresh", exact: true }).click(); await rem.p.locator("#tour-skip").click(); await set(rem.p); await rem.p.locator("#pin-got").check(); await rem.p.locator("#pin-finish").click();
    await rem.p.locator("#ob-name").waitFor(); await rem.p.getByRole("button", { name: "Next: income & spending", exact: true }).click(); await rem.p.locator("#ob-expense").fill("5000"); await rem.p.getByRole("button", { name: "Create my plan", exact: true }).click();
    await rem.p.getByRole("button", { name: "Continue", exact: true }).click();
    await rem.p.getByRole("tab", { name: "More", exact: true }).click(); await rem.p.getByRole("button", { name: "Bill reminders", exact: true }).click();
    await rem.p.getByRole("button", { name: "Household budget", exact: true }).click(); await rem.p.locator("#due-day").fill("28"); await rem.p.getByRole("button", { name: "Save", exact: true }).click();
    await rem.p.getByText("Bills without a due day").waitFor({ state: "detached" });
    await rem.p.getByRole("button", { name: "Turn on reminders", exact: true }).click(); await rem.p.getByText("Reminders are on.").first().waitFor();
    await rem.p.waitForFunction(() => window.__sent.length > 0);
    const sent = await rem.p.evaluate(() => window.__sent); assert.ok(sent.every((n) => n.title.startsWith("Household budget: due ") && !/5,?000/.test(n.title + n.body)));
    await shot(rem.p, "8-reminders"); assert.deepEqual(rem.errors, []);
    console.log("PIN first run, unlock, recovery, settings, auto-lock and upgrade flows passed.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
