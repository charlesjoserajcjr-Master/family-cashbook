const test = require('node:test'),
  assert = require('node:assert/strict');
const { generateKeyPairSync, createHmac } = require('node:crypto');
const { BillingService, Store } = require('../server/billing.cjs');
const F = require('../www/family-files'),
  E = require('../www/entitlements');
async function fixture() {
  const now = Date.now(),
    id = await F.identity('Owner'),
    keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
    store = new Store();
  let sub = {
      id: 'sub_test',
      plan_id: 'plan_month',
      status: 'active',
      paid_count: 1,
      current_end: Math.floor(now / 1000) + 30 * 86400,
      notes: { cashbook_owner: id.public.id }
    },
    calls = 0,
    revenue = {
      subscriber: {
        entitlements: {
          plus: {
            expires_date: new Date(now + 30 * 86400000).toISOString(),
            product_identifier: 'plus.monthly'
          }
        },
        subscriptions: {
          'plus.monthly': { is_sandbox: true, period_type: 'trial' }
        }
      }
    };
  const service = new BillingService({
    store,
    now: () => now,
    config: {
      mode: 'sandbox',
      razorKeyId: 'rzp_test_UNIT_TEST',
      razorKeySecret: 'unit-test-fake-secret',
      razorWebhookSecret: 'unit-test-webhook',
      razorPlans: { monthly: 'plan_month', annual: 'plan_year' },
      revenueSecret: 'unit-test-server-key',
      revenueWebhookAuth: 'Bearer unit-test-webhook',
      revenueEntitlement: 'plus',
      signingKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' })
    },
    fetcher: async (url, opts) => {
      calls++;
      if (url.endsWith('/subscriptions') && opts.method === 'POST') {
        const b = JSON.parse(opts.body);
        assert.equal(b.notes.cashbook_owner, id.public.id);
        return new Response(JSON.stringify({ ...sub, status: 'created' }));
      }
      if (url.includes('/subscriptions/'))
        return new Response(JSON.stringify(sub));
      if (url.includes('/subscribers/'))
        return new Response(JSON.stringify(revenue));
      throw Error('Unexpected provider request.');
    }
  });
  const c = await service.challenge(id.public),
    signature = await F.prove(id, c),
    auth = await service.authenticate(c, signature);
  return {
    id,
    now,
    store,
    service,
    auth,
    publicKey: keys.publicKey.export({ format: 'jwk' }),
    sub: () => sub,
    setSub: (s) => (sub = s),
    setRevenue: (r) => (revenue = r),
    calls: () => calls
  };
}
test('owner authentication requires a valid signature and single-use challenge', async () => {
  const h = await fixture(),
    c = await h.service.challenge(h.id.public),
    sig = await F.prove(h.id, c);
  await assert.rejects(h.service.authenticate(c, 'AAAA'));
  await h.service.authenticate(c, sig);
  await assert.rejects(h.service.authenticate(c, sig));
  assert.throws(() => h.service.owner('fake-session'));
  h.store.close();
});
test('web checkout is idempotent, provider verified and bound to owner', async () => {
  const h = await fixture(),
    key = 'request-000000000000001',
    a = await h.service.checkout(h.auth.session, 'monthly', key),
    b = await h.service.checkout(h.auth.session, 'monthly', key);
  assert.equal(a.subscriptionId, b.subscriptionId);
  assert.equal(h.calls(), 1);
  await h.service.verifyRazor(h.auth.session, a.subscriptionId);
  const signed = h.service.token(h.auth.session),
    valid = await E.verify(signed, h.publicKey, h.id.public.id, h.now);
  assert.equal(valid.active, true);
  const other = await F.identity('Other'),
    challenge = await h.service.challenge(other.public),
    auth = await h.service.authenticate(
      challenge,
      await F.prove(other, challenge)
    );
  await assert.rejects(h.service.verifyRazor(auth.session, a.subscriptionId));
  h.store.close();
});
test('uncertain checkout response is not retried into a duplicate charge', async () => {
  const h = await fixture();
  h.service.fetcher = async () => {
    throw Error('Lost provider acknowledgement');
  };
  await assert.rejects(
    h.service.checkout(h.auth.session, 'monthly', 'request-000000000000001')
  );
  await assert.rejects(
    h.service.checkout(h.auth.session, 'monthly', 'request-000000000000001'),
    /Reconcile/
  );
  h.store.close();
});
test('forged/local paid flags, wrong owner and expired offline grace cannot grant access', async () => {
  const h = await fixture();
  await h.service.checkout(
    h.auth.session,
    'monthly',
    'request-000000000000001'
  );
  await h.service.verifyRazor(h.auth.session, 'sub_test');
  const signed = h.service.token(h.auth.session);
  await assert.rejects(
    E.verify(
      {
        ...signed,
        payload: { ...signed.payload, accessUntil: h.now + 999999999 }
      },
      h.publicKey,
      h.id.public.id,
      h.now
    )
  );
  await assert.rejects(E.verify(signed, h.publicKey, 'another-owner', h.now));
  assert.equal(
    (
      await E.verify(
        signed,
        h.publicKey,
        h.id.public.id,
        h.now + 72 * 3600000 + 1
      )
    ).active,
    false
  );
  h.store.close();
});
test('webhooks validate raw signatures, ignore duplicates and revoke full refunds', async () => {
  const h = await fixture();
  await h.service.checkout(
    h.auth.session,
    'monthly',
    'request-000000000000001'
  );
  const raw = Buffer.from(
      JSON.stringify({
        event: 'subscription.charged',
        payload: { subscription: { entity: { id: 'sub_test' } } }
      })
    ),
    headers = {
      'x-razorpay-signature': createHmac('sha256', 'unit-test-webhook')
        .update(raw)
        .digest('hex'),
      'x-razorpay-event-id': 'evt_1'
    };
  await assert.rejects(
    h.service.webhook(
      'razorpay',
      { ...headers, 'x-razorpay-signature': 'fake' },
      raw
    )
  );
  assert.equal(
    (await h.service.webhook('razorpay', headers, raw)).processed,
    true
  );
  const rev = h.service.token(h.auth.session).payload.revision;
  assert.equal(
    (await h.service.webhook('razorpay', headers, raw)).duplicate,
    true
  );
  assert.equal(h.service.token(h.auth.session).payload.revision, rev);
  const refund = Buffer.from(
    JSON.stringify({
      event: 'payment.refunded',
      payload: {
        payment: {
          entity: {
            subscription_id: 'sub_test',
            amount: 99900,
            amount_refunded: 99900
          }
        }
      }
    })
  );
  await h.service.webhook(
    'razorpay',
    {
      'x-razorpay-signature': createHmac('sha256', 'unit-test-webhook')
        .update(refund)
        .digest('hex'),
      'x-razorpay-event-id': 'evt_refund'
    },
    refund
  );
  assert.equal(h.service.token(h.auth.session).payload.plan, 'free');
  h.store.close();
});
test('cancellation retains paid-through access; expiry does not', async () => {
  const h = await fixture();
  await h.service.checkout(
    h.auth.session,
    'monthly',
    'request-000000000000001'
  );
  h.setSub({ ...h.sub(), status: 'cancelled' });
  await h.service.verifyRazor(h.auth.session, 'sub_test');
  assert.equal(h.service.token(h.auth.session).payload.plan, 'plus');
  assert.equal(h.service.token(h.auth.session).payload.willRenew, false);
  h.setSub({ ...h.sub(), current_end: Math.floor(h.now / 1000) - 1 });
  await h.service.verifyRazor(h.auth.session, 'sub_test');
  assert.equal(h.service.token(h.auth.session).payload.plan, 'free');
  h.store.close();
});
test('native store restore revalidates trial/cancellation/expiry and live mode rejects sandbox', async () => {
  const h = await fixture();
  assert.equal((await h.service.restore(h.auth.session)).status, 'trial');
  h.setRevenue({
    subscriber: {
      entitlements: {
        plus: {
          expires_date: new Date(h.now + 1000000).toISOString(),
          product_identifier: 'p'
        }
      },
      subscriptions: {
        p: { is_sandbox: true, unsubscribe_detected_at: '2026-10-01' }
      }
    }
  });
  assert.equal((await h.service.restore(h.auth.session)).status, 'cancelled');
  h.service.config.mode = 'live';
  assert.equal((await h.service.restore(h.auth.session)).plan, 'free');
  h.setRevenue({ subscriber: { entitlements: {}, subscriptions: {} } });
  assert.equal((await h.service.restore(h.auth.session)).status, 'expired');
  h.store.close();
});
test('RevenueCat authenticated webhook refreshes authoritative state for out-of-order events', async () => {
  const h = await fixture(),
    raw = Buffer.from(
      JSON.stringify({
        event: {
          id: 'rc-event-1',
          app_user_id: h.id.public.id,
          environment: 'SANDBOX',
          type: 'EXPIRATION'
        }
      })
    );
  await assert.rejects(
    h.service.webhook('revenuecat', { authorization: 'wrong' }, raw)
  );
  await h.service.webhook(
    'revenuecat',
    { authorization: 'Bearer unit-test-webhook' },
    raw
  );
  assert.equal(h.service.token(h.auth.session).payload.plan, 'plus');
  assert.equal(
    (
      await h.service.webhook(
        'revenuecat',
        { authorization: 'Bearer unit-test-webhook' },
        raw
      )
    ).duplicate,
    true
  );
  h.store.close();
});

