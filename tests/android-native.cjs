/* Runs only against a fresh debug preview installation on the selected emulator/device. */
const { _android } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
(async () => {
  const [device] = await _android.devices();
  if (!device) throw Error("No adb device is connected.");
  const pkg = "com.familycashbook.preview";
  fs.mkdirSync("test-artifacts", { recursive: true });
  let activePage;
  try {
    await device.shell("am force-stop " + pkg);
    await device.shell("am start -n " + pkg + "/.MainActivity");
    const view = await device.webView({ pkg });
    const page = await view.page();
    activePage = page;
    await page
      .getByRole("button", { name: "Start a new ledger", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Start a new ledger", exact: true })
      .click();
    await page.locator("#pin-new").fill("907264");
    await page.locator("#pin-confirm").fill("907264");
    await page.locator("#pin-next").click();
    await page.locator("#pin-got").check();
    await page.locator("#pin-finish").click();
    await page.locator("#ob-name").fill("Native synthetic account");
    await page.locator("#ob-balance").fill("5000");
    await page
      .getByRole("button", { name: "Next: income & spending", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create my plan", exact: true })
      .click();
    await page.waitForFunction(
      () => window.__cashbookLocal.encrypted && !window.CashbookUI.busy,
    );
    await page.evaluate(() => window.__cashbookLocal.flush());
    await device.shell("am force-stop " + pkg);
    await device.shell("am start -n " + pkg + "/.MainActivity");
    const again = await device.webView({ pkg }),
      reopened = await again.page();
    activePage = reopened;
        await reopened.locator("#pin-entry").fill("907264");
    await reopened.locator("#pin-open").click();
    await reopened.waitForFunction(
      () => !window.__cashbookLocal.locked && !window.CashbookUI.busy,
    );
    await reopened.locator("#pin-entry").waitFor({ state: "hidden" });
    const restored = await reopened.evaluate(() =>
      window.__cashbookLocal.getSnapshot(),
    );
    assert.ok(
      Object.entries(restored.docs).some(
        ([key, value]) =>
          key.startsWith("accounts/") &&
          value.name === "Native synthetic account",
      ),
    );
    await reopened.getByRole("tab", { name: "Home", exact: true }).click();
    await reopened
      .getByText("Native synthetic account", { exact: true })
      .waitFor();
    assert.equal(await reopened.getByRole("tab").count(), 4);
    await reopened.screenshot({
      path: "test-artifacts/android-native-reopen.png",
      fullPage: true,
    });
    console.log(
      "Android native filesystem/encryption/kill/reopen smoke passed. No store purchase or messaging delivery was tested.",
    );
  } catch (error) {
    if (activePage) {
      console.error(
        "Native UI diagnostic",
        await activePage
          .evaluate(() => ({
            locked: window.__cashbookLocal?.locked,
            busy: window.CashbookUI?.busy,
            toast: document.querySelector("#toast")?.textContent,
            view: document.querySelector("#view")?.innerText,
          }))
          .catch(() => ({ unavailable: true })),
      );
      await activePage
        .screenshot({
          path: "test-artifacts/android-native-failure.png",
          fullPage: true,
        })
        .catch(() => {});
    }
    throw error;
  } finally {
    await device.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
