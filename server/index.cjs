'use strict';
const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path');
const { Store, BillingService } = require('./billing.cjs');
function configured(env = process.env) {
  return {
    mode: env.BILLING_MODE || 'sandbox',
    razorKeyId: env.RAZORPAY_KEY_ID,
    razorKeySecret: env.RAZORPAY_KEY_SECRET,
    razorWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    razorPlans: {
      monthly: env.RAZORPAY_MONTHLY_PLAN,
      annual: env.RAZORPAY_ANNUAL_PLAN
    },
    revenueSecret: env.REVENUECAT_SECRET_KEY,
    revenueEntitlement: env.REVENUECAT_ENTITLEMENT || 'plus',
    revenueWebhookAuth: env.REVENUECAT_WEBHOOK_AUTH,
    revenueWebhookSecret: env.REVENUECAT_WEBHOOK_SIGNING_SECRET,
    signingKey: env.BILLING_SIGNING_KEY?.replace(/\\n/g, '\n')
  };
}
function createServer(service, { origins = [], now = () => Date.now() } = {}) {
  const limits = new Map();
  return http.createServer(async (req, res) => {
    const reply = (status, value) => {
      if (res.writableEnded) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(JSON.stringify(value));
    };
    const origin = req.headers.origin;
    if (origin) {
      if (!origins.includes(origin))
        return reply(403, { error: 'Origin is not allowed.' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Idempotency-Key'
      );
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const route = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && route === '/health')
        return reply(200, {
          service: 'family-cashbook-billing',
          mode: service.config.mode,
          configured: !!service.config.signingKey
        });
      if (!(
        (req.method === 'GET' && route === '/api/entitlement') ||
        req.method === 'POST'
      ))
        return reply(405, { error: 'Method is not supported.' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 256 * 1024) {
          reply(413, { error: 'Request too large.' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks),
        token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (route.startsWith('/webhooks/'))
        return reply(
          200,
          await service.webhook(
            route.slice('/webhooks/'.length),
            req.headers,
            raw
          )
        );
      if (req.method === 'GET' && route === '/api/entitlement')
        return reply(200, service.token(token));
      const body = JSON.parse(raw.toString('utf8') || '{}');
      if (route === '/api/challenge') {
        const key = req.socket.remoteAddress,
          bucket = limits.get(key) || { start: now(), count: 0 };
        if (now() - bucket.start > 300000) {
          bucket.start = now();
          bucket.count = 0;
        }
        bucket.count++;
        limits.set(key, bucket);
        if (limits.size > 10000) limits.clear();
        if (bucket.count > 30)
          return reply(429, { error: 'Too many login attempts.' });
        return reply(200, await service.challenge(body.publicIdentity));
      }
      if (route === '/api/authenticate')
        return reply(
          200,
          await service.authenticate(body.challenge, body.signature)
        );
      if (route === '/api/refresh')
        return reply(200, await service.refresh(token));
      if (route === '/api/checkout')
        return reply(
          200,
          await service.checkout(
            token,
            body.plan,
            req.headers['idempotency-key']
          )
        );
      if (route === '/api/verify-razorpay')
        return reply(
          200,
          await service.verifyRazor(token, body.subscriptionId)
        );
      if (route === '/api/restore-store')
        return reply(200, await service.restore(token));
      return reply(404, { error: 'Endpoint not found.' });
    } catch (e) {
      reply(
        /Authentication|proof|login challenge/.test(e.message) ? 401 : 400,
        { error: e.message }
      );
    }
  });
}
if (require.main === module) {
  process.umask(0o077);
  const dir = path.resolve(process.env.BILLING_DATA_DIR || 'server/data');
  fs.mkdirSync(dir, { recursive: true });
  const service = new BillingService({
    store: new Store(path.join(dir, 'billing.sqlite')),
    config: configured()
  });
  const server = createServer(service, {
    origins: (process.env.BILLING_ALLOWED_ORIGINS || '')
      .split(',')
      .filter(Boolean)
  });
  server.listen(Number(process.env.PORT || 9341), '127.0.0.1', () =>
    console.log(
      'Billing service listening on loopback. Configure TLS and provider sandbox settings before use.'
    )
  );
}
module.exports = { createServer, configured };
