const test = require('node:test'),
  assert = require('node:assert/strict'),
  X = require('../www/currency'),
  Schema = require('../www/ledger-schema');
const state = () => ({
  settings: { start: '2026-01', end: '2026-12' },
  accounts: { bank: { name: 'INR bank', opening: 50000 } },
  fxAccounts: {
    usd: {
      name: 'Dollar bank',
      currency: 'USD',
      kind: 'bank',
      opened: '2026-01-01',
      opening: 1000,
      openingRateToINR: 80
    },
    eur: {
      name: 'Euro bank',
      currency: 'EUR',
      kind: 'bank',
      opened: '2026-01-01',
      opening: 100,
      openingRateToINR: 90
    }
  },
  fxEntries: {
    salary: {
      accountId: 'usd',
      type: 'income',
      amount: 500,
      date: '2026-10-05',
      fxRateToINR: 82
    },
    bill: {
      accountId: 'eur',
      type: 'expense',
      amount: 10,
      date: '2026-10-06',
      fxRateToINR: 91
    }
  },
  fxTransfers: {
    remit: {
      from: 'fx:usd',
      to: 'legacy:bank',
      sourceAmount: 200,
      receivedAmount: 16400,
      fee: 5,
      sourceToINR: 83,
      targetToINR: 1,
      date: '2026-10-07',
      status: 'actual'
    }
  },
  fxPlans: {},
  fxRates: {
    u: { currency: 'USD', date: '2026-01-01', rateToINR: 80 },
    u2: { currency: 'USD', date: '2026-10-20', rateToINR: 84 },
    e: { currency: 'EUR', date: '2026-01-01', rateToINR: 90 },
    e2: { currency: 'EUR', date: '2026-10-20', rateToINR: 92 }
  }
});
test('currency accounts retain native units and remittance fees/principal are distinct', () => {
  const s = state(),
    v = X.compute(s, '2026-10-31');
  assert.equal(v.balances.usd, 1295);
  assert.equal(v.balances.eur, 90);
  assert.equal(v.liquidINR, 117060);
  assert.equal(v.historicalIncomeINR, 41000);
  assert.equal(v.historicalExpensesINR, 910);
  assert.equal(v.feesINR, 415);
  assert.deepEqual(X.legacyLegs(s, '2026-10'), [
    { accountId: 'bank', out: 0, in: 16400 }
  ]);
});
test('historical posted rates are frozen while dated valuations change', () => {
  const s = state(),
    old = X.compute(s, '2026-10-15');
  assert.equal(old.valued.usd.inr, 103600);
  s.fxRates.later = { currency: 'USD', date: '2026-10-21', rateToINR: 90 };
  const later = X.compute(s, '2026-10-31');
  assert.equal(later.valued.usd.inr, 116550);
  assert.equal(later.historicalIncomeINR, 41000);
});
test('missing FX valuation is explicit and never treated as zero or 1:1', () => {
  const s = state();
  s.fxRates = {};
  const v = X.compute(s, '2026-10-31');
  assert.equal(v.liquidINR, null);
  assert.equal(v.valued.usd.inr, null);
  assert.ok(v.missing.length);
});
test('currency minor units respect JPY and KWD instead of always two decimals', () => {
  assert.equal(X.amount(123.5, 'JPY'), 124);
  assert.equal(X.amount(1.2345, 'KWD'), 1.235);
  const s = state();
  s.fxAccounts.usd.currency = 'JPY';
  s.fxEntries.salary.amount = 500.1;
  assert.throws(() => X.validateEntry(s.fxEntries.salary, s));
  assert.throws(() => X.currency('ABC'));
});
test('foreign credit card debt and positive credits value correctly', () => {
  const s = state();
  s.fxAccounts = {
    card: {
      name: 'Dollar card',
      currency: 'USD',
      kind: 'card',
      opened: '2026-01-01',
      opening: -100,
      openingRateToINR: 80
    }
  };
  s.fxEntries = {};
  s.fxTransfers = {};
  let v = X.compute(s, '2026-10-31');
  assert.equal(v.liquidINR, 0);
  assert.equal(v.debtINR, 8400);
  s.fxAccounts.card.opening = 100;
  v = X.compute(s, '2026-10-31');
  assert.equal(v.assetsINR, 8400);
  assert.equal(v.debtINR, 0);
});
test('planned foreign budgets retain remaining amounts and actual-only views exclude plans', () => {
  const s = state();
  s.fxPlans = {
    p: {
      accountId: 'usd',
      month: '2026-10',
      type: 'income',
      amount: 1000,
      day: 10,
      complete: false
    }
  };
  const a = X.compute(s, '2026-10-31'),
    p = X.compute(s, '2026-10-31', { projected: true });
  assert.equal(p.balances.usd - a.balances.usd, 500);
  s.fxPlans.p.complete = true;
  assert.equal(
    X.compute(s, '2026-10-31', { projected: true }).balances.usd,
    a.balances.usd
  );
});
test('planned remittances affect forecasts but not recorded legacy balances', () => {
  const s = state();
  s.fxTransfers.remit.status = 'planned';
  assert.equal(X.legacyLegs(s, '2026-10', { actualOnly: true }).length, 0);
  assert.equal(X.compute(s, '2026-10-31').balances.usd, 1500);
  assert.equal(
    X.compute(s, '2026-10-31', { projected: true }).balances.usd,
    1295
  );
});
test('invalid foreign rates, precision and references are rejected at backup boundary', () => {
  const s = state(),
    docs = {};
  for (const col of [
    'accounts',
    'fxAccounts',
    'fxEntries',
    'fxTransfers',
    'fxRates',
    'fxPlans'
  ])
    for (const [id, d] of Object.entries(s[col])) docs[col + '/' + id] = d;
  docs['settings/main'] = s.settings;
  assert.doesNotThrow(() => Schema.validate({ app: 'family-cashbook', docs }));
  docs['fxEntries/salary'].fxRateToINR = 0;
  assert.throws(() => Schema.validate({ app: 'family-cashbook', docs }));
});

test('currency reconciliation resets future native balances and freezes the closing valuation', () => {
  const s = state();
  s.fxBalances = {
    b: {
      accountId: 'usd',
      date: '2026-10-31',
      balance: 1300,
      expected: 1295,
      difference: 5,
      fxRateToINR: 85,
      reason: 'Bank statement reviewed'
    }
  };
  X.validateState(s);
  const v = X.compute(s, '2026-10-31');
  assert.equal(v.balances.usd, 1300);
  assert.equal(v.valued.usd.inr, 110500);
  s.fxRates.changed = { currency: 'USD', date: '2026-10-31', rateToINR: 999 };
  assert.equal(X.compute(s, '2026-10-31').valued.usd.inr, 110500);
  assert.equal(X.compute(s, '2026-11-01').balances.usd, 1300);
});

test('currency month close requires a refreshed reconciliation after native records change', () => {
  const s = state();
  s.fxAccounts = { usd: s.fxAccounts.usd };
  s.fxEntries = { salary: s.fxEntries.salary };
  s.fxTransfers = {};
  s.fxBalances = {
    b: {
      accountId: 'usd',
      date: '2026-10-31',
      balance: 1500,
      expected: 1500,
      difference: 0,
      fxRateToINR: 84,
      reason: ''
    }
  };
  assert.equal(X.reconciliationStatus(s, '2026-10')[0].valid, true);
  s.fxEntries.late = {
    accountId: 'usd',
    type: 'expense',
    amount: 100,
    date: '2026-10-29',
    fxRateToINR: 84
  };
  assert.equal(X.reconciliationStatus(s, '2026-10')[0].valid, false);
});
