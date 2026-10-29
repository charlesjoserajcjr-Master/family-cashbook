(function () {
  'use strict';
  const X = CashbookCurrency;
  let A,
    busy = false;
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
      );
  const field = (label, id, type = 'text', value = '') =>
      '<label class="f">' +
      label +
      '<input id="' +
      id +
      '" type="' +
      type +
      '" value="' +
      esc(value) +
      '"></label>',
    btn = (a, t, extra = '') =>
      '<button class="btn" data-currency="' +
      a +
      '" ' +
      extra +
      '>' +
      t +
      '</button>';
  const select = (label, id, opts) =>
      '<label class="f">' +
      label +
      '<select id="' +
      id +
      '">' +
      opts +
      '</select></label>',
    option = (v, t) => '<option value="' + esc(v) + '">' + esc(t) + '</option>';
  const S = () => A.state(),
    today = () => {
      const d = new Date();
      return (
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
      );
    },
    number = (id) => {
      const n = Number($(id).value);
      if (!Number.isFinite(n)) throw Error('Enter a finite number.');
      return n;
    };
  const fxOptions = () =>
    Object.entries(S().fxAccounts || {})
      .map(([id, a]) => option(id, a.name + ' · ' + a.currency))
      .join('');
  const refs = () =>
    Object.entries(S().accounts)
      .map(([id, a]) => option('legacy:' + id, a.name + ' · INR'))
      .join('') +
    Object.entries(S().fxAccounts || {})
      .map(([id, a]) => option('fx:' + id, a.name + ' · ' + a.currency))
      .join('');
  const table = (heads, rows) =>
    '<div class="scroll"><table><thead><tr>' +
    heads.map((x) => '<th>' + x + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows
      .map(
        (row) =>
          '<tr>' + row.map((x) => '<td>' + x + '</td>').join('') + '</tr>'
      )
      .join('') +
    '</tbody></table></div>';
  const data = () => ({ ...S(), settings: S().settings });
  function render() {
    const s = data(),
      on = today(),
      v = X.compute(s, on),
      accounts = Object.entries(s.fxAccounts || {});
    return (
      '<section class="section"><div class="section-head"><h2>Multi-currency accounts & remittances</h2></div><div class="panel pad"><p>Legacy Cashbook accounts and tools remain in INR. Keep each foreign account here in its own currency; foreign balances and credit-card debt are also valued in INR on Home and Net worth. Do not create the same bank account in both places. NRE/NRO are account labels, not currencies or legal classifications.</p><p>Manual dated rates are INR per one foreign unit. Posted entries and remittances keep the rates you record; later valuation rates do not rewrite that history. These are accounting estimates, not tax calculations.</p>' +
      (v.missing.length
        ? '<p><b>Valuation incomplete. Add rates for ' +
          v.missing.map(esc).join(', ') +
          '.</b></p>'
        : '<p>Foreign-ledger liquid cash as of ' +
          on +
          ': <b>' +
          X.format(v.liquidINR, 'INR') +
          '</b>; assets ' +
          X.format(v.assetsINR, 'INR') +
          '; card debt ' +
          X.format(v.debtINR, 'INR') +
          '.</p>') +
      table(
        [
          'Account',
          'Currency',
          'Native balance',
          'INR value',
          'Revaluation vs recorded cost'
        ],
        accounts
          .filter(([id]) => v.valued[id])
          .map(([id, a]) => {
            const r = v.valued[id];
            return [
              esc(a.name),
              a.currency,
              X.format(r.native, a.currency),
              r.inr == null ? 'Rate needed' : X.format(r.inr, 'INR'),
              r.revaluationINR == null
                ? 'Rate needed'
                : X.format(r.revaluationINR, 'INR')
            ];
          })
      ) +
      '<h3>Add a currency account</h3><div class="form">' +
      field('Account name', 'fx-name') +
      field('Currency code (USD, AED, EUR…)', 'fx-code', 'text', 'USD') +
      select(
        'Type',
        'fx-kind',
        option('bank', 'Bank / cash') +
          option('card', 'Credit card: negative balance means debt')
      ) +
      field('Opening date', 'fx-opened', 'date', S().settings.start + '-01') +
      field('Opening balance in account currency', 'fx-opening', 'number', 0) +
      field(
        'Opening valuation: INR per unit',
        'fx-opening-rate',
        'number',
        ''
      ) +
      '</div>' +
      btn('account', 'Add currency account') +
      '<h3>Reconcile a currency account</h3><div class="form">' +
      select('Account', 'fx-balance-account', fxOptions()) +
      field('Month', 'fx-balance-month', 'month', A.month()) +
      field('Confirmed native balance', 'fx-balance-value', 'number', '') +
      field(
        'Closing valuation: INR per unit',
        'fx-balance-rate',
        'number',
        ''
      ) +
      field('Explanation of unrecorded differences', 'fx-balance-reason') +
      '</div>' +
      btn('balance', 'Review and save confirmed balance') +
      '<h3>Record a dated valuation rate</h3><div class="form">' +
      field('Currency code', 'fx-rate-code', 'text', 'USD') +
      field('Rate date', 'fx-rate-date', 'date', on) +
      field('INR per one unit', 'fx-rate', 'number', '') +
      '</div>' +
      btn('rate', 'Save rate') +
      '<h3>Post native-currency income or expense</h3><input type="hidden" id="fx-entry-id"><div class="form">' +
      select('Currency account', 'fx-entry-account', fxOptions()) +
      select(
        'Activity',
        'fx-entry-type',
        option('income', 'Income') + option('expense', 'Expense')
      ) +
      field('Date', 'fx-entry-date', 'date', on) +
      field('Amount in account currency', 'fx-entry-amount', 'number', '') +
      field(
        'Recorded transaction rate: INR per unit',
        'fx-entry-rate',
        'number',
        ''
      ) +
      field('Note', 'fx-entry-note') +
      '</div>' +
      btn('entry', 'Save transaction') +
      '<h3>Monthly currency budget</h3><div class="form">' +
      select('Currency account', 'fx-plan-account', fxOptions()) +
      select(
        'Budget type',
        'fx-plan-type',
        option('income', 'Income') + option('expense', 'Expense')
      ) +
      field('Month', 'fx-plan-month', 'month', A.month()) +
      field(
        'Whole-month amount in account currency',
        'fx-plan-amount',
        'number',
        ''
      ) +
      field('Expected day', 'fx-plan-day', 'number', 1) +
      '<label><input type="checkbox" id="fx-plan-complete"> Complete: use recorded actuals only</label></div>' +
      btn('plan', 'Save monthly budget') +
      '<h3>Transfer / remittance</h3><input type="hidden" id="fx-transfer-id"><p>Record exact debited principal, source-currency fee and net amount received. Transfers to or from a legacy INR account update that account in the main Cashbook automatically. Do not log the same movement again as income or expense.</p><div class="form">' +
      select('From', 'fx-from', refs()) +
      select('To', 'fx-to', refs()) +
      field('Date', 'fx-transfer-date', 'date', on) +
      select(
        'Status',
        'fx-transfer-status',
        option('actual', 'Recorded actual') +
          option('planned', 'Planned estimate')
      ) +
      field('Principal sent in source currency', 'fx-source', 'number', '') +
      field('Fee in source currency', 'fx-fee', 'number', 0) +
      field(
        'Net received in destination currency',
        'fx-received',
        'number',
        ''
      ) +
      field('Source valuation: INR per unit', 'fx-source-rate', 'number', '') +
      field(
        'Destination valuation: INR per unit',
        'fx-target-rate',
        'number',
        ''
      ) +
      field('Reference', 'fx-ref') +
      '</div>' +
      btn('transfer', 'Save remittance') +
      btn('export', 'Export currency history CSV') +
      '<h3>Recorded activity and transfer history</h3><p>Recorded income ' +
      X.format(v.historicalIncomeINR, 'INR') +
      '; recorded expenses ' +
      X.format(v.historicalExpensesINR, 'INR') +
      '; transfer fees ' +
      X.format(v.feesINR, 'INR') +
      '. Principal transfers are excluded from income/expense. Execution-rate difference ' +
      X.format(v.executionDifferenceINR, 'INR') +
      ' is shown separately.</p>' +
      table(
        ['Date', 'Activity', 'Native amount', 'Recorded INR / fee', ''],
        v.rows
          .filter((e) => !['plan', 'reconcile'].includes(e.event))
          .map((e) =>
            e.event === 'entry'
              ? [
                  e.date,
                  esc(s.fxAccounts[e.accountId].name) + ' · ' + e.type,
                  X.format(e.amount, e.currency),
                  X.format(e.recordedINR, 'INR'),
                  btn('entry-edit', 'Edit', 'data-id="' + esc(e.id) + '"') +
                    btn(
                      'delete',
                      'Delete',
                      'data-path="fxEntries/' + esc(e.id) + '"'
                    )
                ]
              : [
                  e.date,
                  esc(e.from) + ' → ' + esc(e.to),
                  X.format(e.sourceAmount, e.sourceCurrency) +
                    ' → ' +
                    X.format(e.receivedAmount, e.targetCurrency),
                  X.format(e.feeINR, 'INR') + ' fee',
                  btn('transfer-edit', 'Edit', 'data-id="' + esc(e.id) + '"') +
                    btn(
                      'delete',
                      'Delete',
                      'data-path="fxTransfers/' + esc(e.id) + '"'
                    )
                ]
          )
      ) +
      '</div></section>'
    );
  }
  async function save(path, body) {
    if (!A.canWrite()) throw Error('This ledger is read-only.');
    await A.db().doc(path).set(body);
  }
  function open(date) {
    X.date(date);
    if (A.locked(date.slice(0, 7)))
      throw Error('Reopen the month before changing currency activity.');
    if (
      date.slice(0, 7) < S().settings.start ||
      date.slice(0, 7) > S().settings.end
    )
      throw Error('Choose a date within the plan.');
  }
  async function action(t) {
    const a = t.dataset.currency,
      s = data();
    if (a === 'export') {
      const v = X.compute(s, today()),
        q = CashbookDomain.csvCell,
        rows = v.rows.map((e) => [
          e.date,
          e.event,
          e.accountId || e.from,
          e.to || '',
          e.currency || e.sourceCurrency,
          e.amount ?? e.sourceAmount ?? '',
          e.targetCurrency || '',
          e.receivedAmount || '',
          e.fxRateToINR ?? e.sourceToINR ?? '',
          e.fee || 0,
          e.targetToINR || '',
          e.note || e.reference || e.reason || ''
        ]);
      const csv = [
        [
          'Date',
          'Activity',
          'Account or source',
          'Destination',
          'Currency',
          'Native amount',
          'Target currency',
          'Received native amount',
          'Recorded INR per source unit',
          'Source fee',
          'Recorded INR per destination unit',
          'Note'
        ],
        ...rows
      ]
        .map((r) => r.map(q).join(','))
        .join('\r\n');
      await window.__cashbookLocal.exportFile(
        'cashbook-currency-history.csv',
        csv,
        'text/csv'
      );
      return;
    }
    if (a === 'account') {
      const code = X.currency($('#fx-code').value.trim().toUpperCase()),
        body = {
          name: $('#fx-name').value.trim(),
          currency: code,
          kind: $('#fx-kind').value,
          opened: $('#fx-opened').value,
          opening: number('#fx-opening'),
          openingRateToINR: code === 'INR' ? 1 : number('#fx-opening-rate')
        };
      X.validateAccount(body);
      open(body.opened);
      const ops = [
        { type: 'set', path: 'fxAccounts/' + crypto.randomUUID(), data: body }
      ];
      if (
        code !== 'INR' &&
        !Object.values(s.fxRates || {}).some(
          (r) => r.currency === code && r.date === body.opened
        )
      )
        ops.push({
          type: 'set',
          path: 'fxRates/' + code + '-' + body.opened,
          data: {
            currency: code,
            date: body.opened,
            rateToINR: body.openingRateToINR
          }
        });
      await A.db().applyBatch(ops);
      return;
    }
    if (a === 'balance') {
      const accountId = $('#fx-balance-account').value,
        month = $('#fx-balance-month').value,
        a = s.fxAccounts?.[accountId];
      if (!a) throw Error('Choose a currency account.');
      const date =
        month +
        '-' +
        new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
      open(date);
      const key = accountId + '-' + month,
        others = { ...(s.fxBalances || {}) };
      delete others[key];
      const expected = X.compute({ ...s, fxBalances: others }, date).balances[
          accountId
        ],
        balance = number('#fx-balance-value'),
        difference = X.amount(balance - expected, a.currency),
        fxRateToINR = a.currency === 'INR' ? 1 : number('#fx-balance-rate'),
        reason = $('#fx-balance-reason').value.trim();
      if (difference && !reason)
        throw Error('Explain the reconciliation difference.');
      if (
        !confirm(
          'Expected ' +
            X.format(expected, a.currency) +
            '; confirmed ' +
            X.format(balance, a.currency) +
            '; difference ' +
            X.format(difference, a.currency) +
            '. Save this reviewed balance?'
        )
      )
        return;
      const body = {
        accountId,
        date,
        balance,
        expected,
        difference,
        fxRateToINR,
        reason
      };
      X.validateState({ ...s, fxBalances: { ...others, [key]: body } });
      const ops = [{ type: 'set', path: 'fxBalances/' + key, data: body }];
      if (a.currency !== 'INR' && s.family?.main?.mode !== 'member')
        ops.push({
          type: 'set',
          path: 'fxRates/' + a.currency + '-' + date,
          data: { currency: a.currency, date, rateToINR: fxRateToINR }
        });
      await A.db().applyBatch(ops);
      return;
    }
    if (a === 'rate') {
      const code = X.currency($('#fx-rate-code').value.trim().toUpperCase()),
        date = X.date($('#fx-rate-date').value),
        rateToINR = number('#fx-rate');
      if (rateToINR <= 0 || code === 'INR')
        throw Error('Enter a positive rate for a non-INR currency.');
      await save('fxRates/' + code + '-' + date, {
        currency: code,
        date,
        rateToINR
      });
      return;
    }
    if (a === 'entry') {
      const accountId = $('#fx-entry-account').value,
        date = $('#fx-entry-date').value,
        a = s.fxAccounts[accountId];
      if (!a) throw Error('Add a currency account first.');
      const body = {
        accountId,
        date,
        type: $('#fx-entry-type').value,
        amount: number('#fx-entry-amount'),
        fxRateToINR: a.currency === 'INR' ? 1 : number('#fx-entry-rate'),
        note: $('#fx-entry-note').value.trim()
      };
      open(date);
      const old = s.fxEntries?.[$('#fx-entry-id').value];
      if (old) open(old.date);
      X.validateEntry(body, s);
      const id = $('#fx-entry-id').value || crypto.randomUUID();
      $('#fx-entry-id').value = id;
      await save('fxEntries/' + id, body);
      $('#fx-entry-id').value = '';
      $('#fx-entry-amount').value = '';
      $('#fx-entry-note').value = '';
      return;
    }
    if (a === 'plan') {
      const month = $('#fx-plan-month').value,
        accountId = $('#fx-plan-account').value,
        type = $('#fx-plan-type').value,
        amount = number('#fx-plan-amount'),
        day = number('#fx-plan-day');
      open(month + '-01');
      if (
        !s.fxAccounts?.[accountId] ||
        amount < 0 ||
        !Number.isInteger(day) ||
        day < 1 ||
        day > 31
      )
        throw Error('Check account, amount and day.');
      await save('fxPlans/' + accountId + '-' + month + '-' + type, {
        accountId,
        month,
        type,
        amount,
        day,
        complete: $('#fx-plan-complete').checked
      });
      return;
    }
    if (a === 'transfer') {
      const from = $('#fx-from').value,
        to = $('#fx-to').value,
        date = $('#fx-transfer-date').value,
        source = X.account(from, s),
        target = X.account(to, s),
        body = {
          from,
          to,
          date,
          status: $('#fx-transfer-status').value,
          sourceAmount: number('#fx-source'),
          fee: number('#fx-fee'),
          receivedAmount: number('#fx-received'),
          sourceToINR:
            source.currency === 'INR' ? 1 : number('#fx-source-rate'),
          targetToINR:
            target.currency === 'INR' ? 1 : number('#fx-target-rate'),
          reference: $('#fx-ref').value.trim()
        };
      open(date);
      const old = s.fxTransfers?.[$('#fx-transfer-id').value];
      if (old) open(old.date);
      X.validateTransfer(body, s);
      const id = $('#fx-transfer-id').value || crypto.randomUUID();
      $('#fx-transfer-id').value = id;
      await save('fxTransfers/' + id, body);
      $('#fx-transfer-id').value = '';
      $('#fx-source').value = '';
      $('#fx-received').value = '';
      return;
    }
    if (a === 'entry-edit') {
      const e = s.fxEntries[t.dataset.id];
      for (const [key, value] of Object.entries({
        id: t.dataset.id,
        account: e.accountId,
        type: e.type,
        date: e.date,
        amount: e.amount,
        rate: e.fxRateToINR,
        note: e.note || ''
      }))
        $('#fx-entry-' + key).value = value;
      $('#fx-entry-amount').focus();
      return;
    }
    if (a === 'transfer-edit') {
      const e = s.fxTransfers[t.dataset.id];
      for (const [key, value] of Object.entries({
        'transfer-id': t.dataset.id,
        from: e.from,
        to: e.to,
        'transfer-date': e.date,
        'transfer-status': e.status || 'actual',
        source: e.sourceAmount,
        fee: e.fee || 0,
        received: e.receivedAmount,
        'source-rate': e.sourceToINR,
        'target-rate': e.targetToINR,
        ref: e.reference || ''
      }))
        $('#fx-' + key).value = value;
      $('#fx-source').focus();
      return;
    }
    if (a === 'delete') {
      const [col, id] = t.dataset.path.split('/'),
        e = s[col]?.[id];
      if (!['fxEntries', 'fxTransfers'].includes(col) || !e)
        throw Error('Record is unavailable.');
      open(e.date);
      if (
        confirm(
          'Delete this currency record? A remittance removal also removes its effect on legacy INR accounts.'
        )
      )
        await A.db().doc(t.dataset.path).delete();
    }
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-currency]');
    if (!t || !A || busy || window.CashbookUI?.busy) return;
    busy = true;
    try {
      await action(t);
    } catch (err) {
      A.toast(err.message || 'Currency action failed.');
    } finally {
      busy = false;
      A.refresh();
    }
  });
  window.CashbookCurrencyUI = {
    attach: (api) => (A = api),
    render,
    get busy() {
      return busy;
    }
  };
})();
