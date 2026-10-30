const test = require("node:test"),
  assert = require("node:assert/strict");
const { harness } = require("./harness.cjs");
const Guide = require("../www/guide");
const docs = {
  "settings/main": { start: "2026-08", end: "2028-12" },
  "accounts/bank": {
    name: "Legacy bank",
    opening: 5000,
    min: 0,
    kind: "Savings",
  },
  "categories/food": {
    name: "Food",
    account: "bank",
    type: "expense",
    amounts: { "2026-08": 1000 },
  },
  "transfers/2026-08": { items: [] },
};
const backup = {
  app: "family-cashbook",
  version: 2,
  docs,
  times: {},
  tomb: {},
};
test("plain old backup is inspected without a passphrase and without altering saved data", async () => {
  const h = harness({
    initial: {
      app: "family-cashbook",
      version: 2,
      docs: { "accounts/current": { name: "Current" } },
    },
  });
  await h.db;
  const original = h.disk.get("family-cashbook-data.json");
  const info = await h.api.inspectBackup(JSON.stringify(backup));
  assert.equal(info.encrypted, false);
  assert.equal(info.counts.accounts, 1);
  assert.equal(info.records, 4);
  assert.equal(h.disk.get("family-cashbook-data.json"), original);
  assert.equal(h.writes.length, 0);
  await h.api.importData(JSON.stringify(backup));
  assert.equal((await h.api.getSnapshot()).docs["accounts/bank"].opening, 5000);
});
test("BOM and legacy raw document maps can be reviewed and restored", async () => {
  const h = harness();
  await h.db;
  const raw = "\uFEFF" + JSON.stringify(docs);
  const info = await h.api.inspectBackup(raw);
  assert.equal(info.start, "2026-08");
  await h.api.importData(raw);
  assert.equal(
    (await h.api.getSnapshot()).docs["categories/food"].amounts["2026-08"],
    1000,
  );
});
test("encrypted backup restore asks for the original passphrase and keeps the new working copy encrypted", async () => {
  const h = harness();
  await h.db;
  const encrypted = await h.context.CashbookSecurity.seal(
    JSON.stringify(backup),
    "original backup passphrase",
  );
  await assert.rejects(
    h.api.inspectBackup(encrypted),
    /original backup passphrase/,
  );
  await assert.rejects(
    h.api.inspectBackup(encrypted, "wrong password"),
    /Incorrect passphrase/,
  );
  assert.equal(h.writes.length, 0);
  const info = await h.api.inspectBackup(
    encrypted,
    "original backup passphrase",
  );
  assert.equal(info.encrypted, true);
  await h.api.importData(encrypted, "original backup passphrase");
  assert.equal(
    JSON.parse(h.disk.get("family-cashbook-data.json")).app,
    "family-cashbook-encrypted",
  );
  assert.equal(
    (await h.api.getSnapshot()).docs["accounts/bank"].name,
    "Legacy bank",
  );
});
test("unrecognized, incomplete and unsafe backup files leave the working ledger untouched", async () => {
  const h = harness({ initial: backup });
  await h.db;
  const original = h.disk.get("family-cashbook-data.json");
  for (const raw of [
    "not JSON",
    "PK fake zip",
    JSON.stringify({ app: "other-app", docs }),
    JSON.stringify({ app: "family-cashbook", version: 99, docs }),
    '{"__proto__":{}}',
  ])
    await assert.rejects(h.api.inspectBackup(raw));
  await assert.rejects(
    h.api.inspectBackup(JSON.stringify({ app: "family-cashbook", docs: {} })),
    /complete ledger/,
  );
  assert.equal(h.disk.get("family-cashbook-data.json"), original);
  assert.equal(h.writes.length, 0);
});
test("recovery export has a distinct filename and cancelling preserves the current ledger", async () => {
  const h = harness({ initial: backup });
  await h.db;
  let offered;
  h.desktop.saveFile = async (name) => {
    offered = name;
    return false;
  };
  const original = h.disk.get("family-cashbook-data.json");
  await assert.rejects(h.api.importData(JSON.stringify(backup)), /cancelled/);
  assert.match(offered, /^family-cashbook-recovery-before-restore-/);
  assert.equal(h.disk.get("family-cashbook-data.json"), original);
});
test("setup steps are sequential and skip/check markers do not mutate the ledger", () => {
  const state = { accounts: { a: { name: "A" } }, entries: {}, fxEntries: {} };
  assert.equal(Guide.checklist(state).find((s) => !s.done).id, "accounts");
  const flags = {
    accountsReviewed: true,
    planReviewed: true,
    entrySkipped: true,
  };
  assert.equal(Guide.checklist(state, flags).find((s) => !s.done).id, "backup");
  assert.equal(Object.keys(state.entries).length, 0);
  flags.backupVerified = true;
  flags.optionalReviewed = true;
  assert.ok(Guide.checklist(state, flags).every((s) => s.done));
  assert.equal(
    Guide.checklist(
      { ...state, entries: { one: {} } },
      { accountsReviewed: true, planReviewed: true },
    ).find((s) => !s.done).id,
    "backup",
  );
});
