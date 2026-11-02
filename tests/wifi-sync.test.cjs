const test = require("node:test"),
  assert = require("node:assert/strict");
const C = require("../www/wifi-crypto.js"),
  { create } = require("../www/wifi-sync.js"),
  { createRelay } = require("../desktop/wifi-relay.cjs"),
  { harness } = require("./harness.cjs");
const password = "local Wi-Fi test passphrase";
const seed = {
  app: "family-cashbook",
  version: 2,
  docs: {
    "settings/main": { start: "2026-01", end: "2026-12" },
    "accounts/bank": { name: "Synthetic bank", opening: 1000 },
    "categories/food": {
      name: "Food",
      type: "expense",
      account: "bank",
      amounts: {},
    },
  },
  times: {},
};
const entry = (note) => ({
  date: "2026-11-02",
  month: "2026-11",
  categoryId: "food",
  accountId: "bank",
  amount: 123,
  note,
});
async function devices({ real = false, clock = () => Date.now() } = {}) {
  const host = harness({ initial: seed }),
    phone = harness();
  await host.db;
  await phone.db;
  await host.api.encryptLedger(password);
  await phone.api.encryptLedger(password);
  let listener,
    relay,
    port = 49152,
    serial = 0;
  const responses = new Map(),
    wire = [];
  const transport = {
    start: async () => {
      if (real) {
        const result = await relay.start();
        port = result.port;
      }
      return { addresses: ["192.168.10.2"], port };
    },
    stop: async () => {
      if (real) await relay.stop();
    },
    onRequest: (fn) => (listener = fn),
    reply: async (id, value) => {
      if (real) relay.respond(id, value);
      else {
        const resolve = responses.get(id);
        responses.delete(id);
        resolve(value);
      }
    },
  };
  if (real)
    relay = createRelay((message) => listener(message), {
      allowLoopback: true,
      port: 0,
      timeout: 10000,
    });
  const request = async (base, route, body) => {
    wire.push(JSON.stringify(body));
    if (real) {
      const r = await fetch("http://127.0.0.1:" + port + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error("Rejected");
      return r.json();
    }
    return new Promise((resolve, reject) => {
      const id = String(++serial);
      responses.set(id, (value) =>
        value ? resolve(value) : reject(Error("Rejected")),
      );
      listener({ id, route, body });
    });
  };
  const laptop = create({
      store: host.api,
      hostTransport: transport,
      request,
      now: clock,
    }),
    mobile = create({ store: phone.api, request, now: clock });
  async function pair() {
    const qr = await laptop.showQR();
    const scan = mobile.scan(qr);
    for (let i = 0; i < 100 && !laptop.state().pending; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(laptop.state().pending);
    assert.equal(laptop.state().pending.code, mobile.state().candidate.code);
    assert.equal(
      (await phone.api.getSnapshot()).docs["settings/main"],
      undefined,
    );
    laptop.decide(true);
    await scan;
    assert.equal(
      mobile.state().peers.length,
      0,
      "phone must confirm before it can sync",
    );
    await mobile.confirmPhone();
    return mobile.state().peers[0].id;
  }
  return {
    host,
    phone,
    laptop,
    mobile,
    request,
    wire,
    pair,
    stop: () => laptop.stop(),
  };
}
test("QR rejects public, loopback, DNS, userinfo, expired and malformed endpoints", () => {
  const q = {
    v: 1,
    id: C.random(16),
    secret: C.random(),
    expires: Date.now() + 120000,
    endpoint: "http://192.168.1.10:49152",
  };
  assert.equal(C.parseQR(C.qr(q)).endpoint, q.endpoint);
  for (const endpoint of [
    "http://127.0.0.1:49152",
    "http://8.8.8.8:49152",
    "http://laptop.local:49152",
    "http://user@192.168.1.10:49152",
    "http://192.168.1.10:49152/path",
    "https://192.168.1.10:49152",
  ])
    assert.throws(() => C.parseQR(C.qr({ ...q, endpoint })));
  assert.throws(() => C.parseQR(C.qr({ ...q, expires: Date.now() - 1 })));
  assert.throws(() => C.parseQR("https://example.com"));
});
test("ECDH/HKDF agrees; AES-GCM rejects tamper, reflection and another pairing key", async () => {
  const a = await C.ephemeral(),
    b = await C.ephemeral(),
    challenge = { id: C.random(16), nonce: C.random(), publicKey: a.publicKey },
    context = C.transcript(challenge, b.publicKey),
    secret = C.random(),
    ka = await C.derive(secret, a.privateKey, b.publicKey, context),
    kb = await C.derive(secret, b.privateKey, a.publicKey, context);
  assert.deepEqual(ka, kb);
  const packet = await C.seal(ka, context, "phone-to-laptop", {
    private: "secret",
  });
  assert.deepEqual(await C.open(kb, context, "phone-to-laptop", packet), {
    private: "secret",
  });
  await assert.rejects(C.open(kb, context, "laptop-to-phone", packet));
  await assert.rejects(
    C.open(kb, context + "changed", "phone-to-laptop", packet),
  );
  const bad = {
    ...packet,
    data: (packet.data[0] === "A" ? "B" : "A") + packet.data.slice(1),
  };
  await assert.rejects(C.open(kb, context, "phone-to-laptop", bad));
});
test("both sides approve before first sync; offline entries merge in both directions and retries are idempotent", async () => {
  const d = await devices();
  try {
    const id = await d.pair();
    await d.mobile.sync(id);
    const db = await d.phone.db;
    await db.doc("entries/from-phone").set(entry("only on the phone"));
    await (
      await d.host.db
    )
      .doc("entries/from-laptop")
      .set(entry("only on the laptop"));
    await d.mobile.sync(id);
    await d.mobile.sync(id);
    for (const api of [d.host.api, d.phone.api]) {
      const snap = await api.getSnapshot();
      assert.equal(
        Object.keys(snap.docs).filter((k) => k.startsWith("entries/")).length,
        2,
      );
      assert.equal(snap.docs["entries/from-phone"].note, "only on the phone");
    }
    assert.ok(
      d.wire.every(
        (s) =>
          !s.includes("Synthetic bank") && !s.includes("only on the phone"),
      ),
    );
    for (const device of [d.host, d.phone]) {
      const raw = device.disk.get("family-cashbook-local-devices.json");
      assert.equal(JSON.parse(raw).app, "family-cashbook-encrypted");
      assert.ok(!raw.includes(id));
      const reopened = harness({ storage: device.disk });
      await reopened.db;
      await assert.rejects(reopened.api.readDeviceVault());
      await reopened.api.unlock(password);
      assert.ok((await reopened.api.readDeviceVault()).peers[id]);
    }
  } finally {
    await d.stop();
  }
});
test("real HTTP relay transports only encrypted application messages", async () => {
  const d = await devices({ real: true });
  try {
    const id = await d.pair();
    await d.mobile.sync(id);
    assert.equal(
      (await d.phone.api.getSnapshot()).docs["accounts/bank"].name,
      "Synthetic bank",
    );
  } finally {
    await d.stop();
  }
});
test("rejected pairing, replayed request and revoked phone cannot transfer records", async () => {
  const d = await devices();
  try {
    const q = await d.laptop.showQR(),
      scan = d.mobile.scan(q);
    for (let i = 0; i < 100 && !d.laptop.state().pending; i++)
      await new Promise((r) => setTimeout(r, 10));
    d.laptop.decide(false);
    await assert.rejects(scan);
    assert.equal(d.laptop.state().peers.length, 0);
    const id = await d.pair();
    await d.mobile.sync(id);
    const request = d.wire.map((x) => JSON.parse(x)).findLast((x) => x.packet);
    await assert.rejects(d.request("", "/v1/message", request));
    await d.laptop.remove(id);
    await assert.rejects(d.mobile.sync(id));
    assert.equal(
      (await d.phone.api.getSnapshot()).docs["accounts/bank"].name,
      "Synthetic bank",
    );
  } finally {
    await d.stop();
  }
});
test("an unrelated existing phone ledger cannot be silently paired", async () => {
  const d = await devices();
  try {
    await (
      await d.phone.db
    )
      .doc("settings/main")
      .set({ start: "2025-01", end: "2025-12" });
    const qr = await d.laptop.showQR();
    await assert.rejects(d.mobile.scan(qr), /separate ledger/);
    assert.equal(d.laptop.state().pending, null);
  } finally {
    await d.stop();
  }
});
test("local pairing requires encryption, excludes family ledgers and disallows simultaneous Drive sync", async () => {
  const h = harness({ initial: seed });
  await h.db;
  const c = create({ store: h.api, request: () => {} });
  await assert.rejects(c.refresh(), /passphrase/);
  await h.api.encryptLedger(password);
  const db = await h.db;
  await db.doc("family/main").set({ mode: "owner" });
  await assert.rejects(h.api.mergePeer(seed), /Family ledgers/);
});
test("invalid incoming snapshots leave saved records intact; restores invalidate paired keys", async () => {
  const d = await devices();
  try {
    await d.pair();
    const before = await d.host.api.getSnapshot();
    await assert.rejects(
      d.host.api.mergePeer({
        ...seed,
        docs: { ...seed.docs, "entries/bad": { ...entry("bad"), amount: -1 } },
      }),
    );
    assert.deepEqual((await d.host.api.getSnapshot()).docs, before.docs);
    await d.host.api.importData(JSON.stringify(seed));
    assert.equal(d.host.disk.has("family-cashbook-local-devices.json"), false);
    assert.ok(d.host.events.some((e) => e.type === "cashbook-ledger-replaced"));
  } finally {
    await d.stop();
  }
});
test("HTTP relay rejects website origins and GETs; stop closes pending requests", async () => {
  let message;
  const r = createRelay((value) => (message = value), {
    allowLoopback: true,
    port: 0,
    timeout: 1000,
  });
  const { port } = await r.start(),
    url = "http://127.0.0.1:" + port;
  try {
    assert.equal((await fetch(url + "/v1/challenge")).status, 403);
    assert.equal(
      (
        await fetch(url + "/v1/challenge", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://attacker.invalid",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    const pending = fetch(url + "/v1/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    for (let i = 0; i < 20 && !message; i++)
      await new Promise((r) => setTimeout(r, 10));
    await r.stop();
    assert.equal((await pending).status, 403);
  } finally {
    await r.stop();
  }
});

test("expired challenges and a wrong QR secret cannot authorize a phone", async () => {
  let time = Date.now();
  const d = await devices({ clock: () => time });
  try {
    const text = await d.laptop.showQR(),
      q = C.parseQR(text, time);
    await assert.rejects(d.mobile.scan(C.qr({ ...q, secret: C.random() })));
    assert.equal(d.laptop.state().pending, null);
    const challenge = await d.request(q.endpoint, "/v1/challenge", {
        id: q.id,
      }),
      ephemeral = await C.ephemeral(),
      context = C.transcript(challenge, ephemeral.publicKey),
      key = await C.derive(
        q.secret,
        ephemeral.privateKey,
        challenge.publicKey,
        context,
      ),
      packet = await C.seal(key, context, "phone-to-laptop", {
        op: "pair",
        name: "Phone",
      });
    time += 46000;
    await assert.rejects(
      d.request(q.endpoint, "/v1/message", {
        nonce: challenge.nonce,
        publicKey: ephemeral.publicKey,
        packet,
      }),
    );
    assert.equal(d.laptop.state().peers.length, 0);
    time += 75000;
    await assert.rejects(d.mobile.scan(text), /expired/);
  } finally {
    await d.stop();
  }
});
test("phone cancellation discards the unconfirmed pairing and permits a fresh attempt", async () => {
  const d = await devices();
  try {
    const qr = await d.laptop.showQR(),
      scan = d.mobile.scan(qr);
    for (let i = 0; i < 100 && !d.laptop.state().pending; i++)
      await new Promise((r) => setTimeout(r, 10));
    d.mobile.cancel();
    await assert.rejects(scan, /cancelled/);
    d.laptop.decide(false);
    assert.equal(d.mobile.state().peers.length, 0);
    await d.pair();
  } finally {
    await d.stop();
  }
});
test("entries added during a transfer trigger another round before reporting success; deletions propagate", async () => {
  const d = await devices();
  try {
    const id = await d.pair();
    await d.mobile.sync(id);
    let inserted = false;
    const mobile = create({
      store: d.phone.api,
      request: async (base, route, body) => {
        const result = await d.request(base, route, body);
        if (route === "/v1/message" && !inserted) {
          inserted = true;
          await (
            await d.phone.db
          )
            .doc("entries/during-sync")
            .set(entry("Arrived during transfer"));
        }
        return result;
      },
    });
    await mobile.sync(id);
    assert.equal(
      (await d.host.api.getSnapshot()).docs["entries/during-sync"].note,
      "Arrived during transfer",
    );
    await (await d.phone.db).doc("entries/during-sync").delete();
    await mobile.sync(id);
    assert.equal(
      (await d.host.api.getSnapshot()).docs["entries/during-sync"],
      undefined,
    );
    assert.ok((await d.host.api.getSnapshot()).tomb["entries/during-sync"]);
  } finally {
    await d.stop();
  }
});
