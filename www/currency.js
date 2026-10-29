/* Multi-currency subledger. Native units are never added across currencies. INR is the reporting currency. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CashbookCurrency = api;
})(globalThis, () => {
  'use strict';
  const list = (o) => Object.entries(o || {}).map(([id, v]) => ({ ...v, id }));
  function currency(code) {
    if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code))
      throw Error('Use a three-letter currency code.');
    if (
      Intl.supportedValuesOf &&
      !Intl.supportedValuesOf('currency').includes(code)
    )
      throw Error('Unsupported currency code.');
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return code;
  }
  const digits = (code) =>
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency(code)
    }).resolvedOptions().maximumFractionDigits;
  function amount(n, code) {
    if (!Number.isFinite(Number(n)) || Math.abs(Number(n)) > 1e12)
      throw Error('Invalid currency amount.');
    const factor = 10 ** digits(code);
    return Math.round((Number(n) + Number.EPSILON) * factor) / factor;
  }
  const format = (n, code) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: digits(code)
    }).format(n);
  function date(d) {
    const x = new Date(d + 'T12:00:00Z');
    if (
      typeof d !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
      !Number.isFinite(+x) ||
      x.toISOString().slice(0, 10) !== d
    )
      throw Error('Invalid ledger date.');
    return d;
  }
  function rate(code, on, rates) {
    if (code === 'INR') return 1;
    currency(code);
    date(on);
    const choices = list(rates)
      .filter((r) => r.currency === code && r.date <= on)
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    if (!choices.length) return null;
    return positive(choices[0].rateToINR);
  }
  function positive(n) {
    if (!Number.isFinite(Number(n)) || Number(n) <= 0 || Number(n) > 1e12)
      throw Error('Enter a positive finite amount/rate.');
    return Number(n);
  }
  function account(ref, state) {
    if (typeof ref !== 'string') throw Error('Choose an account.');
    const [book, ...parts] = ref.split(':'),
      id = parts.join(':');
    const a =
      book === 'fx'
        ? state.fxAccounts?.[id]
        : book === 'legacy'
          ? state.accounts?.[id]
          : null;
    if (!a) throw Error('Account does not exist.');
    return {
      ...a,
      id,
      book,
      currency: book === 'legacy' ? 'INR' : currency(a.currency)
    };
  }
  function validateAccount(a) {
    currency(a.currency);
    date(a.opened);
    if (amount(a.opening || 0, a.currency) !== Number(a.opening || 0))
      throw Error('Opening balance exceeds currency precision.');
    if (!['bank', 'card'].includes(a.kind))
      throw Error('Choose bank or credit card.');
    if (a.currency !== 'INR') positive(a.openingRateToINR);
    if (!String(a.name || '').trim()) throw Error('Name the account.');
  }
  function validateEntry(e, state) {
    date(e.date);
    const a = account('fx:' + e.accountId, state);
    if (
      !['income', 'expense'].includes(e.type) ||
      e.date < a.opened ||
      amount(positive(e.amount), a.currency) !== Number(e.amount)
    )
      throw Error('Invalid transaction, date or currency precision.');
    if (a.currency !== 'INR') positive(e.fxRateToINR);
    return e;
  }
  function validateTransfer(t, state) {
    date(t.date);
    const from = account(t.from, state),
      to = account(t.to, state);
    if (t.from === t.to) throw Error('Choose different accounts.');
    if (
      t.date < (from.opened || state.settings?.start + '-01') ||
      t.date < (to.opened || state.settings?.start + '-01')
    )
      throw Error('Transfer predates an account.');
    if (!['actual', 'planned'].includes(t.status || 'actual'))
      throw Error('Invalid transfer status.');
    for (const [n, c] of [
      [t.sourceAmount, from.currency],
      [t.receivedAmount, to.currency]
    ])
      if (amount(positive(n), c) !== Number(n))
        throw Error('Check transfer precision.');
    if (
      !Number.isFinite(Number(t.fee || 0)) ||
      t.fee < 0 ||
      amount(t.fee || 0, from.currency) !== Number(t.fee || 0)
    )
      throw Error('Invalid source-currency fee.');
    if (from.currency !== 'INR') positive(t.sourceToINR);
    if (to.currency !== 'INR') positive(t.targetToINR);
    return t;
  }
  function compute(state, on, { projected = false } = {}) {
    date(on);
    const accounts = state.fxAccounts || {},
      balances = {},
      basis = {},
      realized = {},
      missing = [],
      events = [],
      rows = [];
    let historicalIncome = 0,
      historicalExpenses = 0,
      feesINR = 0,
      executionDifference = 0;
    for (const [id, a] of Object.entries(accounts)) {
      validateAccount(a);
      if (a.opened <= on) {
        balances[id] = amount(a.opening || 0, a.currency);
        basis[id] =
          balances[id] * (a.currency === 'INR' ? 1 : a.openingRateToINR);
        realized[id] = 0;
      }
    }
    for (const e of list(state.fxEntries)) {
      validateEntry(e, state);
      if (e.date <= on) events.push({ ...e, event: 'entry' });
    }
    for (const t of list(state.fxTransfers)) {
      validateTransfer(t, state);
      if (
        t.date <= on &&
        (t.status !== 'planned' ||
          (projected &&
            t.date.slice(0, 7) > (state.settings?.closedThrough || '')))
      )
        events.push({ ...t, event: 'transfer' });
    }
    if (projected) {
      const seen = new Set();
      for (const p of list(state.fxPlans)) {
        const a = accounts[p.accountId];
        if (!a) throw Error('Plan account is missing.');
        const key = [p.accountId, p.month, p.type].join(':');
        if (seen.has(key))
          throw Error(
            'Only one income and one expense budget per account/month.'
          );
        seen.add(key);
        const when =
          p.month +
          '-' +
          String(
            Math.min(
              Number(p.day || 1),
              new Date(
                Number(p.month.slice(0, 4)),
                Number(p.month.slice(5, 7)),
                0
              ).getDate()
            )
          ).padStart(2, '0');
        date(when);
        if (!['income', 'expense'].includes(p.type))
          throw Error('Invalid currency plan.');
        if (
          when > on ||
          p.complete ||
          p.month <= (state.settings?.closedThrough || '')
        )
          continue;
        const actual = list(state.fxEntries)
            .filter(
              (e) =>
                e.accountId === p.accountId &&
                e.date.slice(0, 7) === p.month &&
                e.type === p.type
            )
            .reduce((n, e) => n + Number(e.amount), 0),
          remaining = amount(
            Math.max(0, Number(p.amount) - actual),
            a.currency
          );
        if (remaining)
          events.push({
            event: 'plan',
            id: p.id,
            accountId: p.accountId,
            type: p.type,
            amount: remaining,
            date: when
          });
      }
    }
    for (const r of list(state.fxBalances)) {
      if (r.date <= on) events.push({ ...r, event: 'reconcile' });
    }
    events.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        ['entry', 'transfer', 'plan', 'reconcile'].indexOf(a.event) -
          ['entry', 'transfer', 'plan', 'reconcile'].indexOf(b.event) ||
        a.id.localeCompare(b.id)
    );
    function move(id, n, atRate) {
      if (!(id in balances))
        throw Error('Activity predates an account opening.');
      const a = accounts[id],
        old = balances[id];
      if (n < 0) {
        const cost =
          old !== 0 ? basis[id] * Math.min(1, Math.abs(n / old)) : n * atRate;
        realized[id] += Math.abs(n) * atRate - Math.abs(cost);
        basis[id] += n * (old !== 0 ? basis[id] / old : atRate);
      } else basis[id] += n * atRate;
      balances[id] = amount(old + n, a.currency);
    }
    for (const e of events) {
      if (e.event === 'reconcile') {
        const a = accounts[e.accountId],
          r = a.currency === 'INR' ? 1 : e.fxRateToINR,
          difference = amount(e.balance - balances[e.accountId], a.currency);
        move(e.accountId, difference, r);
        rows.push({
          ...e,
          currency: a.currency,
          difference,
          recordedINR: difference * r
        });
      } else if (e.event === 'entry' || e.event === 'plan') {
        const a = accounts[e.accountId],
          r =
            e.event === 'plan'
              ? rate(a.currency, e.date, state.fxRates)
              : a.currency === 'INR'
                ? 1
                : e.fxRateToINR;
        if (r == null) missing.push(a.currency + ' on ' + e.date);
        const sign = e.type === 'income' ? 1 : -1;
        move(e.accountId, sign * e.amount, r || 0);
        if (e.event === 'entry') {
          if (sign > 0) historicalIncome += e.amount * r;
          else historicalExpenses += e.amount * r;
        }
        rows.push({
          ...e,
          currency: a.currency,
          projectedINR: e.amount * (r || 0),
          recordedINR: e.event === 'entry' ? e.amount * r : null
        });
      } else {
        const from = account(e.from, state),
          to = account(e.to, state),
          sr = from.currency === 'INR' ? 1 : e.sourceToINR,
          tr = to.currency === 'INR' ? 1 : e.targetToINR;
        if (from.book === 'fx')
          move(from.id, -Number(e.sourceAmount) - Number(e.fee || 0), sr);
        if (to.book === 'fx') move(to.id, Number(e.receivedAmount), tr);
        feesINR += Number(e.fee || 0) * sr;
        executionDifference +=
          Number(e.receivedAmount) * tr - Number(e.sourceAmount) * sr;
        rows.push({
          ...e,
          sourceCurrency: from.currency,
          targetCurrency: to.currency,
          feeINR: Number(e.fee || 0) * sr
        });
      }
    }
    let liquidINR = 0,
      assetsINR = 0,
      debtINR = 0;
    const valued = {};
    for (const [id, n] of Object.entries(balances)) {
      const a = accounts[id],
        confirmed = list(state.fxBalances).find(
          (r) => r.accountId === id && r.date === on
        ),
        r = confirmed
          ? a.currency === 'INR'
            ? 1
            : confirmed.fxRateToINR
          : rate(a.currency, on, state.fxRates);
      if (r == null) {
        missing.push(a.currency + ' on ' + on);
        valued[id] = { native: n, currency: a.currency, inr: null };
        continue;
      }
      const value = n * r;
      valued[id] = {
        native: n,
        currency: a.currency,
        inr: amount(value, 'INR'),
        costINR: amount(basis[id], 'INR'),
        revaluationINR: amount(value - basis[id], 'INR'),
        realizedINR: amount(realized[id], 'INR')
      };
      if (a.kind === 'card') {
        assetsINR += Math.max(0, value);
        debtINR -= Math.min(0, value);
      } else {
        liquidINR += value;
        assetsINR += value;
      }
    }
    return {
      balances,
      valued,
      rows,
      missing: [...new Set(missing)],
      liquidINR: missing.length ? null : amount(liquidINR, 'INR'),
      assetsINR: missing.length ? null : amount(assetsINR, 'INR'),
      debtINR: missing.length ? null : amount(debtINR, 'INR'),
      historicalIncomeINR: amount(historicalIncome, 'INR'),
      historicalExpensesINR: amount(historicalExpenses, 'INR'),
      feesINR: amount(feesINR, 'INR'),
      executionDifferenceINR: amount(executionDifference, 'INR')
    };
  }
  function legacyLegs(state, month, { actualOnly = false } = {}) {
    const out = [];
    for (const t of list(state.fxTransfers)) {
      validateTransfer(t, state);
      if (
        t.date.slice(0, 7) !== month ||
        (actualOnly && t.status === 'planned')
      )
        continue;
      const from = account(t.from, state),
        to = account(t.to, state);
      if (from.book === 'legacy')
        out.push({
          accountId: from.id,
          out: Number(t.sourceAmount) + Number(t.fee || 0),
          in: 0
        });
      if (to.book === 'legacy')
        out.push({ accountId: to.id, out: 0, in: Number(t.receivedAmount) });
    }
    return out;
  }
  function fromDocs(docs) {
    const state = {};
    for (const col of [
      'accounts',
      'fxAccounts',
      'fxEntries',
      'fxTransfers',
      'fxRates',
      'fxPlans',
      'fxBalances'
    ])
      state[col] = Object.fromEntries(
        Object.entries(docs)
          .filter(([p]) => p.startsWith(col + '/'))
          .map(([p, d]) => [p.split('/')[1], d])
      );
    state.settings = docs['settings/main'];
    return state;
  }
  function validateState(state) {
    for (const a of Object.values(state.fxAccounts || {})) validateAccount(a);
    for (const e of Object.values(state.fxEntries || {}))
      validateEntry(e, state);
    for (const t of Object.values(state.fxTransfers || {}))
      validateTransfer(t, state);
    for (const r of Object.values(state.fxBalances || {})) {
      const a = state.fxAccounts?.[r.accountId];
      date(r.date);
      if (
        !a ||
        r.date.slice(8) !==
          String(
            new Date(+r.date.slice(0, 4), +r.date.slice(5, 7), 0).getDate()
          ) ||
        amount(r.balance, a.currency) !== Number(r.balance) ||
        !Number.isFinite(r.expected) ||
        !Number.isFinite(r.difference) ||
        (Math.abs(r.difference) > 0.005 && !String(r.reason || '').trim())
      )
        throw Error('Invalid currency reconciliation.');
      if (a.currency !== 'INR') positive(r.fxRateToINR);
    }
    for (const r of Object.values(state.fxRates || {})) {
      currency(r.currency);
      date(r.date);
      positive(r.rateToINR);
    }
    for (const p of Object.values(state.fxPlans || {})) {
      const a = state.fxAccounts?.[p.accountId];
      if (
        !a ||
        !['income', 'expense'].includes(p.type) ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month) ||
        !Number.isInteger(p.day) ||
        p.day < 1 ||
        p.day > 31 ||
        p.amount < 0 ||
        amount(p.amount, a.currency) !== Number(p.amount)
      )
        throw Error('Invalid currency budget.');
    }
    return state;
  }
  function reconciliationStatus(state, month) {
    const end =
        month +
        '-' +
        new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate(),
      out = [];
    for (const [id, a] of Object.entries(state.fxAccounts || {})) {
      if (a.opened > end) continue;
      const found = Object.entries(state.fxBalances || {}).find(
        ([, r]) => r.accountId === id && r.date === end
      );
      if (!found) {
        out.push({ accountId: id, valid: false });
        continue;
      }
      const [key, r] = found,
        others = { ...state.fxBalances };
      delete others[key];
      const expected = compute({ ...state, fxBalances: others }, end).balances[
        id
      ];
      out.push({
        accountId: id,
        valid: amount(expected, a.currency) === amount(r.expected, a.currency),
        expected,
        record: r
      });
    }
    return out;
  }
  return {
    reconciliationStatus,
    fromDocs,
    validateState,
    currency,
    digits,
    amount,
    format,
    date,
    rate,
    account,
    validateAccount,
    validateEntry,
    validateTransfer,
    compute,
    legacyLegs
  };
});
