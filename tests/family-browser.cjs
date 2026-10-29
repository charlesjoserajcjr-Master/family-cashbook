/* Two independent browser profiles exchange signed/encrypted file attachments. Windows sandbox may use a captured-share test adapter. No messages are sent. */
const { chromium } = require('playwright'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const root = path.resolve(__dirname, '../www'),
  artifacts = path.resolve(__dirname, '../test-artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const seed = {
  app: 'family-cashbook',
  version: 2,
  docs: {
    'settings/main': { start: '2026-01', end: '2026-12' },
    'accounts/a': {
      name: 'Shared bank',
      kind: 'Savings',
      opening: 10000,
      min: 0
    },
    'accounts/private': {
      name: 'Owner secret bank',
      kind: 'Savings',
      opening: 99999,
      min: 0
    },
    'categories/food': {
      name: 'Food',
      type: 'expense',
      group: 'Household',
      account: 'a',
      amounts: { '2026-10': 1000 }
    }
  }
};
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname,
    file = path.resolve(
      root,
      '.' + (pathname === '/' ? '/index.html' : pathname)
    );
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (e, data) => {
    if (e) return res.writeHead(404).end();
    res.setHeader(
      'Content-Type',
      file.endsWith('.html')
        ? 'text/html'
        : file.endsWith('.js')
          ? 'application/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'application/octet-stream'
    );
    res.end(data);
  });
});
const working = 'test working ledger passphrase 123',
  memberPass = 'test family member key passphrase 456';
