const test = require('node:test'),
  assert = require('node:assert/strict'),
  F = require('../www/family-files');
const clone = (x) => JSON.parse(JSON.stringify(x));
const docs = {
  'settings/main': { start: '2026-01', end: '2026-12', currency: 'INR' },
  'accounts/shared': { name: 'Household', opening: 10000 },
  'accounts/private': { name: 'Secret', opening: 99999 },
  'categories/food': {
    name: 'Food',
    type: 'expense',
    account: 'shared',
    amounts: { '2026-10': 1000 }
  },
  'categories/private': {
    name: 'Secret budget',
    type: 'expense',
    account: 'private',
    amounts: { '2026-10': 9999 }
  },
  'balances/2026-10': {
    month: '2026-10',
    values: { shared: 9000, private: 99999 }
  },
  'features/secret': { type: 'scenario', name: 'Private scenario' },
  'transfers/2026-10': {
    month: '2026-10',
    items: [{ id: 'private-t', from: 'private', to: 'shared', amount: 500 }]
  }
};
async function setup(role = 'editor') {
  const owner = await F.identity('Owner'),
    member = await F.identity('Member');
  let state = F.ownerState(owner);
  state.members[member.public.id] = await F.makeGrant(
    state,
    owner,
    member.public,
    role,
    ['shared']
  );
  const out = await F.snapshotPacket(state, owner, member.public.id, docs);
  state = out.state;
  const received = await F.receiveSnapshot(
    JSON.stringify(out.packet),
    member,
    owner.public.id
  );
  return { owner, member, state, out, received };
}
test('member request requires independently verified fingerprint and valid self-signature', async () => {
  const id = await F.identity('Member'),
    r = await F.request(id);
  assert.equal((await F.readRequest(r, id.public.id)).id, id.public.id);
  await assert.rejects(F.readRequest(r, '0'.repeat(64)));
  r.member.name = 'Forged';
  await assert.rejects(F.readRequest(r, id.public.id));
});
test('recipient encryption excludes private accounts, aggregates and crossing transfers', async () => {
  const h = await setup(),
    raw = JSON.stringify(h.out.packet);
  assert.ok(!raw.includes('Secret'));
  assert.ok(!h.received.docs['accounts/private']);
  assert.ok(!h.received.docs['categories/private']);
  assert.ok(!h.received.docs['features/secret']);
  assert.ok(!h.received.docs['transfers/2026-10']);
  assert.deepEqual(h.received.docs['balances/2026-10'].values, {
    shared: 9000
  });
  const stranger = await F.identity('Stranger');
  await assert.rejects(F.receiveSnapshot(raw, stranger, h.owner.public.id));
});
test('snapshot pinning, tamper, replay and rollback are rejected', async () => {
  const h = await setup(),
    raw = JSON.stringify(h.out.packet);
  await assert.rejects(F.receiveSnapshot(raw, h.member, '0'.repeat(64)));
  await assert.rejects(
    F.receiveSnapshot(raw, h.member, h.owner.public.id, h.received.state)
  );
  const bad = clone(h.out.packet);
  bad.data = 'AAAA' + bad.data.slice(4);
  await assert.rejects(
    F.receiveSnapshot(JSON.stringify(bad), h.member, h.owner.public.id)
  );
});
test('viewer cannot send changes, including when its local role flag is modified', async () => {
  const h = await setup('viewer'),
    changed = clone(h.received.docs);
  changed['balances/2026-10'].values.shared = 8000;
  await assert.rejects(
    F.changesPacket(h.received.state, h.member, h.received.docs, changed)
  );
  const forged = clone(h.received.state);
  forged.grant.body.role = 'editor';
  await assert.rejects(
    F.changesPacket(forged, h.member, h.received.docs, changed)
  );
});
test('editor updates preserve owner private balance values and crossing transfers', async () => {
  const h = await setup(),
    changed = clone(h.received.docs);
  changed['balances/2026-10'].values.shared = 8000;
  changed['entries/new'] = {
    date: '2026-10-01',
    month: '2026-10',
    categoryId: 'food',
    accountId: 'shared',
    amount: 1000
  };
  const packet = await F.changesPacket(
      h.received.state,
      h.member,
      h.received.docs,
      changed
    ),
    review = await F.reviewChanges(
      JSON.stringify(packet),
      h.state,
      h.owner,
      docs
    );
  assert.deepEqual(review.conflicts, []);
  const balance = review.operations.find((o) => o.path === 'balances/2026-10');
  assert.equal(balance.data.values.private, 99999);
  assert.equal(balance.data.values.shared, 8000);
  assert.equal(
    review.operations.find((o) => o.path === 'entries/new').data.by,
    h.member.public.id
  );
  await assert.rejects(
    F.reviewChanges(JSON.stringify(packet), review.state, h.owner, docs)
  );
});
test('revocation rotates grant epoch and denies previously signed editor changes', async () => {
  const h = await setup(),
    changed = clone(h.received.docs);
  changed['balances/2026-10'].values.shared = 8000;
  const packet = await F.changesPacket(
      h.received.state,
      h.member,
      h.received.docs,
      changed
    ),
    revoked = await F.revoke(h.state, h.owner, h.member.public.id);
  await assert.rejects(
    F.reviewChanges(JSON.stringify(packet), revoked, h.owner, docs)
  );
  await assert.rejects(
    F.snapshotPacket(revoked, h.owner, h.member.public.id, docs)
  );
});
test('concurrent owner edits produce review conflicts instead of overwriting', async () => {
  const h = await setup(),
    changed = clone(h.received.docs);
  changed['balances/2026-10'].values.shared = 8000;
  const packet = await F.changesPacket(
      h.received.state,
      h.member,
      h.received.docs,
      changed
    ),
    ownerDocs = clone(docs);
  ownerDocs['balances/2026-10'].values.shared = 7500;
  const review = await F.reviewChanges(
    JSON.stringify(packet),
    h.state,
    h.owner,
    ownerDocs
  );
  assert.deepEqual(review.conflicts, ['balances/2026-10']);
});
test('closed periods, private scope and protected configuration are denied at import policy boundary', () => {
  const grant = { accounts: ['shared'] };
  assert.throws(() =>
    F.authorizeChange({ path: 'settings/main', data: {} }, docs, grant, '')
  );
  assert.throws(() =>
    F.authorizeChange(
      {
        path: 'entries/e',
        data: {
          date: '2026-09-01',
          month: '2026-09',
          categoryId: 'food',
          accountId: 'shared',
          amount: 1
        }
      },
      docs,
      grant,
      '2026-09'
    )
  );
  assert.throws(() =>
    F.authorizeChange(
      {
        path: 'entries/e',
        data: {
          date: '2026-10-01',
          month: '2026-10',
          categoryId: 'private',
          accountId: 'private',
          amount: 1
        }
      },
      docs,
      grant,
      ''
    )
  );
});

