(function () {
  'use strict';
  let A,
    busy = false,
    session = null,
    ownerId = null,
    packages = [],
    configuredOwner = null,
    lastSubscription = null,
    token = null;
  const $ = (s) => document.querySelector(s),
    esc = (s) =>
      String(s ?? '').replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
          })[c]
      ),
    cfg = () => window.CASHBOOK_CONFIG?.billing || {},
    native = () => !!window.Capacitor?.isNativePlatform?.(),
    btn = (a, t, extra = '') =>
      '<button class="btn" data-billing="' +
      a +
      '" ' +
      extra +
      '>' +
      t +
      '</button>';
  function render() {
    const c = cfg();
    return (
      '<section class="section"><div class="section-head"><h2>Purchases & entitlement verification</h2></div><div class="panel pad"><p>Existing records and basic export remain available. The current migration keeps existing tools accessible. Prices and trial terms come from the configured merchant/store products; this page does not invent them.</p><p>Billing mode: <b>' +
      esc(c.mode || 'not configured') +
      '</b>. ' +
      (c.serviceUrl && c.entitlementPublicKey
        ? 'Service configured. Purchases require an unlocked owner key.'
        : 'Merchant/store and verification service settings have not been supplied. Checkout is disabled.') +
      '</p><p>' +
      (token
        ? (token.active
            ? 'Verified Plus access'
            : 'No current verified Plus access') +
          ' · ' +
          esc(token.status) +
          ' · offline verification valid until ' +
          esc(
            token.offlineUntil
              ? new Date(token.offlineUntil).toISOString()
              : 'no paid access'
          )
        : 'No verified entitlement in this session.') +
      '</p>' +
      btn('connect', 'Verify owner / refresh entitlement') +
      ' ' +
      (native()
        ? btn('offerings', 'Load store products') +
          ' ' +
          btn('restore', 'Restore store purchases')
        : btn(
            'checkout-monthly',
            'View monthly checkout',
            c.purchasesEnabled ? '' : 'disabled'
          ) +
          ' ' +
          btn(
            'checkout-annual',
            'View annual checkout',
            c.purchasesEnabled ? '' : 'disabled'
          )) +
      (lastSubscription
        ? ' ' + btn('verify-web', 'Verify completed web purchase')
        : '') +
      '<div class="tool-grid">' +
      packages
        .map((p, i) =>
          btn(
            'purchase',
            esc(p.product?.title || p.identifier) +
              ' · ' +
              esc(p.product?.priceString || 'See store'),
            'data-index="' + i + '"'
          )
        )
        .join('') +
      '</div><p>Cancel through the provider/store used to purchase. A verified cancellation retains access through the paid period; refunds/expiry can remove Plus access. Cached paid access needs a fresh signature within 72 hours and never extends beyond the paid period. Restoring purchases revalidates with the provider.</p></div></section>'
    );
  }
  async function api(path, body, key) {
    const c = cfg();
    if (!c.serviceUrl || !c.entitlementPublicKey)
      throw Error('Billing service and verification key are not configured.');
    const u = new URL(c.serviceUrl);
    if (
      u.protocol !== 'https:' &&
      !['localhost', '127.0.0.1'].includes(u.hostname)
    )
      throw Error('Billing requires HTTPS.');
    const r = await fetch(c.serviceUrl.replace(/\/$/, '') + path, {
      signal: AbortSignal.timeout(15000),
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: 'Bearer ' + session } : {}),
        ...(key ? { 'Idempotency-Key': key } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error || 'Billing request failed.');
    return result;
  }
  async function connect() {
    const identity = window.CashbookFamilyUI?.publicIdentity();
    if (!identity)
      throw Error(
        'Unlock your owner member key in Family file exchange first.'
      );
    const family = A.state().family?.main;
    if (family?.mode !== 'owner' || family.owner.id !== identity.id)
      throw Error('The family owner must manage purchases.');
    ownerId = identity.id;
    try {
      const challenge = await api('/api/challenge', {
          publicIdentity: identity
        }),
        signature = await window.CashbookFamilyUI.prove(challenge),
        login = await api('/api/authenticate', { challenge, signature });
      session = login.session;
      ownerId = login.ownerId;
      await refresh();
    } catch (e) {
      if (networkError(e)) return cached();
      throw e;
    }
  }
  function networkError(e) {
    return (
      e instanceof TypeError ||
      e.name === 'AbortError' ||
      e.name === 'TimeoutError'
    );
  }
  async function cached() {
    const raw = localStorage.getItem('fcb-entitlement-' + ownerId);
    if (!raw) throw Error('No signed entitlement is available offline.');
    token = await CashbookEntitlements.verify(
      JSON.parse(raw),
      cfg().entitlementPublicKey,
      ownerId,
      Date.now(),
      cfg().mode || 'sandbox'
    );
    return token;
  }
  async function refresh() {
    if (!session) return connect();
    let signed;
    try {
      signed = await api('/api/refresh', {});
    } catch (e) {
      if (networkError(e)) return cached();
      throw e;
    }
    token = await CashbookEntitlements.verify(
      signed,
      cfg().entitlementPublicKey,
      ownerId,
      Date.now(),
      cfg().mode || 'sandbox'
    );
    localStorage.setItem('fcb-entitlement-' + ownerId, JSON.stringify(signed));
    return token;
  }
  async function purchases() {
    if (!native())
      throw Error('Store purchases require the installed Android/iOS app.');
    if (!session) await connect();
    if (!session)
      throw Error(
        'Reconnect to the billing service before buying or restoring.'
      );
    const P = window.CashbookNative?.Purchases,
      platform = window.Capacitor.getPlatform(),
      key =
        cfg()[platform === 'ios' ? 'revenueCatIosKey' : 'revenueCatAndroidKey'];
    if (!P || !key)
      throw Error('Store billing is not configured in this build.');
    if (configuredOwner === null) {
      await P.configure({ apiKey: key, appUserID: ownerId });
      configuredOwner = ownerId;
    } else if (configuredOwner !== ownerId) {
      await P.logIn({ appUserID: ownerId });
      configuredOwner = ownerId;
    }
    return P;
  }
  async function checkout(plan) {
    if (!cfg().purchasesEnabled)
      throw Error('Purchases have not been enabled for this build.');
    if (native()) throw Error('Use store billing in the installed mobile app.');
    if (!session) await connect();
    const keyName = 'fcb-checkout-' + ownerId + '-' + plan;
    let key = localStorage.getItem(keyName);
    if (!key) {
      key = crypto.randomUUID();
      localStorage.setItem(keyName, key);
    }
    const result = await api('/api/checkout', { plan }, key);
    lastSubscription = result.subscriptionId;
    if (!window.Razorpay)
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = resolve;
        script.onerror = () => reject(Error('Could not load checkout.'));
        document.head.append(script);
      });
    const widget = new window.Razorpay({
      key: result.keyId,
      subscription_id: result.subscriptionId,
      name: 'Family Cashbook',
      handler: async () => {
        try {
          await api('/api/verify-razorpay', {
            subscriptionId: result.subscriptionId
          });
          await refresh();
          localStorage.removeItem(keyName);
          A.toast('Purchase verified with the provider.');
        } catch (e) {
          A.toast(e.message);
        }
        A.refresh();
      }
    });
    widget.open();
  }
  async function action(t) {
    const a = t.dataset.billing;
    if (a === 'connect') return connect();
    if (a === 'offerings') {
      const P = await purchases(),
        o = await P.getOfferings();
      packages = o.current?.availablePackages || [];
      if (!packages.length) throw Error('No store products are configured.');
      return;
    }
    if (a === 'purchase') {
      if (!cfg().purchasesEnabled)
        throw Error('Purchases have not been enabled for this build.');
      const P = await purchases(),
        p = packages[Number(t.dataset.index)];
      if (!p) throw Error('Load store products first.');
      await P.purchasePackage({ aPackage: p });
      await api('/api/restore-store', {});
      return refresh();
    }
    if (a === 'restore') {
      const P = await purchases();
      await P.restorePurchases();
      await api('/api/restore-store', {});
      return refresh();
    }
    if (a === 'verify-web') {
      await api('/api/verify-razorpay', { subscriptionId: lastSubscription });
      return refresh();
    }
    if (a.startsWith('checkout-')) return checkout(a.slice(9));
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-billing]');
    if (!t || !A || busy || window.CashbookUI?.busy) return;
    busy = true;
    try {
      await action(t);
    } catch (e) {
      A.toast(e.message || 'Purchase could not be verified.');
    } finally {
      busy = false;
      A.refresh();
    }
  });
  window.addEventListener('pagehide', () => {
    session = null;
    token = null;
  });
  window.CashbookBillingUI = {
    attach: (api) => (A = api),
    render,
    get busy() {
      return busy;
    }
  };
})();