async function idle(page) {
  await page.waitForFunction(() => !window.CashbookUI.busy);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
async function tool(page, name) {
  await idle(page);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function setup(browser, url, name) {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
      serviceWorkers: 'block'
    }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (data) =>
      localStorage.setItem('family-cashbook-data.json', JSON.stringify(data)),
    seed
  );
  await page.goto(url);
  if (process.env.CASHBOOK_TEST_CAPTURE_SHARE === '1')
    await page.evaluate(() => {
      window.__cashbookLocal.shareFile = async (name, text) => {
        window.__testSharedFile = { name, text };
      };
    });
  await page.getByRole('tab', { name: 'Home', exact: true }).waitFor();
  await page.evaluate(
    async (pass) => window.__cashbookLocal.encryptLedger(pass),
    working
  );
  await tool(page, 'Encrypted family file sync');
  await page.locator('#fam-name').fill(name);
  await page.locator('#fam-password').fill(memberPass);
  await page.locator('#fam-confirm').fill(memberPass);
  await page
    .getByRole('button', { name: 'Create my member key', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Share my invitation request', exact: true })
    .waitFor();
  return { context, page, errors };
}
async function download(page, button) {
  if (process.env.CASHBOOK_TEST_CAPTURE_SHARE === '1') {
    await page.evaluate(() => delete window.__testSharedFile);
    await button.click();
    await page.waitForFunction(() => !!window.__testSharedFile);
    const f = await page.evaluate(() => window.__testSharedFile),
      file = path.join(artifacts, 'captured-' + Date.now() + '-' + f.name);
    fs.writeFileSync(file, f.text);
    return file;
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    button.click()
  ]);
  return download.path();
}
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({
    headless: true,
    downloadsPath: path.join(artifacts, 'downloads')
  });
  try {
    const url = 'http://127.0.0.1:' + server.address().port,
      owner = await setup(browser, url, 'Owner'),
      member = await setup(browser, url, 'Editor');
    await owner.page
      .getByRole('button', {
        name: 'Create a family ledger as owner',
        exact: true
      })
      .click();
    await owner.page
      .getByRole('button', { name: 'Verify and invite', exact: true })
      .waitFor();
    const request = await download(
        member.page,
        member.page.getByRole('button', {
          name: 'Share my invitation request',
          exact: true
        })
      ),
      memberId = await member.page.evaluate(
        async () =>
          (await window.__cashbookLocal.getSnapshot()).docs['family/identity']
            .public.id
      );
    await owner.page.locator('#fam-request-file').setInputFiles(request);
    await owner.page.locator('#fam-member-fingerprint').fill(memberId);
    await owner.page.locator('#fam-role').selectOption('editor');
    await owner.page.locator('.fam-scope[value="a"]').check();
    await owner.page
      .getByRole('button', { name: 'Verify and invite', exact: true })
      .click();
    await owner.page
      .getByRole('button', { name: 'Share latest file', exact: true })
      .waitFor();
    const snapshot = await download(
        owner.page,
        owner.page.getByRole('button', {
          name: 'Share latest file',
          exact: true
        })
      ),
      ownerId = await owner.page.evaluate(
        async () =>
          (await window.__cashbookLocal.getSnapshot()).docs['family/identity']
            .public.id
      );
    await member.page.locator('#fam-import-file').setInputFiles(snapshot);
    await member.page.locator('#fam-owner-fingerprint').fill(ownerId);
    await member.page
      .getByRole('button', { name: 'Review received file', exact: true })
      .click();
    member.page.once('dialog', (d) => d.accept());
    await member.page
      .getByRole('button', { name: 'Accept reviewed file', exact: true })
      .click();
    await member.page
      .getByRole('heading', { name: 'Shared ledger · editor', exact: true })
      .waitFor();
    const shared = await member.page.evaluate(
      async () => (await window.__cashbookLocal.getSnapshot()).docs
    );
    assert.ok(!shared['accounts/private']);
    await member.page.evaluate(async () => {
      const db = await window.claude.use('db');
      await db.doc('entries/family-entry').set({
        date: '2026-10-01',
        month: '2026-10',
        categoryId: 'food',
        accountId: 'a',
        amount: 250,
        note: 'Signed editor test'
      });
    });
    const changes = await download(
      member.page,
      member.page.getByRole('button', {
        name: 'Share my proposed changes',
        exact: true
      })
    );
    await owner.page.locator('#fam-import-file').setInputFiles(changes);
    await owner.page
      .getByRole('button', { name: 'Review received file', exact: true })
      .click();
    await owner.page
      .getByRole('button', { name: 'Accept reviewed file', exact: true })
      .click();
    await idle(owner.page);
    const ownerDocs = await owner.page.evaluate(
      async () => (await window.__cashbookLocal.getSnapshot()).docs
    );
    assert.equal(ownerDocs['accounts/private'].opening, 99999);
    assert.equal(ownerDocs['entries/family-entry'].by, memberId);
    await owner.page.screenshot({
      path: path.join(artifacts, 'family-owner-reviewed.png'),
      fullPage: true
    });
    await member.page.screenshot({
      path: path.join(artifacts, 'family-editor-scoped.png'),
      fullPage: true
    });
    await tool(owner.page, 'Multi-currency accounts & remittances');
    await owner.page.locator('#fx-name').fill('Dollar bank');
    await owner.page.locator('#fx-code').fill('USD');
    await owner.page.locator('#fx-opened').fill('2026-01-01');
    await owner.page.locator('#fx-opening').fill('1000');
    await owner.page.locator('#fx-opening-rate').fill('80');
    await owner.page
      .getByRole('button', { name: 'Add currency account', exact: true })
      .click();
    await idle(owner.page);
    const fxId = await owner.page.evaluate(
      async () =>
        Object.keys((await window.__cashbookLocal.getSnapshot()).docs)
          .find((p) => p.startsWith('fxAccounts/'))
          .split('/')[1]
    );
    await owner.page.locator('#fx-entry-account').selectOption(fxId);
    await owner.page.locator('#fx-entry-date').fill('2026-10-05');
    await owner.page.locator('#fx-entry-amount').fill('500');
    await owner.page.locator('#fx-entry-rate').fill('82');
    await owner.page
      .getByRole('button', { name: 'Save transaction', exact: true })
      .click();
    await idle(owner.page);
    await owner.page.locator('#fx-from').selectOption('fx:' + fxId);
    await owner.page.locator('#fx-to').selectOption('legacy:a');
    await owner.page.locator('#fx-transfer-date').fill('2026-10-06');
    await owner.page.locator('#fx-source').fill('100');
    await owner.page.locator('#fx-fee').fill('1');
    await owner.page.locator('#fx-received').fill('7900');
    await owner.page.locator('#fx-source-rate').fill('80');
    await owner.page.locator('#fx-target-rate').fill('1');
    await owner.page
      .getByRole('button', { name: 'Save remittance', exact: true })
      .click();
    await idle(owner.page);
    const balance = await owner.page.evaluate(async (id) => {
      const s = await window.__cashbookLocal.getSnapshot();
      return window.CashbookCurrency.compute(
        window.CashbookCurrency.fromDocs(s.docs),
        '2026-10-31'
      ).balances[id];
    }, fxId);
    if (balance !== 1399)
      console.error(
        'Unexpected remittance test state:',
        await owner.page.evaluate(async () =>
          Object.fromEntries(
            Object.entries(
              (await window.__cashbookLocal.getSnapshot()).docs
            ).filter(([p]) => p.startsWith('fxTransfers/'))
          )
        )
      );
    assert.equal(balance, 1399);
    assert.ok(
      await owner.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    );
    await owner.page.screenshot({
      path: path.join(artifacts, 'multi-currency-remittance.png'),
      fullPage: true
    });
    await tool(owner.page, 'Purchases & restore');
    await owner.page
      .getByText(
        'Merchant/store and verification service settings have not been supplied.',
        { exact: false }
      )
      .waitFor();
    assert.deepEqual(owner.errors, []);
    assert.deepEqual(member.errors, []);
    console.log(
      'Two-profile family exchange, private-account isolation, editor acceptance, currency remittance and unconfigured billing browser flows passed.'
    );
    await owner.context.close();
    await member.context.close();
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