test('standalone store enforces viewer and scoped editor mutations at its write API', async () => {
  const { harness } = require('./harness.cjs'),
    h = await setup('viewer'),
    payload = {
      app: 'family-cashbook',
      version: 2,
      docs: { ...h.received.docs, 'family/main': h.received.state }
    };
  const viewer = harness({ initial: payload }),
    db = await viewer.db;
  await assert.rejects(
    db.doc('entries/local-viewer-write').set({
      date: '2026-10-01',
      month: '2026-10',
      categoryId: 'food',
      accountId: 'shared',
      amount: 1
    }),
    /read-only/
  );
  const editor = await setup('editor'),
    e = harness({
      initial: {
        app: 'family-cashbook',
        version: 2,
        docs: { ...editor.received.docs, 'family/main': editor.received.state }
      }
    }),
    edb = await e.db;
  await edb.doc('entries/allowed').set({
    date: '2026-10-01',
    month: '2026-10',
    categoryId: 'food',
    accountId: 'shared',
    amount: 100
  });
  await assert.rejects(
    edb.doc('settings/main').update({ closedThrough: '2026-10' })
  );
  await assert.rejects(edb.doc('accounts/shared').update({ opening: 999999 }));
});

test('owner rejects a custom client with a valid signature that targets private or protected records', async () => {
  const h = await setup(),
    grant = h.state.members[h.member.public.id],
    header = {
      id: crypto.randomUUID(),
      householdId: h.state.householdId,
      kind: 'changes',
      sender: h.member.public,
      recipient: h.owner.public.id,
      epoch: h.state.epoch,
      sequence: h.state.sent[h.member.public.id],
      grant
    };
  for (const change of [
    {
      path: 'settings/main',
      beforeHash: await F.hash(h.received.docs['settings/main']),
      data: { start: '2026-01', end: '2026-12', closedThrough: '2026-10' }
    },
    {
      path: 'balances/2026-10',
      beforeHash: await F.hash(h.received.docs['balances/2026-10']),
      data: { month: '2026-10', values: { shared: 9000, private: 0 } }
    }
  ]) {
    const packet = await F.sealPacket(
      { ...header, id: crypto.randomUUID() },
      { changes: [change] },
      h.member,
      h.owner.public
    );
    await assert.rejects(
      F.reviewChanges(JSON.stringify(packet), h.state, h.owner, docs)
    );
  }
});
test('a correctly signed viewer proposal from a hostile client is denied by the owner', async () => {
  const h = await setup('viewer'),
    grant = h.state.members[h.member.public.id],
    header = {
      id: crypto.randomUUID(),
      householdId: h.state.householdId,
      kind: 'changes',
      sender: h.member.public,
      recipient: h.owner.public.id,
      epoch: h.state.epoch,
      sequence: h.state.sent[h.member.public.id],
      grant
    },
    packet = await F.sealPacket(
      header,
      {
        changes: [
          {
            path: 'balances/2026-10',
            beforeHash: await F.hash(h.received.docs['balances/2026-10']),
            data: { month: '2026-10', values: { shared: 0 } }
          }
        ]
      },
      h.member,
      h.owner.public
    );
  await assert.rejects(
    F.reviewChanges(JSON.stringify(packet), h.state, h.owner, docs)
  );
});

test('restoring an owner backup does not reactivate revoked members or old proposal counters', async () => {
  const { harness } = require('./harness.cjs'),
    h = await setup(),
    saved = {
      app: 'family-cashbook',
      version: 2,
      docs: { ...docs, 'family/main': h.state }
    },
    local = harness({ initial: saved }),
    db = await local.db;
  await db.doc('family/main').get();
  await local.api.importData(JSON.stringify(saved));
  const restored = (await db.doc('family/main').get()).data();
  assert.deepEqual(Object.keys(restored.members), []);
  assert.ok(restored.epoch > h.state.epoch);
  assert.equal(restored.reinviteRequired, true);
});
