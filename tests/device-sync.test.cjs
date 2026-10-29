const test = require("node:test"),
  assert = require("node:assert/strict");
const { harness } = require("./harness.cjs");
const password = "phone and laptop test passphrase";
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
function cloud() {
  let body = null,
    version = 0,
    user = "owner",
    writes = 0,
    loseAck = false;
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes("/about?"))
      return new Response(
        JSON.stringify({
          user: { permissionId: user, emailAddress: user + "@example.invalid" },
        }),
      );
    if (url.includes("?q="))
      return new Response(
        JSON.stringify({ files: body ? [{ id: "one-ledger" }] : [] }),
      );
    if (url.includes("alt=media"))
      return new Response(body, { headers: { ETag: '"' + version + '"' } });
    if (opts.method === "POST") {
      const parts = opts.body.split("\r\n\r\n");
      body = parts[2].split("\r\n--")[0];
    } else if (opts.method === "PATCH") {
      if (opts.headers["If-Match"] !== '"' + version + '"')
        return new Response("", { status: 412 });
      body = opts.body;
    } else throw Error("Unexpected URL " + url);
    assert.equal(JSON.parse(body).app, "family-cashbook-encrypted");
    writes++;
    version++;
    if (loseAck) {
      loseAck = false;
      throw Error("Lost acknowledgement");
    }
    return new Response(JSON.stringify({ id: "one-ledger", version }));
  };
  function device(initial, storage) {
    const h = harness({ browser: true, initial, storage, fetchImpl });
    let logins = 0;
    h.context.google = {
      accounts: {
        oauth2: {
          initTokenClient: (opts) => ({
            requestAccessToken() {
              logins++;
              opts.callback({
                access_token: "synthetic-token",
                expires_in: 3600,
              });
            },
          }),
        },
      },
    };
    return { ...h, logins: () => logins };
  }
  return {
    device,
    get body() {
      return body;
    },
    get writes() {
      return writes;
    },
    setUser: (v) => (user = v),
    loseNextAck: () => (loseAck = true),
  };
}
const entry = (note, amount = 100) => ({
  date: "2026-10-29",
  month: "2026-10",
  categoryId: "food",
  accountId: "bank",
  amount,
  note,
});
test("phone saves offline, reopens encrypted, then syncs once to desktop without duplicate transactions", async () => {
  const c = cloud(),
    laptop = c.device(seed);
  await laptop.db;
  await laptop.api.encryptLedger(password);
  await laptop.api.drive.connect();
  const phone = c.device();
  const db = await phone.db;
  await phone.api.encryptLedger(password);
  await phone.api.drive.connect();
  assert.equal((await db.doc("accounts/bank").get()).data().name, "Test bank");
  phone.context.navigator.onLine = false;
  await db.doc("entries/phone-stable-id").set(entry("Offline phone purchase"));
  await phone.api.drive.syncNow();
  assert.equal(phone.api.drive.status, "offline");
  assert.equal(phone.api.drive.pending, true);
  assert.equal(
    JSON.parse(phone.disk.get("family-cashbook-data.json")).app,
    "family-cashbook-encrypted",
  );
  const restarted = c.device(null, phone.disk);
  const rdb = await restarted.db;
  assert.equal(restarted.api.locked, true);
  assert.equal(restarted.api.drive.pending, true);
  await restarted.api.unlock(password);
  await restarted.api.drive.syncNow();
  await restarted.api.drive.syncNow();
  await laptop.api.drive.syncNow();
  const snapshot = await laptop.api.getSnapshot();
  assert.equal(
    Object.keys(snapshot.docs).filter((p) => p.startsWith("entries/")).length,
    1,
  );
  assert.equal(
    snapshot.docs["entries/phone-stable-id"].note,
    "Offline phone purchase",
  );
  assert.equal(restarted.api.drive.pending, false);
  assert.equal(
    (await rdb.doc("entries/phone-stable-id").get()).data().amount,
    100,
  );
});
test("concurrent offline device additions survive encrypted round trips and lost upload acknowledgements", async () => {
  const c = cloud(),
    a = c.device(seed);
  const adb = await a.db;
  await a.api.encryptLedger(password);
  await a.api.drive.connect();
  const b = c.device();
  const bdb = await b.db;
  await b.api.encryptLedger(password);
  await b.api.drive.connect();
  await adb.doc("entries/laptop").set(entry("Laptop"));
  await bdb.doc("entries/phone").set(entry("Phone", 200));
  c.loseNextAck();
  await assert.rejects(b.api.drive.syncNow(), /Lost acknowledgement/);
  await b.api.drive.syncNow();
  await a.api.drive.syncNow();
  await b.api.drive.syncNow();
  for (const d of [a, b]) {
    const s = await d.api.getSnapshot();
    assert.deepEqual(
      Object.keys(s.docs)
        .filter((p) => p.startsWith("entries/"))
        .sort(),
      ["entries/laptop", "entries/phone"],
    );
  }
});
test("wrong shared passphrase cannot overwrite the remote or import it into a second device", async () => {
  const c = cloud(),
    a = c.device(seed);
  await a.db;
  await a.api.encryptLedger(password);
  await a.api.drive.connect();
  const before = c.body,
    writes = c.writes,
    b = c.device();
  await b.db;
  await b.api.encryptLedger("a completely different password");
  await assert.rejects(b.api.drive.connect());
  assert.equal(c.body, before);
  assert.equal(c.writes, writes);
  assert.equal(Object.keys((await b.api.getSnapshot()).docs).length, 0);
});
test("Drive account switch is rejected before reading or writing another ledger", async () => {
  const c = cloud(),
    a = c.device(seed);
  await a.db;
  await a.api.encryptLedger(password);
  await a.api.drive.connect();
  const writes = c.writes;
  c.setUser("other");
  await assert.rejects(a.api.drive.syncNow(), /different Google account/);
  assert.equal(c.writes, writes);
  assert.equal(a.api.drive.email, "owner@example.invalid");
});
test("sync requires encryption and reopened browser sessions request a tap without background login", async () => {
  const c = cloud(),
    a = c.device(seed);
  await a.db;
  await assert.rejects(a.api.drive.connect(), /encryption/);
  assert.equal(c.writes, 0);
  await a.api.encryptLedger(password);
  await a.api.drive.connect();
  const b = c.device(null, a.disk);
  await b.db;
  await b.api.unlock(password);
  await b.api.drive.background();
  assert.equal(b.logins(), 0);
  assert.equal(b.api.drive.status, "needs-tap");
  await b.api.drive.syncNow();
  assert.equal(b.logins(), 1);
  assert.equal(b.api.drive.status, "synced");
});
