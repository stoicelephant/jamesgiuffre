// /invoice: name-only sign in, hourly rate, 15-minute time entries, submitted invoices.
// Everything is stored through /api/entries + /api/invoices (shared by the whole team).
// If shared storage isn't connected yet, the page falls back to this browser's storage.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var LOCAL_E = 'inv.entries.local', LOCAL_I = 'inv.invoices.local';
  // The only names that can sign in (keep in sync with TEAM in api/_redis.js).
  var TEAM = ['arya', 'james', 'hammad', 'milo', 'ballah', 'golam'];
  function member(n) { var k = String(n || '').replace(/\s+/g, ' ').trim().toLowerCase(); for (var i = 0; i < TEAM.length; i++) if (TEAM[i].toLowerCase() === k) return TEAM[i]; return null; }

  var me = member(store.get('inv.name')) || '';
  var hours = 0;
  var entries = [], invoices = [];
  var mode = 'remote';       // 'remote' = shared via /api, 'local' = this browser only
  var scope = 'mine';        // everyone sees only their own entries here; arya has /team for the full view

  // ---------- helpers ----------
  function key(n) { return String(n || '').trim().toLowerCase(); }
  function fmtH(h) { var m = Math.round(h * 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function monthLabel(ym) { if (!ym) return 'all time'; var p = ym.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase(); }
  function fmtDate(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase(); }
  function fmtStamp(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase(); }
  function rateKey() { return 'inv.rate.' + key(me); }
  function getRate() { var r = parseFloat($('rate').value); return isFinite(r) && r >= 0 ? r : NaN; }
  function say(el, t, err) { el.textContent = t || ''; el.classList.toggle('err', !!err); }
  function msg(t, err) { say($('msg'), t, err); }
  function invMsg(t, err) { say($('inv-msg'), t, err); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function json(r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'something went wrong, try again'); return d; }); }

  // ---------- storage (shared API, or this browser as a fallback) ----------
  function localGet(k) { try { return JSON.parse(store.get(k) || '[]'); } catch (e) { return []; } }
  function localPut(k, v) { store.set(k, JSON.stringify(v)); }

  function load() {
    return fetch('/api/entries?name=' + encodeURIComponent(me), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { mode = 'remote'; entries = d.entries || []; invoices = d.invoices || []; })
      .catch(function () { mode = 'local'; entries = localGet(LOCAL_E); invoices = localGet(LOCAL_I); })
      .then(render);
  }

  function addEntry(e) {
    if (mode === 'local') {
      e.id = uid(); e.created = new Date().toISOString();
      entries = localGet(LOCAL_E); entries.push(e); localPut(LOCAL_E, entries);
      return Promise.resolve();
    }
    return fetch('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) })
      .then(json).then(function (d) { entries.push(d.entry); });
  }

  function removeEntry(id) {
    if (mode === 'local') {
      entries = localGet(LOCAL_E).filter(function (e) { return e.id !== id; }); localPut(LOCAL_E, entries);
      return Promise.resolve();
    }
    return fetch('/api/entries?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(me), { method: 'DELETE' })
      .then(json).then(function () { entries = entries.filter(function (e) { return e.id !== id; }); });
  }

  function submitInvoice(month) {
    if (mode === 'local') {
      var all = localGet(LOCAL_E), invs = localGet(LOCAL_I);
      var mine = all.filter(function (e) { return key(e.name) === key(me) && e.date.slice(0, 7) === month && !e.invoiceId; })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created < b.created ? -1 : 1); });
      if (!mine.length) return Promise.reject(new Error('nothing new to submit for this month'));
      var inv = {
        id: uid(), number: String(invs.length + 1).padStart(4, '0'), name: me, month: month,
        hours: mine.reduce(function (s, e) { return s + e.hours; }, 0),
        amount: Math.round(mine.reduce(function (s, e) { return s + e.hours * e.rate; }, 0) * 100) / 100,
        submitted: new Date().toISOString(),
        lines: mine.map(function (e) { return { entryId: e.id, date: e.date, matter: e.matter, hours: e.hours, rate: e.rate, amount: Math.round(e.hours * e.rate * 100) / 100 }; })
      };
      all.forEach(function (e) { if (mine.indexOf(e) > -1) { e.invoiceId = inv.id; e.invoiceNumber = inv.number; } });
      invs.push(inv); localPut(LOCAL_E, all); localPut(LOCAL_I, invs);
      entries = all; invoices = invs;
      return Promise.resolve(inv);
    }
    return fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: me, month: month }) })
      .then(json).then(function (d) { return load().then(function () { return d.invoice; }); });
  }

  // ---------- view ----------
  function visible() {
    var ym = $('month').value;
    return entries
      .filter(function (e) { return (!ym || e.date.slice(0, 7) === ym) && key(e.name) === key(me); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created < b.created ? 1 : -1); });
  }
  function pending() {
    var ym = $('month').value;
    return entries.filter(function (e) { return key(e.name) === key(me) && ym && e.date.slice(0, 7) === ym && !e.invoiceId; });
  }

  function render() {
    var list = visible(), rows = $('rows'), th = 0, ta = 0;
    rows.textContent = '';
    list.forEach(function (e) {
      var amt = e.hours * e.rate; th += e.hours; ta += amt;
      var tr = el('tr');
      function td(text, cls) { var c = el('td', cls, text); tr.appendChild(c); return c; }
      td(fmtDate(e.date), 'c-date');
      td(e.name, 'c-who');
      td(e.matter, 'matter');
      td(fmtH(e.hours), 'num');
      td(money(e.rate), 'num c-rate');
      td(money(amt), 'num');
      var x = td('', 'c-x');
      if (e.invoiceId) {
        x.appendChild(el('span', 'tag', '#' + (e.invoiceNumber || '')));
      } else if (key(e.name) === key(me)) {
        var b = el('button', 'del', '×');
        b.type = 'button'; b.title = 'delete entry'; b.setAttribute('aria-label', 'delete entry');
        b.addEventListener('click', function () {
          if (b.dataset.armed) {
            b.disabled = true;
            removeEntry(e.id).then(render).catch(function (err) { msg(err.message, true); b.disabled = false; });
          } else {                                   // two taps to delete, no pop-up dialog
            b.dataset.armed = '1'; b.textContent = 'delete?'; b.style.fontSize = '12px';
            setTimeout(function () { if (b.isConnected) { delete b.dataset.armed; b.textContent = '×'; b.style.fontSize = ''; } }, 2500);
          }
        });
        x.appendChild(b);
      }
      rows.appendChild(tr);
    });
    $('t-hours').textContent = fmtH(th);
    $('t-amount').textContent = money(ta);
    $('empty').hidden = list.length > 0;
    document.querySelector('table:not(.inv-list)').classList.toggle('mine', scope === 'mine');

    var sync = $('sync');
    sync.textContent = mode === 'remote' ? 'shared with your team' : 'saved in this browser only (shared storage not connected yet)';
    sync.classList.toggle('local', mode === 'local');
    $('print-meta').textContent = (scope === 'mine' ? me : 'all team members') + ' · ' + monthLabel($('month').value) + ' · ' + fmtH(th) + ' hrs · ' + money(ta);

    renderSubmit();
    renderInvoices();
  }

  function renderSubmit() {
    var p = pending(), btn = $('submit-inv'), sum = $('submit-sum');
    var h = p.reduce(function (s, e) { return s + e.hours; }, 0), a = p.reduce(function (s, e) { return s + e.hours * e.rate; }, 0);
    disarm();
    sum.textContent = '';
    if (!$('month').value) { sum.textContent = 'pick a month to submit an invoice.'; btn.disabled = true; return; }
    if (!p.length) { sum.textContent = 'nothing new to submit for ' + monthLabel($('month').value) + '.'; btn.disabled = true; return; }
    var s = el('strong', null, fmtH(h) + ' · ' + money(a));
    sum.append(p.length + ' new ' + (p.length === 1 ? 'entry' : 'entries') + ' for ' + monthLabel($('month').value) + ': ', s);
    btn.disabled = false;
  }

  function renderInvoices() {
    var list = invoices
      .filter(function (i) { return key(i.name) === key(me); })
      .sort(function (a, b) { return a.submitted < b.submitted ? 1 : -1; });
    var body = $('inv-rows'); body.textContent = '';
    list.forEach(function (inv) {
      var tr = el('tr');
      tr.appendChild(el('td', 'c-date', '#' + inv.number));
      tr.appendChild(el('td', 'c-who', inv.name));
      tr.appendChild(el('td', null, monthLabel(inv.month)));
      tr.appendChild(el('td', 'num', fmtH(inv.hours)));
      tr.appendChild(el('td', 'num', money(inv.amount)));
      tr.appendChild(el('td', 'num c-sub', fmtStamp(inv.submitted)));
      var x = el('td', 'c-x');
      var p = el('button', 'link', 'print'); p.type = 'button'; p.style.fontSize = '13px'; p.style.marginLeft = '12px';
      p.addEventListener('click', function () { printInvoice(inv); });
      x.appendChild(p); tr.appendChild(x);
      body.appendChild(tr);
    });
    $('inv-empty').hidden = list.length > 0;
    document.querySelector('table.inv-list').classList.toggle('mine', scope === 'mine');
  }

  function printInvoice(inv) {
    var box = $('print-invoice'); box.textContent = '';
    var head = el('div', 'pi-head');
    var left = el('div'); left.appendChild(el('div', 'pi-title', 'invoice #' + inv.number)); left.appendChild(el('div', null, inv.name));
    var right = el('div', 'pi-meta');
    right.appendChild(el('div', null, 'period: ' + monthLabel(inv.month)));
    right.appendChild(el('div', null, 'submitted: ' + fmtStamp(inv.submitted)));
    head.appendChild(left); head.appendChild(right); box.appendChild(head);
    var t = el('table'), thead = el('thead'), hr = el('tr');
    [['date', 'c-date'], ['subject matter'], ['time', 'num'], ['rate', 'num'], ['amount', 'num']].forEach(function (c) { hr.appendChild(el('th', c[1], c[0])); });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = el('tbody');
    inv.lines.forEach(function (l) {
      var tr = el('tr');
      tr.appendChild(el('td', 'c-date', fmtDate(l.date)));
      tr.appendChild(el('td', 'matter', l.matter));
      tr.appendChild(el('td', 'num', fmtH(l.hours)));
      tr.appendChild(el('td', 'num', money(l.rate)));
      tr.appendChild(el('td', 'num', money(l.amount)));
      tb.appendChild(tr);
    });
    t.appendChild(tb); box.appendChild(t);
    var tot = el('div', 'pi-total'); tot.appendChild(el('span', null, 'total ' + fmtH(inv.hours) + ' hrs')); tot.appendChild(el('span', null, money(inv.amount)));
    box.appendChild(tot);
    document.body.classList.add('print-inv');
    window.print();
  }
  window.addEventListener('afterprint', function () { document.body.classList.remove('print-inv'); });

  function disarm() { var b = $('submit-inv'); delete b.dataset.armed; b.classList.remove('armed'); b.textContent = 'submit invoice'; }

  // ---------- time ----------
  function setHours(h) {
    hours = Math.min(24, Math.max(0, Math.round(h * 4) / 4));
    $('hours').textContent = fmtH(hours);
    updatePreview();
  }
  function updatePreview() {
    var r = getRate(), pv = $('preview');
    pv.textContent = '';
    if (!isFinite(r)) { pv.textContent = 'set your rate above'; return; }
    if (!hours) { pv.textContent = 'add some time'; return; }
    pv.append(fmtH(hours) + ' × ' + money(r) + '/hr = ', el('strong', null, money(hours * r)));
  }

  // subject matter: one line that grows as you type
  function grow() { var t = $('matter'); t.style.height = 'auto'; t.style.height = Math.max(38, t.scrollHeight) + 'px'; }

  function show() {
    var signedIn = !!me;
    $('login').hidden = signedIn;
    $('app').hidden = !signedIn;
    if (!signedIn) { $('login-name').focus(); return; }
    $('who').textContent = me;
    $('team-link').hidden = me !== 'arya';
    $('rate').value = store.get(rateKey()) || '';
    updatePreview(); grow();
    load();
  }

  // ---------- events ----------
  // ---------- name dropdown: filters as you type, only team names are accepted ----------
  var nameIn = $('login-name'), nameList = $('name-list'), go = $('login-go'), active = -1, shown = [];
  function matches(q) {
    q = q.trim().toLowerCase();
    if (!q) return TEAM.slice();
    return TEAM.filter(function (n) { return n.toLowerCase().indexOf(q) > -1; })
      .sort(function (a, b) {                                  // names that start with what you typed come first
        var sa = a.toLowerCase().split(' ').some(function (w) { return w.indexOf(q) === 0; }) || a.toLowerCase().indexOf(q) === 0;
        var sb = b.toLowerCase().split(' ').some(function (w) { return w.indexOf(q) === 0; }) || b.toLowerCase().indexOf(q) === 0;
        return sa === sb ? 0 : sa ? -1 : 1;
      });
  }
  function openList() {
    var q = nameIn.value; shown = matches(q); nameList.textContent = '';
    if (!shown.length) {
      var li = el('li', 'none', 'no one on the team by that name'); nameList.appendChild(li);
    }
    shown.forEach(function (n, i) {
      var li = el('li'); li.setAttribute('role', 'option'); li.id = 'nm-' + i;
      var k = n.toLowerCase().indexOf(q.trim().toLowerCase());
      if (q.trim() && k > -1) { li.append(n.slice(0, k), el('mark', null, n.slice(k, k + q.trim().length)), n.slice(k + q.trim().length)); } else li.textContent = n;
      li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(n); });
      nameList.appendChild(li);
    });
    active = shown.length && q.trim() ? 0 : -1; highlight();
    nameList.hidden = false; nameIn.setAttribute('aria-expanded', 'true');
  }
  function closeList() { nameList.hidden = true; nameIn.setAttribute('aria-expanded', 'false'); }
  function highlight() {
    [].forEach.call(nameList.children, function (li, i) { li.classList.toggle('on', i === active); });
    if (active > -1) nameIn.setAttribute('aria-activedescendant', 'nm-' + active); else nameIn.removeAttribute('aria-activedescendant');
  }
  function pick(n) { nameIn.value = n; closeList(); validName(); }
  function validName() { var ok = !!member(nameIn.value); go.disabled = !ok; say($('login-msg'), ''); return ok; }
  nameIn.addEventListener('input', function () { openList(); validName(); });
  nameIn.addEventListener('focus', openList);
  nameIn.addEventListener('blur', function () { setTimeout(closeList, 120); var m = member(nameIn.value); if (m) nameIn.value = m; });
  nameIn.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (nameList.hidden) openList(); active = Math.min(shown.length - 1, active + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    else if (e.key === 'Enter') { if (!nameList.hidden && active > -1 && shown[active]) { e.preventDefault(); pick(shown[active]); } }
    else if (e.key === 'Escape') closeList();
  });

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = member(nameIn.value);
    if (!n) { say($('login-msg'), 'pick your name from the list.', true); openList(); return; }
    me = n; store.set('inv.name', me); show();
  });
  $('switch').addEventListener('click', function () { me = ''; store.del('inv.name'); nameIn.value = ''; go.disabled = true; show(); });

  $('rate').addEventListener('input', function () {
    var r = getRate();
    if (isFinite(r)) store.set(rateKey(), String(r)); else store.del(rateKey());
    updatePreview();
  });

  document.querySelectorAll('.step').forEach(function (b) {
    b.addEventListener('click', function () { setHours(hours + parseFloat(b.dataset.d)); });
  });
  document.querySelectorAll('.chip').forEach(function (b) {          // chips add up: 30m twice = 1:00
    b.addEventListener('click', function () { setHours(hours + parseFloat(b.dataset.h)); });
  });
  $('clear-time').addEventListener('click', function () { setHours(0); });

  $('matter').addEventListener('input', grow);
  $('matter').addEventListener('keydown', function (e) {           // enter adds the entry, shift+enter = new line
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('add').click(); }
  });

  $('entry-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = getRate(), matter = $('matter').value.trim(), date = $('date').value;
    if (!isFinite(r)) { msg('set your hourly rate first.', true); $('rate').focus(); return; }
    if (!date) { msg('pick a date.', true); return; }
    if (!matter) { msg('add the subject matter.', true); $('matter').focus(); return; }
    if (!hours) { msg('add some time.', true); return; }
    var btn = $('add'); btn.disabled = true; msg('saving…');
    var h = hours;
    addEntry({ name: me, date: date, matter: matter.slice(0, 500), hours: h, rate: r })
      .then(function () {
        msg('added ' + fmtH(h) + ' for ' + money(h * r) + '.');
        $('matter').value = ''; grow(); setHours(0);
        if ($('month').value && $('month').value !== date.slice(0, 7)) $('month').value = date.slice(0, 7);
        render();
      })
      .catch(function (err) { msg(err.message || 'could not save, try again.', true); })
      .then(function () { btn.disabled = false; });
  });

  $('submit-inv').addEventListener('click', function () {
    var b = $('submit-inv'), ym = $('month').value;
    if (!b.dataset.armed) {                                          // second tap confirms
      b.dataset.armed = '1'; b.classList.add('armed'); b.textContent = 'tap again to submit';
      setTimeout(function () { if (b.dataset.armed) disarm(); }, 3000);
      return;
    }
    disarm(); b.disabled = true; invMsg('submitting…');
    submitInvoice(ym)
      .then(function (inv) { render(); invMsg('invoice #' + inv.number + ' submitted: ' + fmtH(inv.hours) + ' · ' + money(inv.amount) + '.'); })
      .catch(function (err) { invMsg(err.message, true); renderSubmit(); });
  });

  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      scope = b.dataset.scope;
      document.querySelectorAll('.seg button').forEach(function (o) { o.classList.toggle('on', o === b); });
      render();
    });
  });
  $('month').addEventListener('change', function () { invMsg(''); render(); });

  $('csv').addEventListener('click', function () {
    var q = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['date', 'name', 'subject matter', 'hours', 'rate', 'amount', 'invoice'].join(',')];
    visible().forEach(function (e) { lines.push([e.date, e.name, e.matter, e.hours.toFixed(2), e.rate.toFixed(2), (e.hours * e.rate).toFixed(2), e.invoiceNumber ? '#' + e.invoiceNumber : ''].map(q).join(',')); });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'hours-' + (scope === 'mine' ? key(me).replace(/\s+/g, '-') : 'team') + '-' + ($('month').value || 'all') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('print').addEventListener('click', function () { document.body.classList.remove('print-inv'); window.print(); });

  // refresh when coming back to the tab, so teammates' entries show up
  document.addEventListener('visibilitychange', function () { if (!document.hidden && me && mode === 'remote') load(); });

  $('date').value = today();
  $('month').value = today().slice(0, 7);
  setHours(0);
  show();
})();
