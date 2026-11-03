/* Paired personal-device sync. The native relay sees authenticated ciphertext only.
   Both apps must remain open and unlocked. No background service or cloud account. */
(function (root, factory) {
  const C =
    typeof module === "object" && module.exports
      ? require("./wifi-crypto.js")
      : root.CashbookWifiCrypto;
  const api = factory(C);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CashbookWifi = api;
})(globalThis, (C) => {
  "use strict";
  function create({
    store,
    hostTransport = null,
    request,
    now = () => Date.now(),
    cancelTransport = async () => {},
    onChange = () => {},
  }) {
    let vault = null,
      loaded = false,
      active = null,
      invite = null,
      pending = null,
      candidate = null,
      error = "",
      busy = false,
      epoch = 0,
      mutation = Promise.resolve(),
      hostJobs = 0;
    let cancelWait = null;
    const challenges = new Map();
    const emit = () => onChange();
    function guard() {
      if (store.locked || !store.encrypted)
        throw Error("Set a PIN and unlock before pairing.");
      if (store.drive?.connected)
        throw Error("Disconnect Google Drive before using local Wi-Fi sync.");
      if (store.saveError || store.readError)
        throw Error("Resolve the device storage error before syncing.");
    }
    async function load() {
      guard();
      if (!loaded) {
        vault = await store.readDeviceVault();
        if (
          vault &&
          (vault.v !== 1 ||
            !["host", "phone"].includes(vault.role) ||
            typeof vault.peers !== "object" ||
            Object.keys(vault.peers).length > 8)
        )
          throw Error(
            "Paired-device settings are damaged. Restore your backup and pair again.",
          );
        loaded = true;
      }
      return vault;
    }
    async function save() {
      await store.writeDeviceVault(vault);
    }
    async function personal() {
      guard();
      await store.flush();
      const snap = await store.getSnapshot();
      if (Object.keys(snap.docs).some((p) => p.startsWith("family/")))
        throw Error("Use signed family exchange for this family ledger.");
      return snap;
    }
    function state() {
      return {
        active: !!active,
        addresses: active?.addresses || [],
        endpoint: invite?.endpoint || null,
        qr: invite && invite.expires > now() ? C.qr(invite) : null,
        expires: invite?.expires || 0,
        pending: pending ? { name: pending.name, code: pending.code } : null,
        candidate: candidate
          ? {
              name: candidate.name,
              code: candidate.code,
              approved: !!candidate.record,
            }
          : null,
        peers: Object.values(vault?.peers || {}).map(({ secret, ...p }) => p),
        role: vault?.role || null,
        busy: busy || hostJobs > 0,
        error,
      };
    }
    async function refresh() {
      await load();
      emit();
      return state();
    }
    async function start() {
      await load();
      const snap = await personal();
      if (!snap.docs["settings/main"])
        throw Error("Set up or restore your records on the laptop first.");
      if (!hostTransport)
        throw Error("Open the installed Windows app to connect your phone.");
      if (vault && vault.role !== "host")
        throw Error(
          "This device is paired as a phone. Remove that pairing first.",
        );
      if (!vault) {
        vault = { v: 1, role: "host", ledgerId: C.random(16), peers: {} };
        await save();
      }
      active = await hostTransport.start();
      if (!active.addresses?.length) {
        await stop();
        throw Error(
          "Connect the laptop to a private Wi-Fi network, then try again.",
        );
      }
      emit();
      return active;
    }
    async function showQR(address) {
      await start();
      if (pending)
        throw Error("Finish or reject the current pairing request first.");
      if (Object.keys(vault.peers).length >= 8)
        throw Error("Remove an old device before pairing another.");
      address = address || active.addresses[0];
      if (!active.addresses.includes(address))
        throw Error("Choose this laptop’s Wi-Fi address.");
      invite = {
        v: 1,
        id: C.random(16),
        secret: C.random(),
        endpoint: C.endpoint("http://" + address + ":" + active.port),
        expires: now() + 120000,
      };
      challenges.clear();
      emit();
      return C.qr(invite);
    }
    async function stop() {
      epoch++;
      invite = null;
      challenges.clear();
      if (pending) {
        pending.resolve(false);
        pending = null;
      }
      active = null;
      if (hostTransport) await hostTransport.stop();
      emit();
    }
    function decide(accept) {
      if (!pending) return;
      const p = pending;
      pending = null;
      p.resolve(!!accept);
      emit();
    }
    async function handle({ id, route, body }) {
      const current = epoch;
      let answer = null;
      try {
        await load();
        if (!active) throw Error("Local sync is off.");
        for (const [k, v] of challenges)
          if (v.expires <= now()) challenges.delete(k);
        if (route === "/v1/challenge") {
          if (challenges.size >= 16) throw Error("Try again shortly.");
          const target = body.id,
            secret =
              invite?.id === target && invite.expires > now() && !pending
                ? invite.secret
                : vault.peers[target]?.secret;
          if (!secret) throw Error("Pairing expired or device removed.");
          const ephemeral = await C.ephemeral(),
            challenge = {
              id: target,
              nonce: C.random(),
              publicKey: ephemeral.publicKey,
            };
          challenges.set(challenge.nonce, {
            challenge,
            privateKey: ephemeral.privateKey,
            expires: now() + 45000,
          });
          answer = challenge;
        } else if (route === "/v1/message") {
          const c = challenges.get(body.nonce);
          if (!c || c.expires <= now())
            throw Error("Request expired. Try again.");
          challenges.delete(body.nonce);
          const pairing =
              c.challenge.id === invite?.id && invite.expires > now(),
            peer = vault.peers[c.challenge.id],
            secret = pairing ? invite.secret : peer?.secret;
          if (!secret) throw Error("Device removed or pairing expired.");
          const context = C.transcript(c.challenge, body.publicKey),
            key = await C.derive(secret, c.privateKey, body.publicKey, context),
            payload = await C.open(
              key,
              context,
              "phone-to-laptop",
              body.packet,
            );
          if (pairing) {
            if (
              payload.op !== "pair" ||
              pending ||
              typeof payload.name !== "string" ||
              !payload.name.trim() ||
              payload.name.length > 60
            )
              throw Error("Invalid pairing request.");
            invite = null;
            challenges.clear();
            const verification = await C.code(key, context);
            let timer;
            const accepted = await new Promise((resolve) => {
              pending = { name: payload.name, code: verification, resolve };
              timer = setTimeout(() => decide(false), 75000);
              emit();
            });
            clearTimeout(timer);
            if (!accepted || epoch !== current)
              throw Error("Pairing cancelled.");
            const record = {
              id: C.random(16),
              secret: C.random(),
              name: payload.name,
              createdAt: now(),
              lastSync: 0,
            };
            vault.peers[record.id] = record;
            try {
              await save();
            } catch (e) {
              delete vault.peers[record.id];
              throw e;
            }
            answer = await C.seal(key, context, "laptop-to-phone", {
              op: "paired",
              record: { ...record, name: "My laptop" },
              ledgerId: vault.ledgerId,
            });
            emit();
          } else {
            if (payload.op !== "sync" || payload.ledgerId !== vault.ledgerId)
              throw Error("These are different records. Pair again.");
            // Serialize mutations; re-check revocation after waiting behind another request.
            const job = mutation
              .catch(() => {})
              .then(async () => {
                if (epoch !== current || !vault?.peers[peer.id] || store.locked)
                  throw Error("Device removed or locked.");
                await personal();
                if (epoch !== current || !vault?.peers[peer.id])
                  throw Error("Device removed or pairing reset.");
                if (payload.snapshot) await store.mergePeer(payload.snapshot);
                await store.flush();
                const result = await personal();
                if (epoch !== current || !vault?.peers[peer.id])
                  throw Error("Device removed or pairing reset.");
                peer.lastSync = now();
                await save();
                return C.seal(key, context, "laptop-to-phone", {
                  op: "synced",
                  ledgerId: vault.ledgerId,
                  snapshot: result,
                });
              });
            mutation = job;
            hostJobs++;
            try {
              answer = await job;
            } finally {
              hostJobs--;
            }
            emit();
          }
        }
      } catch (e) {
        error = e.message;
        emit();
      } finally {
        await hostTransport.reply(id, answer);
      }
    }
    async function prepare(secret, id, url, payload) {
      const challenge = await request(url, "/v1/challenge", { id });
      if (challenge.id !== id) throw Error("Laptop authentication failed.");
      const ephemeral = await C.ephemeral(),
        context = C.transcript(challenge, ephemeral.publicKey),
        key = await C.derive(
          secret,
          ephemeral.privateKey,
          challenge.publicKey,
          context,
        ),
        packet = await C.seal(key, context, "phone-to-laptop", payload);
      return {
        key,
        context,
        body: {
          nonce: challenge.nonce,
          publicKey: ephemeral.publicKey,
          packet,
        },
      };
    }
    async function exchange(url, prepared) {
      const response = await request(url, "/v1/message", prepared.body);
      return C.open(
        prepared.key,
        prepared.context,
        "laptop-to-phone",
        response,
      );
    }
    async function scan(text, name = "My phone") {
      if (busy) throw Error("A connection is already in progress.");
      busy = true;
      error = "";
      let current = epoch;
      try {
        await load();
        const snap = await personal();
        if (vault?.role === "host")
          throw Error("Use this device to show the QR code.");
        if (snap.docs["settings/main"] && !vault?.ledgerId)
          throw Error(
            "This phone already has its own records. Back them up and start with an empty app before pairing.",
          );
        const q = C.parseQR(text, now()),
          prepared = await prepare(q.secret, q.id, q.endpoint, {
            op: "pair",
            name: String(name).trim().slice(0, 60) || "My phone",
          });
        candidate = {
          name: "My laptop",
          code: await C.code(prepared.key, prepared.context),
        };
        emit();
        const result = await Promise.race([
          exchange(q.endpoint, prepared),
          new Promise((_, reject) => {
            cancelWait = () => reject(Error("Pairing cancelled."));
          }),
        ]);
        cancelWait = null;
        if (current !== epoch) throw Error("Pairing cancelled.");
        if (
          result.op !== "paired" ||
          !result.record ||
          typeof result.ledgerId !== "string"
        )
          throw Error("Invalid pairing response.");
        C.bytes(result.record.id, 16);
        C.bytes(result.record.secret, 32);
        if (vault?.ledgerId && vault.ledgerId !== result.ledgerId)
          throw Error(
            "These records belong to another laptop. Your records were kept.",
          );
        candidate = {
          ...candidate,
          ledgerId: result.ledgerId,
          record: { ...result.record, endpoint: q.endpoint },
        };
        emit();
      } catch (e) {
        candidate = null;
        error = e.message;
        throw e;
      } finally {
        cancelWait = null;
        busy = false;
        emit();
      }
    }
    async function confirmPhone() {
      guard();
      if (!candidate?.record)
        throw Error("Approve the matching code on the laptop first.");
      vault = {
        v: 1,
        role: "phone",
        ledgerId: candidate.ledgerId,
        peers: { [candidate.record.id]: candidate.record },
      };
      await save();
      candidate = null;
      emit();
    }
    function cancel() {
      epoch++;
      cancelWait?.();
      cancelWait = null;
      cancelTransport().catch(() => {});
      candidate = null;
      decide(false);
      emit();
    }
    async function sync(id) {
      if (busy) throw Error("Sync is already running.");
      busy = true;
      error = "";
      emit();
      try {
        await load();
        if (vault?.role !== "phone")
          throw Error(
            "Tap Sync now on your paired phone while the laptop is listening.",
          );
        const peer = vault.peers[id];
        if (!peer) throw Error("Device was removed.");
        const current = epoch;
        for (let round = 0; round < 3; round++) {
          const snap = await personal(),
            prepared = await prepare(
              peer.secret,
              peer.id,
              C.endpoint(peer.endpoint),
              {
                op: "sync",
                ledgerId: vault.ledgerId,
                snapshot: snap.docs["settings/main"] ? snap : null,
              },
            ),
            result = await exchange(peer.endpoint, prepared);
          if (current !== epoch || !vault?.peers[id])
            throw Error("Sync cancelled.");
          if (result.op !== "synced" || result.ledgerId !== vault.ledgerId)
            throw Error("The laptop sent different records.");
          const merged = await store.mergePeer(result.snapshot);
          await store.flush();
          if (merged.localNewer) continue;
          peer.lastSync = now();
          await save();
          emit();
          return result;
        }
        throw Error(
          "Records are saved, but more edits arrived during sync. Tap Sync now again to finish.",
        );
      } catch (e) {
        error = e.message;
        throw e;
      } finally {
        busy = false;
        emit();
      }
    }
    async function remove(id) {
      if (busy || hostJobs)
        throw Error("Wait for the current connection to finish.");
      await load();
      if (!vault?.peers[id]) return;
      const previous = vault.peers[id];
      delete vault.peers[id];
      try {
        await save();
      } catch (e) {
        vault.peers[id] = previous;
        throw e;
      }
      challenges.clear();
      emit();
    }
    async function reset() {
      cancel();
      await stop();
      candidate = null;
      vault = null;
      loaded = false;
      error = "";
      emit();
    }
    if (hostTransport?.onRequest) hostTransport.onRequest(handle);
    return {
      state,
      refresh,
      start,
      showQR,
      stop,
      decide,
      scan,
      confirmPhone,
      cancel,
      sync,
      remove,
      reset,
    };
  }
  return { create };
});
