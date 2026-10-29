/* Verify server-signed entitlements; a local paid flag is never evidence of a purchase. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CashbookEntitlements = api;
})(globalThis, () => {
  'use strict';
  const canonical = (x) =>
    x && typeof x === 'object'
      ? Array.isArray(x)
        ? '[' + x.map(canonical).join(',') + ']'
        : '{' +
          Object.keys(x)
            .sort()
            .map((k) => JSON.stringify(k) + ':' + canonical(x[k]))
            .join(',') +
          '}'
      : JSON.stringify(x);
  async function verify(
    token,
    publicJwk,
    ownerId,
    now = Date.now(),
    mode = 'sandbox'
  ) {
    if (!token?.payload || typeof token.signature !== 'string')
      throw Error('No signed entitlement.');
    const p = token.payload,
      key = await crypto.subtle.importKey(
        'jwk',
        publicJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      ),
      sig = Uint8Array.from(atob(token.signature), (c) => c.charCodeAt(0));
    if (
      !(await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        sig,
        new TextEncoder().encode(canonical(p))
      ))
    )
      throw Error('Entitlement signature is invalid.');
    if (
      p.issuer !== 'family-cashbook-billing' ||
      p.ownerId !== ownerId ||
      p.mode !== mode ||
      !Number.isFinite(p.verifiedAt) ||
      p.verifiedAt > now + 300000 ||
      !Number.isFinite(p.accessUntil) ||
      !Number.isFinite(p.offlineUntil) ||
      p.offlineUntil > p.verifiedAt + 72 * 3600000 ||
      p.offlineUntil > p.accessUntil
    )
      throw Error('Entitlement identity, mode or time is invalid.');
    return {
      ...p,
      active: p.plan === 'plus' && now <= p.accessUntil && now <= p.offlineUntil
    };
  }
  return { verify };
});