test('restoring an empty store account does not erase an independently verified web subscription', async () => {
  const h = await fixture();
  await h.service.checkout(
    h.auth.session,
    'monthly',
    'request-000000000000001'
  );
  await h.service.verifyRazor(h.auth.session, 'sub_test');
  h.setRevenue({ subscriber: { entitlements: {}, subscriptions: {} } });
  await h.service.restore(h.auth.session);
  assert.equal(h.service.token(h.auth.session).payload.plan, 'plus');
  assert.equal(h.service.token(h.auth.session).payload.provider, 'razorpay');
  h.store.close();
});

test('sandbox entitlements cannot become live access by refreshing another provider', async () => {
  const h = await fixture();
  await h.service.checkout(
    h.auth.session,
    'monthly',
    'request-000000000000001'
  );
  await h.service.verifyRazor(h.auth.session, 'sub_test');
  h.service.config.mode = 'live';
  h.setRevenue({ subscriber: { entitlements: {}, subscriptions: {} } });
  await h.service.restore(h.auth.session);
  assert.equal(h.service.token(h.auth.session).payload.plan, 'free');
  await assert.rejects(
    h.service.verifyRazor(h.auth.session, 'sub_test'),
    /Sandbox billing key/
  );
  h.store.close();
});
test('HTTP billing boundary requires signed owner login and rejects unapproved origins', async () => {
  const { createServer } = require('../server/index.cjs'),
    h = await fixture(),
    server = createServer(h.service, { origins: ['http://localhost:7777'] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    let response = await fetch(url + '/api/entitlement');
    assert.equal(response.status, 401);
    response = await fetch(url + '/api/challenge', {
      method: 'POST',
      headers: {
        Origin: 'https://unapproved.example',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ publicIdentity: h.id.public })
    });
    assert.equal(response.status, 403);
    response = await fetch(url + '/api/challenge', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:7777',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ publicIdentity: h.id.public })
    });
    const challenge = await response.json();
    response = await fetch(url + '/api/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge,
        signature: await F.prove(h.id, challenge)
      })
    });
    const auth = await response.json();
    response = await fetch(url + '/api/entitlement', {
      headers: { Authorization: 'Bearer ' + auth.session }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).payload.ownerId, h.id.public.id);
  } finally {
    await new Promise((r) => server.close(r));
    h.store.close();
  }
});
