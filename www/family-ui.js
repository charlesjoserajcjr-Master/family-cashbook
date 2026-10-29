/* Family exchange UI. Private keys are encrypted at rest and held only in this page session. */
(function () {
  'use strict';
  const F = CashbookFamily;
  let A,
    identity = null,
    busy = false,
    pending = null;
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
  const button = (key, label, more = '') =>
    '<button class="btn" data-family="' +
    key +
    '" ' +
    more +
    '>' +
    label +
    '</button>';
  const input = (label, id, type = 'text') =>
    '<label class="f">' +
    label +
    '<input id="' +
    id +
    '" type="' +
    type +
    '" ' +
    (type === 'password' ? 'autocomplete="current-password"' : '') +
    '></label>';
  const state = () => A.state().family?.main,
    vault = () => A.state().family?.identity;
  const json = async (id) => {
    const f = $(id).files[0];
    if (!f) throw Error('Choose a file.');
    if (f.size > 25 * 1024 * 1024) throw Error('Family file is too large.');
    return f.text();
  };
  const needIdentity = () => {
    if (!identity) throw Error('Unlock your member key first.');
  };
  async function share(name, value) {
    const raw = JSON.stringify(value);
    return window.__cashbookLocal.shareFile(name, raw, 'application/json');
  }
  function render() {
    const s = state(),
      v = vault();
    let out =
      '<section class="section"><div class="section-head"><h2>Encrypted family file exchange</h2></div><div class="panel pad"><p>Exchange encrypted files using your device share sheet, WhatsApp, email or a saved attachment. Files are encrypted for one recipient and signed by the sender. Verify member fingerprints in person or through another trusted channel.</p><p>The owner is the authoritative ledger. Editors send proposed changes for owner review; viewers cannot submit changes. Only selected accounts are sent. Transfers crossing a private account boundary are omitted, so the shared view may not reconcile independently.</p><p>Removing a member stops future files and rejects their pending edits. It cannot erase data or old files already received. Keep backups and key passphrases separately.</p>';
    if (!v)
      out +=
        '<div class="form">' +
        input('Your member name', 'fam-name') +
        input(
          'Member-key passphrase (12+ characters)',
          'fam-password',
          'password'
        ) +
        input('Confirm passphrase', 'fam-confirm', 'password') +
        '</div>' +
        button('identity-create', 'Create my member key');
    else {
      out +=
        '<p>Your fingerprint: <code style="overflow-wrap:anywhere">' +
        esc(v.public.id) +
        '</code></p>';
      if (!identity)
        out +=
          input('Member-key passphrase', 'fam-password', 'password') +
          button('identity-unlock', 'Unlock member key');
      else
        out +=
          button('request', 'Share my invitation request') +
          ' ' +
          button('identity-lock', 'Lock member key');
    }
    if (identity && !s)
      out +=
        '<hr>' + button('household-create', 'Create a family ledger as owner');
    if (s?.mode === 'owner') {
      out +=
        (s.reinviteRequired
          ? '<p><b>A restored owner backup clears all member grants. Verify and invite members again; old proposals are rejected.</b></p>'
          : '') +
        '<h3>Owner · active members</h3>' +
        Object.entries(s.members || {})
          .map(
            ([id, g]) =>
              '<div class="panel pad">' +
              esc(g.body.member.name) +
              ' · ' +
              esc(g.body.role) +
              ' · ' +
              g.body.accounts.length +
              ' accounts<div class="row">' +
              button(
                'snapshot',
                'Share latest file',
                'data-member="' + id + '"'
              ) +
              button('revoke', 'Remove member', 'data-member="' + id + '"') +
              '</div></div>'
          )
          .join('');
      out +=
        '<h3>Invite a member</h3>' +
        input('Their invitation-request file', 'fam-request-file', 'file') +
        input(
          'Fingerprint verified through another channel',
          'fam-member-fingerprint'
        ) +
        '<label class="f">Role<select id="fam-role"><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label><p>Select exactly the accounts to share:</p>' +
        [
          ...Object.values(A.state().accounts),
          ...Object.values(A.state().fxAccounts || {}).map((a) => ({
            ...a,
            id: 'fx:' + a.id,
            name: a.name + ' · ' + a.currency
          }))
        ]
          .map(
            (a) =>
              '<label style="display:block"><input type="checkbox" class="fam-scope" value="' +
              esc(a.id) +
              '"> ' +
              esc(a.name) +
              '</label>'
          )
          .join('') +
        button('invite', 'Verify and invite');
    }
    if (s?.mode === 'member')
      out +=
        '<h3>Shared ledger · ' +
        esc(s.grant.body.role) +
        '</h3><p>Owner fingerprint: <code style="overflow-wrap:anywhere">' +
        esc(s.owner.id) +
        '</code></p>' +
        button('changes', 'Share my proposed changes');
    if (identity)
      out +=
        '<hr><h3>Receive a family file</h3>' +
        input('Encrypted family attachment', 'fam-import-file', 'file') +
        (s?.mode !== 'owner'
          ? input(
              'Owner fingerprint (first pairing or owner recovery)',
              'fam-owner-fingerprint'
            )
          : '') +
        (s?.mode === 'member'
          ? '<label><input type="checkbox" id="fam-repair"> Re-pair after owner recovery: verify the same owner fingerprint again and export unsent proposals first.</label>'
          : '') +
        button('receive', 'Review received file');
    if (pending) {
      out += '<div class="panel pad"><h3>Review before accepting</h3>';
      if (pending.kind === 'changes')
        out +=
          '<p>Verified editor: ' +
          esc(pending.review.member.name) +
          '</p><ul>' +
          pending.review.changes
            .map(
              (c) =>
                '<li><details><summary>' +
                esc(c.path) +
                ' · ' +
                (c.data ? 'save' : 'delete') +
                '</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">' +
                esc(
                  JSON.stringify(
                    {
                      before:
                        A.state()[c.path.split('/')[0]]?.[
                          c.path.split('/')[1]
                        ] || null,
                      proposed: c.data
                    },
                    null,
                    2
                  )
                ) +
                '</pre></details></li>'
            )
            .join('') +
          '</ul>' +
          (pending.review.conflicts.length
            ? '<p><b>Conflicts: ' +
              pending.review.conflicts.map(esc).join(', ') +
              '. No changes will be accepted; share an updated owner file and have the editor reapply their changes.</b></p>'
            : '');
      else
        out +=
          '<p>This replaces this device’s ledger with ' +
          Object.keys(pending.received.docs).length +
          ' shared records. A current recovery backup is offered first. Export any unsent changes before continuing.</p>';
      out +=
        button('accept', 'Accept reviewed file') +
        ' ' +
        button('cancel', 'Cancel review') +
        '</div>';
    }
    return out + '</div></section>';
  }
  async function action(t) {
    const a = t.dataset.family;
    if (a === 'identity-create') {
      if (!window.__cashbookLocal.encrypted)
        throw Error(
          'Enable working-ledger encryption in Privacy first, then create your member key.'
        );
      const p = $('#fam-password').value;
      if (p !== $('#fam-confirm').value)
        throw Error('Passphrases do not match.');
      if (p.length < 12) throw Error('Use at least 12 characters.');
      const name = $('#fam-name').value.trim();
      if (!name) throw Error('Enter your member name.');
      const id = await F.identity(name),
        encrypted = await CashbookSecurity.seal(JSON.stringify(id), p);
      await A.db().doc('family/identity').set({ public: id.public, encrypted });
      identity = id;
      return;
    }
    if (a === 'identity-unlock') {
      const id = JSON.parse(
        await CashbookSecurity.open(vault().encrypted, $('#fam-password').value)
      );
      await F.checkIdentity(id.public);
      if (id.public.id !== vault().public.id)
        throw Error('Member key differs from its public identity.');
      identity = id;
      return;
    }
    if (a === 'identity-lock') {
      identity = null;
      pending = null;
      return;
    }
    if (a === 'cancel') {
      pending = null;
      return;
    }
    needIdentity();
    if (a === 'request')
      return share('cashbook-member-request.json', await F.request(identity));
    if (a === 'household-create') {
      if (window.__cashbookLocal.drive.connected)
        throw Error(
          'Disconnect personal Drive sync before creating a file-based family ledger.'
        );
      if (!window.__cashbookLocal.encrypted)
        throw Error('Enable working-ledger encryption first.');
      await A.db().doc('family/main').set(F.ownerState(identity));
      return;
    }
    if (a === 'invite') {
      const s = state();
      if (s?.mode !== 'owner') throw Error('Only the owner can invite.');
      const member = await F.readRequest(
          JSON.parse(await json('#fam-request-file')),
          $('#fam-member-fingerprint').value
        ),
        accounts = [...document.querySelectorAll('.fam-scope:checked')].map(
          (e) => e.value
        ),
        grant = await F.makeGrant(
          s,
          identity,
          member,
          $('#fam-role').value,
          accounts
        );
      await A.db()
        .doc('family/main')
        .set({ ...s, members: { ...s.members, [member.id]: grant } });
      return;
    }
    if (a === 'revoke') {
      if (
        !confirm(
          'Remove this member? Old copies remain readable. All remaining members need refreshed files before sending further edits.'
        )
      )
        return;
      await A.db()
        .doc('family/main')
        .set(await F.revoke(state(), identity, t.dataset.member));
      return;
    }
    if (a === 'snapshot') {
      const snap = await window.__cashbookLocal.getSnapshot(),
        out = await F.snapshotPacket(
          state(),
          identity,
          t.dataset.member,
          snap.docs
        );
      await A.db().doc('family/main').set(out.state);
      await share(
        'cashbook-family-' + out.packet.header.sequence + '.json',
        out.packet
      );
      return;
    }
    if (a === 'changes') {
      const current = await window.__cashbookLocal.getSnapshot(),
        base = A.state().family?.base?.docs;
      if (!base) throw Error('Receive an owner file first.');
      return share(
        'cashbook-proposed-changes.json',
        await F.changesPacket(state(), identity, base, current.docs)
      );
    }
    if (a === 'receive') {
      const text = await json('#fam-import-file'),
        s = state(),
        current = await window.__cashbookLocal.getSnapshot();
      if (s?.mode === 'owner')
        pending = {
          kind: 'changes',
          text,
          review: await F.reviewChanges(text, s, identity, current.docs)
        };
      else
        pending = {
          kind: 'snapshot',
          repair: !!$('#fam-repair')?.checked,
          text,
          received: await F.receiveSnapshot(
            text,
            identity,
            s?.owner.id || $('#fam-owner-fingerprint').value,
            $('#fam-repair')?.checked ? undefined : s
          )
        };
      if (
        pending?.repair &&
        $('#fam-owner-fingerprint').value.trim().toLowerCase() !== s.owner.id
      ) {
        pending = null;
        throw Error(
          'Re-pairing requires the same independently verified owner fingerprint.'
        );
      }
      return;
    }
    if (a === 'accept') {
      if (!pending) throw Error('Review a file first.');
      if (pending.kind === 'changes') {
        // Revalidate against current membership and data at acceptance, not merely preview time.
        const current = await window.__cashbookLocal.getSnapshot(),
          r = await F.reviewChanges(
            pending.text,
            state(),
            identity,
            current.docs
          );
        if (r.conflicts.length)
          throw Error('Conflicts remain. No changes were accepted.');
        await A.db().applyBatch([
          ...r.operations,
          { type: 'set', path: 'family/main', data: r.state },
          {
            type: 'set',
            path: 'features/' + crypto.randomUUID(),
            data: {
              type: 'audit',
              action: 'family-changes-accepted',
              by: r.member.id,
              identityType: 'verified-signing-key',
              packetId: r.packetId,
              at: new Date().toISOString()
            }
          }
        ]);
      } else {
        if (!window.__cashbookLocal.encrypted)
          throw Error(
            'Enable working-ledger encryption before accepting shared records.'
          );
        if (
          !confirm(
            'Replace this device’s ledger with the reviewed shared copy? Save the recovery backup and any unsent proposals first.'
          )
        )
          return;
        const r = await F.receiveSnapshot(
          pending.text,
          identity,
          pending.received.state.owner.id,
          pending.repair ? undefined : state()
        );
        await window.__cashbookLocal.importData(
          JSON.stringify({
            app: 'family-cashbook',
            version: 2,
            docs: {
              ...r.docs,
              'family/main': r.state,
              'family/base': { docs: r.docs },
              'family/identity': vault()
            }
          })
        );
      }
      pending = null;
      const pin = $('#fam-owner-fingerprint');
      if (pin) pin.value = '';
      A.toast('Verified family file accepted.');
      return;
    }
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-family]');
    if (!t || !A || t.disabled || busy || window.CashbookUI?.busy) return;
    busy = true;
    t.disabled = true;
    try {
      await action(t);
    } catch (err) {
      A.toast(err.message || 'Family exchange failed.');
    } finally {
      busy = false;
      if (t.isConnected) t.disabled = false;
      A.refresh();
    }
  });
  window.addEventListener('pagehide', () => {
    identity = null;
    pending = null;
  });
  window.CashbookFamilyUI = {
    publicIdentity: () => identity?.public || null,
    prove: (c) => {
      needIdentity();
      return F.prove(identity, c);
    },
    attach: (api) => (A = api),
    render,
    get busy() {
      return busy;
    }
  };
})();
