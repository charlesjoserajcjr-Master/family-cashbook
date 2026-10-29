/* Owner-mediated, recipient-encrypted file exchange. Messaging apps are transport only. */
(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./ledger-schema')
      : root.CashbookSchema
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CashbookFamily = api;
})(globalThis, (Schema) => {
  'use strict';
  const enc = new TextEncoder(),
    dec = new TextDecoder(),
    MAX = 25 * 1024 * 1024;
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const canonical = (x) => {
    if (x === undefined) throw Error('Undefined signed value.');
    return x && typeof x === 'object'
      ? Array.isArray(x)
        ? '[' + x.map(canonical).join(',') + ']'
        : '{' +
          Object.keys(x)
            .sort()
            .map((k) => JSON.stringify(k) + ':' + canonical(x[k]))
            .join(',') +
          '}'
      : JSON.stringify(x);
  };
  const b64 = (a) =>
    btoa(Array.from(new Uint8Array(a), (b) => String.fromCharCode(b)).join(''));
  const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const publicKey = (k) => ({ kty: k.kty, crv: k.crv, x: k.x, y: k.y });
  const hash = async (x) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', enc.encode(canonical(x)))
      )
    )
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  async function identity(name) {
    const sign = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      ),
      box = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
      );
    const pub = {
      name: String(name).trim().slice(0, 80),
      sign: publicKey(await crypto.subtle.exportKey('jwk', sign.publicKey)),
      box: publicKey(await crypto.subtle.exportKey('jwk', box.publicKey))
    };
    pub.id = await hash({ sign: pub.sign, box: pub.box });
    return {
      public: pub,
      sign: await crypto.subtle.exportKey('jwk', sign.privateKey),
      box: await crypto.subtle.exportKey('jwk', box.privateKey)
    };
  }
  async function checkIdentity(pub) {
    Schema.safe(pub);
    if (
      !pub ||
      typeof pub.name !== 'string' ||
      pub.name.length > 80 ||
      pub.id !==
        (await hash({ sign: publicKey(pub.sign), box: publicKey(pub.box) })) ||
      pub.sign.d ||
      pub.box.d
    )
      throw Error('Invalid family identity.');
    for (const k of [pub.sign, pub.box])
      if (
        k.kty !== 'EC' ||
        k.crv !== 'P-256' ||
        typeof k.x !== 'string' ||
        typeof k.y !== 'string'
      )
        throw Error('Unsupported family key.');
    return pub;
  }
  async function sign(value, id) {
    const key = await crypto.subtle.importKey(
      'jwk',
      id.sign,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
    return b64(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        enc.encode(canonical(value))
      )
    );
  }
  async function verify(value, signature, pub) {
    await checkIdentity(pub);
    const key = await crypto.subtle.importKey(
      'jwk',
      pub.sign,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    if (
      !(await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        bytes(signature),
        enc.encode(canonical(value))
      ))
    )
      throw Error('Family signature is invalid.');
  }
  async function request(id) {
    return {
      app: 'family-cashbook-member-request',
      version: 1,
      member: id.public,
      signature: await sign(id.public, id)
    };
  }
  async function readRequest(value, expectedFingerprint) {
    Schema.safe(value);
    if (value.app !== 'family-cashbook-member-request' || value.version !== 1)
      throw Error('Not a family member request.');
    await verify(value.member, value.signature, value.member);
    if (value.member.id !== expectedFingerprint.trim().toLowerCase())
      throw Error(
        'Member fingerprint differs. Verify it independently before inviting.'
      );
    return value.member;
  }
  function ownerState(id) {
    return {
      version: 1,
      householdId: id.public.id,
      owner: id.public,
      mode: 'owner',
      epoch: 1,
      members: {},
      sent: {},
      received: []
    };
  }
  async function makeGrant(state, id, member, role, accounts) {
    if (state.mode !== 'owner' || state.owner.id !== id.public.id)
      throw Error('Only the pinned owner can issue grants.');
    await checkIdentity(member);
    if (
      !['editor', 'viewer'].includes(role) ||
      !Array.isArray(accounts) ||
      !accounts.length ||
      accounts.length > 200 ||
      accounts.some((x) => typeof x !== 'string' || !x || x.includes('/'))
    )
      throw Error('Choose an editor/viewer role and shared accounts.');
    const body = {
      version: 1,
      householdId: state.householdId,
      owner: state.owner,
      member,
      role,
      accounts: [...new Set(accounts)].sort(),
      epoch: state.epoch
    };
    return { body, signature: await sign(body, id) };
  }
  async function checkGrant(grant, ownerFingerprint) {
    if (
      !grant?.body ||
      grant.body.version !== 1 ||
      grant.body.owner.id !== ownerFingerprint
    )
      throw Error('The owner key is not trusted.');
    await verify(grant.body, grant.signature, grant.body.owner);
    await checkIdentity(grant.body.member);
    if (
      !['editor', 'viewer'].includes(grant.body.role) ||
      !Array.isArray(grant.body.accounts) ||
      !grant.body.accounts.length ||
      grant.body.accounts.some(
        (x) => typeof x !== 'string' || !x || x.includes('/')
      ) ||
      !Number.isSafeInteger(grant.body.epoch) ||
      grant.body.epoch < 1
    )
      throw Error('Invalid member grant.');
    return grant.body;
  }
  async function revoke(state, id, memberId) {
    const next = copy(state);
    if (next.mode !== 'owner' || next.owner.id !== id.public.id)
      throw Error('Only the owner can revoke.');
    delete next.members[memberId];
    next.epoch++;
    for (const [key, g] of Object.entries(next.members))
      next.members[key] = await makeGrant(
        next,
        id,
        g.body.member,
        g.body.role,
        g.body.accounts
      );
    return next;
  }
  function scoped(docs, accounts) {
    const allowed = new Set(accounts),
      out = {};
    if (docs['settings/main']) {
      const s = docs['settings/main'];
      out['settings/main'] = {
        start: s.start,
        end: s.end,
        currency: s.currency || 'INR',
        ...(s.closedThrough ? { closedThrough: s.closedThrough } : {})
      };
    }
    for (const [p, d] of Object.entries(docs)) {
      const [col, key] = p.split('/');
      if (col === 'accounts' && allowed.has(key)) out[p] = copy(d);
      if (col === 'fxAccounts' && allowed.has('fx:' + key)) out[p] = copy(d);
      if (col === 'categories' && allowed.has(d.account)) out[p] = copy(d);
    }
    for (const [p, d] of Object.entries(docs)) {
      const [col] = p.split('/');
      if (
        ['fxEntries', 'fxPlans', 'fxBalances'].includes(col) &&
        allowed.has('fx:' + d.accountId)
      )
        out[p] = copy(d);
      if (
        col === 'fxRates' &&
        Object.entries(out).some(
          ([p, a]) => p.startsWith('fxAccounts/') && a.currency === d.currency
        )
      )
        out[p] = copy(d);
      if (
        col === 'fxTransfers' &&
        [d.from, d.to].every((ref) =>
          allowed.has(ref.startsWith('legacy:') ? ref.slice(7) : ref)
        )
      )
        out[p] = copy(d);
      if (
        col === 'entries' &&
        out['categories/' + d.categoryId] &&
        allowed.has(d.accountId || out['categories/' + d.categoryId].account)
      )
        out[p] = copy(d);
      if (col === 'balances') {
        const values = Object.fromEntries(
          Object.entries(d.values || {}).filter(([id]) => allowed.has(id))
        );
        if (Object.keys(values).length)
          out[p] = { month: d.month || p.split('/')[1], values };
      }
      if (col === 'transfers') {
        const items = (d.items || []).filter(
          (t) =>
            allowed.has(t.from) &&
            allowed.has(t.to) &&
            (!t.actual ||
              (allowed.has(t.actual.from) && allowed.has(t.actual.to)))
        );
        if (items.length)
          out[p] = { month: d.month || p.split('/')[1], items: copy(items) };
      }
    }
    // No aggregate features, audit, holdings, private categories, family vaults or tombstone IDs travel.
    Schema.validate({ app: 'family-cashbook', docs: out });
    return out;
  }
  async function envelope(header, payload, sender, recipient) {
    const ephemeral = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const pub = await crypto.subtle.exportKey('jwk', ephemeral.publicKey),
      key = await transportKey(ephemeral.privateKey, recipient.box, header);
    const iv = crypto.getRandomValues(new Uint8Array(12)),
      cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: enc.encode(canonical(header)) },
        key,
        enc.encode(JSON.stringify(payload))
      );
    const body = {
      app: 'family-cashbook-family',
      version: 1,
      header,
      ephemeral: publicKey(pub),
      iv: b64(iv),
      data: b64(cipher)
    };
    return { ...body, signature: await sign(body, sender) };
  }
  async function transportKey(privateKey, publicJwk, header) {
    const pub = await crypto.subtle.importKey(
        'jwk',
        publicJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      ),
      bits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: pub },
        privateKey,
        256
      );
    const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, [
      'deriveKey'
    ]);
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: enc.encode(header.householdId),
        info: await crypto.subtle.digest(
          'SHA-256',
          enc.encode(canonical(header))
        )
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  async function decrypt(packet, id) {
    const key = await crypto.subtle.importKey(
      'jwk',
      id.box,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
    try {
      return JSON.parse(
        dec.decode(
          await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: bytes(packet.iv),
              additionalData: enc.encode(canonical(packet.header))
            },
            await transportKey(key, packet.ephemeral, packet.header),
            bytes(packet.data)
          )
        )
      );
    } catch {
      throw Error(
        'This file cannot be decrypted for this member, or it is damaged.'
      );
    }
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX)
      throw Error('Family file is too large.');
    const p = JSON.parse(text);
    Schema.safe(p);
    if (
      p.app !== 'family-cashbook-family' ||
      p.version !== 1 ||
      !p.header ||
      typeof p.data !== 'string' ||
      typeof p.signature !== 'string' ||
      typeof p.iv !== 'string' ||
      p.iv.length !== 16 ||
      !Number.isSafeInteger(p.header.sequence) ||
      p.header.sequence < 1
    )
      throw Error('Invalid family file.');
    return p;
  }
  async function snapshotPacket(state, id, memberId, docs) {
    const grant = state.members[memberId];
    if (state.mode !== 'owner' || !grant || state.owner.id !== id.public.id)
      throw Error('Only the owner can export to an active member.');
    await checkGrant(grant, state.owner.id);
    const shareable = scoped(docs, grant.body.accounts);
    if (JSON.stringify(shareable).length > 9 * 1024 * 1024)
      throw Error(
        'Shared records exceed 9 MB. Select fewer accounts to keep the local recovery baseline bounded.'
      );
    const sequence = (state.sent[memberId] || 0) + 1,
      header = {
        id: crypto.randomUUID(),
        householdId: state.householdId,
        kind: 'snapshot',
        sender: id.public,
        recipient: memberId,
        epoch: state.epoch,
        sequence,
        grant
      };
    return {
      packet: await envelope(
        header,
        { docs: shareable },
        id,
        grant.body.member
      ),
      state: { ...copy(state), sent: { ...state.sent, [memberId]: sequence } }
    };
  }
  async function receiveSnapshot(text, id, ownerFingerprint, previous) {
    const p = parse(text),
      h = p.header,
      grant = await checkGrant(h.grant, ownerFingerprint.trim().toLowerCase());
    if (
      h.kind !== 'snapshot' ||
      h.sender.id !== grant.owner.id ||
      h.recipient !== id.public.id ||
      grant.member.id !== id.public.id ||
      h.householdId !== grant.householdId ||
      h.epoch !== grant.epoch
    )
      throw Error('Family file identities or scope do not match.');
    const { signature, ...body } = p;
    await verify(body, signature, grant.owner);
    if (
      previous &&
      (previous.householdId !== h.householdId ||
        h.epoch < previous.epoch ||
        h.sequence <= previous.sequence)
    )
      throw Error('Stale or already imported family snapshot.');
    const payload = await decrypt(p, id);
    Schema.validate({ app: 'family-cashbook', docs: payload.docs });
    const clean = scoped(payload.docs, grant.accounts);
    if (canonical(clean) !== canonical(payload.docs))
      throw Error('Snapshot includes unauthorized records.');
    return {
      docs: clean,
      state: {
        version: 1,
        mode: 'member',
        householdId: h.householdId,
        owner: grant.owner,
        grant: h.grant,
        epoch: h.epoch,
        sequence: h.sequence,
        received: [h.id]
      }
    };
  }
  async function changesPacket(state, id, base, current) {
    const g = await checkGrant(state.grant, state.owner.id);
    if (
      state.mode !== 'member' ||
      g.role !== 'editor' ||
      g.member.id !== id.public.id
    )
      throw Error('Only an invited editor can send changes.');
    const clean = scoped(current, g.accounts),
      changes = [];
    for (const p of new Set([...Object.keys(base), ...Object.keys(clean)]))
      if (canonical(base[p] ?? null) !== canonical(clean[p] ?? null))
        changes.push({
          path: p,
          beforeHash: await hash(base[p] ?? null),
          data: clean[p] ?? null
        });
    if (!changes.length) throw Error('No shared changes to send.');
    if (changes.length > 1000)
      throw Error('Send at most 1,000 changed records.');
    const header = {
      id: crypto.randomUUID(),
      householdId: state.householdId,
      kind: 'changes',
      sender: id.public,
      recipient: state.owner.id,
      epoch: state.epoch,
      sequence: state.sequence,
      grant: state.grant
    };
    return envelope(header, { changes }, id, state.owner);
  }
  function authorizeChange(change, current, grant, closedThrough) {
    const p = Schema.path(change.path),
      [col, key] = p.split('/'),
      allowed = new Set(grant.accounts),
      before = current[p],
      after = change.data;
    if (
      ![
        'entries',
        'categories',
        'balances',
        'transfers',
        'fxEntries',
        'fxPlans',
        'fxTransfers',
        'fxBalances'
      ].includes(col)
    )
      throw Error('Members cannot modify this record type.');
    if (
      (col === 'entries' &&
        ((before && before.month <= closedThrough) ||
          (after && after.month <= closedThrough))) ||
      (['balances', 'transfers'].includes(col) && key <= closedThrough)
    )
      throw Error('Closed periods cannot be edited.');
    if (['fxEntries', 'fxPlans', 'fxTransfers', 'fxBalances'].includes(col)) {
      for (const d of [before, after].filter(Boolean)) {
        const m = (d.date || d.month).slice(0, 7);
        if (m <= closedThrough)
          throw Error('Closed currency periods cannot be edited.');
        if (col === 'fxTransfers') {
          if (
            ![d.from, d.to].every((ref) =>
              allowed.has(ref.startsWith('legacy:') ? ref.slice(7) : ref)
            )
          )
            throw Error('Currency transfer is outside scope.');
        } else if (!allowed.has('fx:' + d.accountId))
          throw Error('Currency account is outside scope.');
      }
    }
    if (col === 'entries')
      for (const e of [before, after].filter(Boolean)) {
        const cat = current['categories/' + e.categoryId];
        if (
          !cat ||
          !allowed.has(e.accountId || cat.account) ||
          !allowed.has(cat.account)
        )
          throw Error('Entry is outside the member account scope.');
      }
    if (col === 'categories') {
      if (
        !before ||
        !after ||
        before.account !== after.account ||
        before.type !== after.type ||
        !allowed.has(before.account)
      )
        throw Error('Members may edit existing shared category plans only.');
      for (const field of new Set([
        ...Object.keys(before),
        ...Object.keys(after)
      ]))
        if (
          !['amounts', 'completedMonths', 'dueDay', 'forecastMode'].includes(
            field
          ) &&
          canonical(before[field] ?? null) !== canonical(after[field] ?? null)
        )
          throw Error('Category identity fields require the owner.');
      for (const m of new Set([
        ...Object.keys(before.amounts || {}),
        ...Object.keys(after.amounts || {}),
        ...Object.keys(before.completedMonths || {}),
        ...Object.keys(after.completedMonths || {})
      ]))
        if (
          m <= closedThrough &&
          (canonical(before.amounts?.[m] ?? null) !==
            canonical(after.amounts?.[m] ?? null) ||
            canonical(before.completedMonths?.[m] ?? null) !==
              canonical(after.completedMonths?.[m] ?? null))
        )
          throw Error('Closed category plans cannot be edited.');
    }
    if (col === 'balances')
      for (const d of [before, after].filter(Boolean))
        if (Object.keys(d.values || {}).some((id) => !allowed.has(id)))
          throw Error('Balance is outside member scope.');
    if (col === 'transfers')
      for (const d of [before, after].filter(Boolean))
        for (const t of d.items || [])
          if (
            !allowed.has(t.from) ||
            !allowed.has(t.to) ||
            (t.actual &&
              (!allowed.has(t.actual.from) ||
                !allowed.has(t.actual.to) ||
                t.actual.date.slice(0, 7) <= closedThrough))
          )
            throw Error('Transfer is outside scope or in a closed period.');
    if (after)
      Schema.validate({
        app: 'family-cashbook',
        docs: { ...current, [p]: after }
      });
  }
  async function reviewChanges(text, state, id, current) {
    const p = parse(text),
      h = p.header,
      grant = state.members[h.sender.id];
    if (
      state.mode !== 'owner' ||
      state.owner.id !== id.public.id ||
      !grant ||
      canonical(grant) !== canonical(h.grant) ||
      grant.body.role !== 'editor' ||
      h.kind !== 'changes' ||
      h.recipient !== id.public.id ||
      h.householdId !== state.householdId ||
      h.epoch !== state.epoch ||
      h.sequence !== state.sent[h.sender.id]
    )
      throw Error(
        'Member is revoked, read-only, stale, or not authorized for this household.'
      );
    await checkGrant(grant, state.owner.id);
    const { signature, ...body } = p;
    await verify(body, signature, grant.body.member);
    if ((state.received || []).includes(h.id))
      throw Error('This change file was already accepted.');
    const payload = await decrypt(p, id);
    if (
      !Array.isArray(payload.changes) ||
      !payload.changes.length ||
      payload.changes.length > 1000 ||
      new Set(payload.changes.map((c) => c.path)).size !==
        payload.changes.length
    )
      throw Error('Invalid change list.');
    const scopedCurrent = scoped(current, grant.body.accounts),
      conflicts = [];
    for (const c of payload.changes) {
      if (
        (c.path.startsWith('entries/') ||
          c.path.startsWith('fxEntries/') ||
          c.path.startsWith('fxPlans/') ||
          c.path.startsWith('fxTransfers/') ||
          c.path.startsWith('fxBalances/')) &&
        current[c.path] &&
        !scopedCurrent[c.path]
      )
        throw Error('Entry belongs to a private account.');
      authorizeChange(
        c,
        scopedCurrent,
        grant.body,
        current['settings/main']?.closedThrough || ''
      );
      if (c.beforeHash !== (await hash(scopedCurrent[c.path] ?? null)))
        conflicts.push(c.path);
    }
    const operations = payload.changes.map((c) => {
      let data = c.data;
      if (c.path.startsWith('balances/')) {
        const prior = current[c.path] || {},
          values = Object.fromEntries(
            Object.entries(prior.values || {}).filter(
              ([account]) => !grant.body.accounts.includes(account)
            )
          );
        data = {
          ...prior,
          month: c.path.split('/')[1],
          values: { ...values, ...(data?.values || {}) }
        };
      }
      if (c.path.startsWith('transfers/')) {
        const keep = (current[c.path]?.items || []).filter(
          (t) =>
            !grant.body.accounts.includes(t.from) ||
            !grant.body.accounts.includes(t.to) ||
            (t.actual &&
              (!grant.body.accounts.includes(t.actual.from) ||
                !grant.body.accounts.includes(t.actual.to)))
        );
        data = {
          ...(current[c.path] || {}),
          month: c.path.split('/')[1],
          items: [...keep, ...(data?.items || [])]
        };
      }
      if (data && c.path.startsWith('entries/'))
        data = { ...data, by: grant.body.member.id };
      return {
        type: data === null ? 'delete' : 'set',
        path: c.path,
        ...(data === null ? {} : { data })
      };
    });
    return {
      packetId: h.id,
      member: grant.body.member,
      changes: payload.changes,
      operations,
      conflicts,
      state: {
        ...copy(state),
        received: [...(state.received || []), h.id].slice(-1000)
      }
    };
  }
  async function prove(id, challenge) {
    if (
      challenge?.purpose !== 'cashbook-billing-login' ||
      challenge.ownerId !== id.public.id ||
      typeof challenge.nonce !== 'string' ||
      !Number.isFinite(challenge.expires) ||
      challenge.expires < Date.now() - 300000 ||
      challenge.expires > Date.now() + 600000
    )
      throw Error('Invalid billing login challenge.');
    return sign(challenge, id);
  }
  return {
    sealPacket: envelope,
    prove,
    identity,
    checkIdentity,
    hash,
    canonical,
    request,
    readRequest,
    ownerState,
    makeGrant,
    checkGrant,
    revoke,
    scoped,
    snapshotPacket,
    receiveSnapshot,
    changesPacket,
    reviewChanges,
    authorizeChange
  };
});
