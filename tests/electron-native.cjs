const { _electron } = require('playwright'),
  path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
(async () => {
  const testDir = path.resolve('test-artifacts/electron-profile');
  fs.mkdirSync(testDir, { recursive: true });
  const exe = require(path.resolve('desktop/node_modules/electron'));
  let app = await _electron.launch({
    executablePath: exe,
    args: [path.resolve('desktop')],
    env: {
      ...process.env,
      CASHBOOK_TEST_MODE: '1',
      CASHBOOK_TEST_DATA_DIR: testDir
    }
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole('button', { name: 'Start a new ledger', exact: true })
      .click();
    await page.locator('#ob-name').fill('Desktop synthetic account');
    await page.locator('#ob-balance').fill('5000');
    await page
      .getByRole('button', { name: 'Create my plan', exact: true })
      .click();
    await page.getByRole('tab', { name: 'More', exact: true }).click();
    await page
      .getByRole('button', { name: 'Privacy & encrypted backups', exact: true })
      .click();
    await page.locator('#sec-ledger').fill('desktop test passphrase 123');
    await page
      .locator('#sec-ledger-confirm')
      .fill('desktop test passphrase 123');
    page.once('dialog', (d) => d.accept());
    await page
      .getByRole('button', {
        name: 'Enable working-ledger encryption',
        exact: true
      })
      .click();
    await page.waitForFunction(
      () => window.__cashbookLocal.encrypted && !window.CashbookUI.busy
    );
    await page.evaluate(() => window.__cashbookLocal.flush());
    await app.close();
    const raw = fs.readFileSync(
      path.join(testDir, 'ledger/family-cashbook-data.json'),
      'utf8'
    );
    assert.equal(JSON.parse(raw).app, 'family-cashbook-encrypted');
    assert.ok(!raw.includes('Desktop synthetic account'));
    app = await _electron.launch({
      executablePath: exe,
      args: [path.resolve('desktop')],
      env: {
        ...process.env,
        CASHBOOK_TEST_MODE: '1',
        CASHBOOK_TEST_DATA_DIR: testDir
      }
    });
    const reopened = await app.firstWindow();
    await reopened.locator('#unlock-pass').fill('desktop test passphrase 123');
    await reopened.getByRole('button', { name: 'Unlock', exact: true }).click();
    await reopened.getByRole('tab', { name: 'Home', exact: true }).click();
    await reopened
      .getByText('Desktop synthetic account', { exact: true })
      .waitFor();
    await reopened.screenshot({
      path: 'test-artifacts/windows-native-reopen.png',
      fullPage: true
    });
    console.log('Electron native file/encryption/close/reopen smoke passed.');
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
