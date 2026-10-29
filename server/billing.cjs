'use strict';
const {
  createHmac,
  timingSafeEqual,
  randomBytes,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify
} = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const F = require('../www/family-files');
const canonical = F.canonical,
  hash = (x) => createHash('sha256').update(x).digest('hex');
const equal = (a, b) => {
  const x = Buffer.from(a || ''),
    y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
};
class Store {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY,public TEXT NOT NULL);CREATE TABLE IF NOT EXISTS challenges(nonce TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL,public TEXT NOT NULL);CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS purchases(provider TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(provider,id));CREATE TABLE IF NOT EXISTS events(provider TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(provider,id));CREATE TABLE IF NOT EXISTS entitlements(owner TEXT PRIMARY KEY,state TEXT NOT NULL);CREATE TABLE IF NOT EXISTS attempts(owner TEXT NOT NULL,key TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(owner,key));`
    );
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
class BillingService {
  constructor({
    store = new Store(),
    fetcher = fetch,
    now = () => Date.now(),
    config = {}
  } = {}) {
    this.store = store;
    this.fetcher = fetcher;
    this.now = now;
    this.config = { mode: 'sandbox', offlineHours: 72, ...config };
    if (!['sandbox', 'live'].includes(this.config.mode))
      throw Error('Invalid billing mode.');
    this.locks = new Map();
  }
  async challenge(publicIdentity) {
    await F.checkIdentity(publicIdentity);
    const id = publicIdentity.id,
      nonce = randomBytes(32).toString('hex'),
      expires = this.now() + 5 * 60000;
    this.store.run('DELETE FROM challenges WHERE expires<?', this.now());
    this.store.run('DELETE FROM sessions WHERE expires<?', this.now());
    this.store.run(
      'INSERT INTO challenges VALUES(?,?,?,?)',
      nonce,
      id,
      expires,
      canonical(publicIdentity)
    );
    return { purpose: 'cashbook-billing-login', ownerId: id, nonce, expires };
  }
  async authenticate(challenge, signature) {
    const row = this.store.get(
      'SELECT * FROM challenges WHERE nonce=?',
      challenge.nonce
    );
    if (
      !row ||
      row.owner !== challenge.ownerId ||
      row.expires !== challenge.expires ||
      row.expires < this.now() ||
      challenge.purpose !== 'cashbook-billing-login'
    )
      throw Error('Expired or invalid login challenge.');
    const owner = JSON.parse(row.public),
      key = createPublicKey({ key: owner.sign, format: 'jwk' });
    if (
      !verify(
        'sha256',
        Buffer.from(canonical(challenge)),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64')
      )
    )
      throw Error('Owner proof failed.');
    const session = randomBytes(32).toString('hex');
    this.store.transaction(() => {
      const deleted = this.store.run(
        'DELETE FROM challenges WHERE nonce=?',
        challenge.nonce
      );
      if (deleted.changes !== 1) throw Error('Challenge already used.');
      this.store.run(
        'INSERT OR IGNORE INTO owners VALUES(?,?)',
        row.owner,
        row.public
      );
      this.store.run(
        'INSERT INTO sessions VALUES(?,?,?)',
        hash(session),
        row.owner,
        this.now() + 3600000
      );
    });
    return { session, ownerId: row.owner, expires: this.now() + 3600000 };
  }
  owner(session) {
    const s = this.store.get(
      'SELECT * FROM sessions WHERE hash=?',
      hash(session || '')
    );
    if (!s || s.expires < this.now()) throw Error('Authentication required.');
    return s.owner;
  }
  async serialized(key, fn) {
    const previous = this.locks.get(key) || Promise.resolve();
    const job = previous.catch(() => {}).then(fn);
    this.locks.set(key, job);
    try {
      return await job;
    } finally {
      if (this.locks.get(key) === job) this.locks.delete(key);
    }
  }
  async razor(path, options = {}) {
    const c = this.config;
    if (!c.razorKeyId || !c.razorKeySecret)
      throw Error('Razorpay is not configured.');
    if (c.mode === 'live' && c.razorKeyId.startsWith('rzp_test_'))
      throw Error('Sandbox billing key rejected in live mode.');
    if (c.mode !== 'live' && c.razorKeyId.startsWith('rzp_live_'))
      throw Error('Live billing key rejected in sandbox mode.');
    const response = await this.fetcher('https://api.razorpay.com/v1/' + path, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(c.razorKeyId + ':' + c.razorKeySecret).toString('base64'),
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!response.ok)
      throw Error('Payment provider request failed (' + response.status + ').');
    return response.json();
  }
  async checkout(session, plan, key) {
    const owner = this.owner(session);
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(key || ''))
      throw Error('Supply a stable checkout idempotency key.');
    if (!['monthly', 'annual'].includes(plan))
      throw Error('Invalid billing plan.');
    const planId = this.config.razorPlans?.[plan];
    if (!planId) throw Error('This billing plan is not configured.');
    return this.serialized(owner, async () => {
      const prior = this.store.get(
        'SELECT state FROM attempts WHERE owner=? AND key=?',
        owner,
        key
      );
      if (prior) {
        const state = JSON.parse(prior.state);
        if (state.subscriptionId) return state;
        throw Error(
          'Prior provider result is unknown. Reconcile it before starting another checkout.'
        );
      }
      const uncertain = this.store.db
        .prepare('SELECT state FROM attempts WHERE owner=?')
        .all(owner)
        .some((r) => JSON.parse(r.state).status === 'creating');
      if (uncertain)
        throw Error('An earlier checkout is awaiting reconciliation.');
      const existing = this.store.get(
        'SELECT state FROM entitlements WHERE owner=?',
        owner
      );
      if (existing) {
        const entitlement = JSON.parse(existing.state);
        if (entitlement.plan === 'plus' && entitlement.accessUntil > this.now())
          throw Error(
            'A paid subscription already exists. Manage it before buying another.'
          );
      }
      this.store.run(
        'INSERT INTO attempts VALUES(?,?,?)',
        owner,
        key,
        JSON.stringify({ status: 'creating', plan })
      );
      const sub = await this.razor('subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          plan_id: planId,
          total_count: plan === 'annual' ? 10 : 120,
          customer_notify: true,
          notes: { cashbook_owner: owner, cashbook_attempt: key }
        })
      });
      if (!sub.id) throw Error('Invalid provider subscription response.');
      const result = {
        subscriptionId: sub.id,
        keyId: this.config.razorKeyId,
        mode: this.config.mode
      };
      this.store.transaction(() => {
        this.store.run(
          'INSERT INTO purchases(provider,id,owner) VALUES(?,?,?)',
          'razorpay',
          sub.id,
          owner
        );
        this.store.run(
          'UPDATE attempts SET state=? WHERE owner=? AND key=?',
          JSON.stringify(result),
          owner,
          key
        );
      });
      return result;
    });
  }
  setEntitlement(owner, state) {
    const previous = this.store.get(
        'SELECT state FROM entitlements WHERE owner=?',
        owner
      ),
      old = previous ? JSON.parse(previous.state) : null;
    const sourceKey =
      this.config.mode +
      ':' +
      state.provider +
      (state.purchaseId ? ':' + state.purchaseId : '');
    const sources = {
        ...(old?.sources || {}),
        [sourceKey]: {
          ...state,
          mode: this.config.mode,
          verifiedAt: this.now()
        }
      },
      active = Object.values(sources)
        .filter(
          (s) =>
            s.mode === this.config.mode &&
            s.plan === 'plus' &&
            s.accessUntil > this.now()
        )
        .sort((a, b) => b.accessUntil - a.accessUntil),
      selected = active[0] || state;
    const next = {
      ...selected,
      sources,
      ownerId: owner,
      verifiedAt: selected.verifiedAt || this.now(),
      revision: (old?.revision || 0) + 1,
      mode: this.config.mode
    };
    this.store.run(
      'INSERT INTO entitlements VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET state=excluded.state',
      owner,
      JSON.stringify(next)
    );
    return next;
  }
  async verifyRazor(session, id) {
    const owner = this.owner(session);
    return this.serialized(owner, () => this.refreshRazor(owner, id));
  }
  async refreshRazor(owner, id) {
    const purchase = this.store.get(
      'SELECT * FROM purchases WHERE provider=? AND id=?',
      'razorpay',
      id
    );
    if (!purchase || purchase.owner !== owner)
      throw Error('This purchase belongs to another owner.');
    const sub = await this.razor('subscriptions/' + encodeURIComponent(id));
    if (
      sub.id !== id ||
      sub.notes?.cashbook_owner !== owner ||
      !Object.values(this.config.razorPlans || {}).includes(sub.plan_id)
    )
      throw Error('Provider purchase ownership or plan mismatch.');
    const until = Number(sub.current_end || 0) * 1000,
      paid = Number(sub.paid_count || 0) > 0,
      active =
        !purchase.revoked &&
        paid &&
        ['active', 'cancelled', 'completed', 'halted', 'pending'].includes(
          sub.status
        ) &&
        until > this.now();
    return this.setEntitlement(owner, {
      provider: 'razorpay',
      purchaseId: id,
      plan: active ? 'plus' : 'free',
      status: purchase.revoked ? 'refunded' : sub.status,
      accessUntil: active ? until : 0,
      willRenew: sub.status === 'active'
    });
  }
  async revenue(owner) {
    if (!this.config.revenueSecret)
      throw Error('RevenueCat server validation is not configured.');
    const r = await this.fetcher(
      'https://api.revenuecat.com/v1/subscribers/' + encodeURIComponent(owner),
      {
        headers: { Authorization: 'Bearer ' + this.config.revenueSecret },
        signal: AbortSignal.timeout(15000)
      }
    );
    if (!r.ok) throw Error('Store validation request failed.');
    const body = await r.json(),
      e =
        body.subscriber?.entitlements?.[
          this.config.revenueEntitlement || 'plus'
        ],
      sub = e ? body.subscriber?.subscriptions?.[e.product_identifier] : null,
      until = e ? Date.parse(e.expires_date) : 0;
    const active = !!(
      e &&
      sub &&
      Number.isFinite(until) &&
      until > this.now() &&
      !(this.config.mode === 'live' && sub.is_sandbox) &&
      !sub.refunded_at
    );
    return this.setEntitlement(owner, {
      provider: 'revenuecat',
      plan: active ? 'plus' : 'free',
      status: active
        ? String(sub.period_type).toLowerCase() === 'trial'
          ? 'trial'
          : sub.unsubscribe_detected_at
            ? 'cancelled'
            : 'active'
        : 'expired',
      accessUntil: active ? until : 0,
      willRenew: active && !sub.unsubscribe_detected_at
    });
  }
  async restore(session) {
    const owner = this.owner(session);
    return this.serialized(owner, () => this.revenue(owner));
  }
  async webhook(provider, headers, raw) {
    if (!Buffer.isBuffer(raw) || raw.length > 256 * 1024)
      throw Error('Invalid webhook body.');
    let event, id, owner, subscription;
    if (provider === 'razorpay') {
      if (
        !this.config.razorWebhookSecret ||
        !equal(
          createHmac('sha256', this.config.razorWebhookSecret)
            .update(raw)
            .digest('hex'),
          headers['x-razorpay-signature']
        )
      )
        throw Error('Invalid webhook signature.');
      event = JSON.parse(raw);
      id = headers['x-razorpay-event-id'];
      subscription =
        event.payload?.subscription?.entity?.id ||
        event.payload?.payment?.entity?.subscription_id;
      if (!subscription && event.payload?.payment?.entity?.invoice_id) {
        const invoice = await this.razor(
          'invoices/' +
            encodeURIComponent(event.payload.payment.entity.invoice_id)
        );
        subscription = invoice.subscription_id;
      }
      const purchase = subscription
        ? this.store.get(
            'SELECT * FROM purchases WHERE provider=? AND id=?',
            provider,
            subscription
          )
        : null;
      owner = purchase?.owner;
      if (!id) throw Error('Missing provider event ID.');
    } else if (provider === 'revenuecat') {
      if (
        !this.config.revenueWebhookAuth ||
        !equal(this.config.revenueWebhookAuth, headers.authorization)
      )
        throw Error('Invalid store webhook authorization.');
      if (this.config.revenueWebhookSecret) {
        const parts = Object.fromEntries(
            String(headers['x-revenuecat-webhook-signature'] || '')
              .split(',')
              .map((x) => x.trim().split('='))
          ),
          timestamp = Number(parts.t);
        if (
          !Number.isFinite(timestamp) ||
          Math.abs(this.now() / 1000 - timestamp) > 300 ||
          !equal(
            createHmac('sha256', this.config.revenueWebhookSecret)
              .update(parts.t + '.')
              .update(raw)
              .digest('hex'),
            parts.v1
          )
        )
          throw Error('Invalid store webhook signature.');
      }
      event = JSON.parse(raw).event;
      id = event?.id;
      owner = event?.app_user_id;
      if (!id || !owner) throw Error('Invalid store event.');
      if (this.config.mode === 'live' && event.environment !== 'PRODUCTION')
        throw Error('Sandbox event rejected in live mode.');
    } else throw Error('Unknown provider.');
    if (!owner || !this.store.get('SELECT id FROM owners WHERE id=?', owner))
      return { ignored: true };
    return this.serialized(owner, async () => {
      if (
        this.store.get(
          'SELECT id FROM events WHERE provider=? AND id=?',
          provider,
          id
        )
      )
        return { duplicate: true };
      if (provider === 'razorpay') {
        const payment = event.payload?.payment?.entity;
        if (
          event.event === 'payment.refunded' &&
          payment &&
          Number(payment.amount_refunded) >= Number(payment.amount) &&
          Number(payment.amount) > 0
        ) {
          this.store.transaction(() => {
            this.store.run(
              'UPDATE purchases SET revoked=1 WHERE provider=? AND id=?',
              provider,
              subscription
            );
            this.setEntitlement(owner, {
              provider: 'razorpay',
              purchaseId: subscription,
              plan: 'free',
              status: 'refunded',
              accessUntil: 0,
              willRenew: false
            });
            this.store.run(
              'INSERT OR IGNORE INTO events VALUES(?,?)',
              provider,
              id
            );
          });
          return { processed: true };
        }
        await this.refreshRazor(owner, subscription);
      } else await this.revenue(owner);
      this.store.run('INSERT OR IGNORE INTO events VALUES(?,?)', provider, id);
      return { processed: true };
    });
  }
  async refresh(session) {
    const owner = this.owner(session);
    return this.serialized(owner, async () => {
      const rows = this.store.db
        .prepare('SELECT id FROM purchases WHERE owner=? AND provider=?')
        .all(owner, 'razorpay');
      for (const row of rows) await this.refreshRazor(owner, row.id);
      if (this.config.revenueSecret) await this.revenue(owner);
      return this.token(session);
    });
  }
  token(session) {
    const owner = this.owner(session),
      row = this.store.get(
        'SELECT state FROM entitlements WHERE owner=?',
        owner
      );
    const state = row
      ? JSON.parse(row.state)
      : {
          ownerId: owner,
          plan: 'free',
          status: 'unverified',
          accessUntil: 0,
          verifiedAt: this.now(),
          revision: 0,
          mode: this.config.mode
        };
    if (!this.config.signingKey)
      throw Error('Entitlement signing key is not configured.');
    const payload = {
      issuer: 'family-cashbook-billing',
      ...state,
      offlineUntil: Math.min(
        state.accessUntil,
        state.verifiedAt + this.config.offlineHours * 3600000
      )
    };
    const signature = sign('sha256', Buffer.from(canonical(payload)), {
      key: createPrivateKey(this.config.signingKey),
      dsaEncoding: 'ieee-p1363'
    }).toString('base64');
    return { payload, signature };
  }
}
module.exports = { Store, BillingService };
