// fomo team: time, expenses, reimbursements. One page, five views.
// Data lives behind /api/* (Upstash Redis). Everyone sees their own; arya sees everyone and approves.
(function () {
  'use strict';
  var TEAM = ['demo', 'arya', 'james', 'hammad', 'milo', 'ballah', 'golam'];   // keep in sync with api/_redis.js
  var ADMIN = 'arya';
  var CATEGORIES = ['food', 'transport', 'lodging', 'software', 'equipment', 'events', 'other'];

  // ---------- tiny helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function key(n) { return String(n || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function member(n) { var k = key(n); return TEAM.indexOf(k) > -1 ? k : null; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtH(h) { var m = Math.round(h * 60); return Math.floor(m / 60) + ':' + pad(m % 60); }
  function money(n) { return '$' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { var v = Math.round((n || 0) * 100) / 100; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function ymOf(d) { return String(d || '').slice(0, 7); }
  function monthLabel(ym) { var p = ym.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase(); }
  function monthShort(ym) { var p = ym.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-US', { month: 'long' }).toLowerCase(); }
  function fmtDate(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase(); }
  function fmtStamp(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase(); }
  function sum(list, f) { return list.reduce(function (s, x) { return s + f(x); }, 0); }
  function byNewest(a, b) { return (a.created || a.submitted || '') < (b.created || b.submitted || '') ? 1 : -1; }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : byNewest(a, b); }

  var toastTimer;
  function toast(t) { var n = $('toast'); n.textContent = t; n.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { n.classList.remove('show'); }, 2600); }

  // two taps to confirm, no pop-up dialogs
  function disarm(btn) { if (btn.dataset.armed) { delete btn.dataset.armed; btn.classList.remove('armed'); btn.textContent = btn.dataset.orig; } }
  function armed(btn, label, ms) {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.classList.remove('armed'); return true; }
    var orig = btn.textContent;
    btn.dataset.armed = '1'; btn.dataset.orig = orig; btn.classList.add('armed'); btn.textContent = label;
    setTimeout(function () { if (btn.dataset.armed) { delete btn.dataset.armed; btn.classList.remove('armed'); btn.textContent = btn.dataset.orig; } }, ms || 3000);
    return false;
  }

  // ---------- state ----------
  var me = member(store.get('inv.name')) || '';
  var isAdmin = false;
  var ym = ymOf(today());
  var view = 'overview';
  var D = { entries: [], invoices: [], expenses: [], requests: [] };
  var selected = {};             // expense ids picked for a reimbursement request
  var teamFilter = '';

  // ---------- api ----------
  function api(method, path, body) {
    var opt = { method: method, headers: {}, cache: 'no-store' };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'something went wrong, try again'); return d; });
    });
  }
  function load() {
    return api('GET', '/api/entries?name=' + encodeURIComponent(me)).then(function (d) {
      D = { entries: d.entries || [], invoices: d.invoices || [], expenses: d.expenses || [], requests: d.requests || [] };
      isAdmin = !!d.admin;
      setSync('');
      render();
    }).catch(function (e) { setSync(e.message, true); render(); });
  }
  function setSync(t, bad) { var s = $('sync'); s.textContent = t; s.classList.toggle('bad', !!bad); }

  // ---------- sign in ----------
  var nameIn = $('login-name'), nameList = $('name-list'), go = $('login-go'), active = -1, shown = [];
  function matches(q) {
    q = key(q); if (!q) return TEAM.slice();
    return TEAM.filter(function (n) { return n.indexOf(q) > -1; }).sort(function (a, b) { return (a.indexOf(q) === 0 ? 0 : 1) - (b.indexOf(q) === 0 ? 0 : 1); });
  }
  function openList() {
    var q = key(nameIn.value); shown = matches(q); nameList.textContent = '';
    if (!shown.length) nameList.appendChild(el('li', 'none', 'no one on the team by that name'));
    shown.forEach(function (n, i) {
      var li = el('li'); li.setAttribute('role', 'option'); li.id = 'nm-' + i;
      var k = n.indexOf(q);
      if (q && k > -1) li.append(n.slice(0, k), el('mark', null, n.slice(k, k + q.length)), n.slice(k + q.length)); else li.textContent = n;
      li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(n); });
      nameList.appendChild(li);
    });
    active = shown.length && q ? 0 : -1; highlight();
    nameList.hidden = false; nameIn.setAttribute('aria-expanded', 'true');
  }
  function closeList() { nameList.hidden = true; nameIn.setAttribute('aria-expanded', 'false'); }
  function highlight() { $$('li', nameList).forEach(function (li, i) { li.classList.toggle('on', i === active); }); }
  function pick(n) { nameIn.value = n; closeList(); validName(); }
  function validName() { var ok = !!member(nameIn.value); go.disabled = !ok; $('login-msg').textContent = ''; return ok; }
  nameIn.addEventListener('input', function () { openList(); validName(); });
  nameIn.addEventListener('focus', openList);
  nameIn.addEventListener('blur', function () { setTimeout(closeList, 120); });
  nameIn.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (nameList.hidden) openList(); active = Math.min(shown.length - 1, active + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    else if (e.key === 'Enter' && !nameList.hidden && active > -1 && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') closeList();
  });
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = member(nameIn.value);
    if (!n) { $('login-msg').textContent = 'pick your name from the list.'; $('login-msg').classList.add('err'); openList(); return; }
    me = n; store.set('inv.name', me); start();
  });
  $('switch').addEventListener('click', function () { me = ''; store.del('inv.name'); nameIn.value = ''; go.disabled = true; start(); });

  function start() {
    $('signin').hidden = !!me;
    $('shell').hidden = !me;
    if (!me) { document.body.classList.remove('is-admin'); setTimeout(function () { nameIn.focus(); }, 50); return; }
    isAdmin = me === ADMIN;
    document.body.classList.toggle('is-admin', isAdmin);
    $('me-name').textContent = me;
    $('me-avatar').textContent = me.charAt(0);
    $('hello').textContent = 'hey ' + me;
    $('rate').value = store.get('inv.rate.' + me) || '';
    selected = {}; teamFilter = '';
    route(); updatePreview(); load();
  }

  // ---------- views + month ----------
  function route() {
    var v = (location.hash || '').replace('#', '') || 'overview';
    if (['overview', 'time', 'expenses', 'approvals', 'team'].indexOf(v) < 0) v = 'overview';
    if ((v === 'approvals' || v === 'team') && me !== ADMIN) v = 'overview';
    view = v;
    $$('.view').forEach(function (s) { s.classList.toggle('on', s.dataset.view === v); });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
  }
  window.addEventListener('hashchange', function () { route(); window.scrollTo(0, 0); });
  $$('#tabs button').forEach(function (b) { b.addEventListener('click', function () { location.hash = b.dataset.view; }); });
  $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { location.hash = b.dataset.go; }); });
  $$('.mbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = ym.split('-'), d = new Date(+p[0], +p[1] - 1 + (+b.dataset.step), 1);
      ym = d.getFullYear() + '-' + pad(d.getMonth() + 1); selected = {}; render();
    });
  });

  // ---------- derived numbers ----------
  function mine(list) { return list.filter(function (x) { return x.name === me; }); }
  function inMonth(list) { return list.filter(function (x) { return ymOf(x.date) === ym; }); }
  function owedToMe() {
    var inv = sum(mine(D.invoices).filter(function (i) { return i.status !== 'paid'; }), function (i) { return i.amount; });
    var req = sum(mine(D.requests).filter(function (r) { return r.status === 'pending' || r.status === 'approved'; }), function (r) { return r.total; });
    return inv + req;
  }
  var EXP_STATUS = { unsubmitted: ['draft', 'not sent'], pending: ['pending', 'with arya'], approved: ['approved', 'approved'], reimbursed: ['paid', 'paid'], rejected: ['rejected', 'rejected'] };
  var REQ_STATUS = { pending: ['pending', 'with arya'], approved: ['approved', 'approved'], paid: ['paid', 'paid'], rejected: ['rejected', 'rejected'] };
  var INV_STATUS = { submitted: ['pending', 'with arya'], paid: ['paid', 'paid'] };
  function pill(map, status) { var s = map[status] || ['draft', status]; return el('span', 'pill ' + s[0], s[1]); }

  // ---------- render ----------
  function render() {
    $$('.month-label').forEach(function (n) { n.textContent = monthLabel(ym); });
    renderOverview(); renderTime(); renderExpenses();
    if (isAdmin) { renderApprovals(); renderTeam(); }
  }

  var openPeople = {};
  function renderOverview() {
    var E = inMonth(mine(D.entries)), X = inMonth(mine(D.expenses));
    var hrs = sum(E, function (e) { return e.hours; }), billed = sum(E, function (e) { return e.hours * e.rate; });
    var spent = sum(X, function (x) { return x.amount; });
    var stats = $('stats'); stats.textContent = '';
    [
      ['time', fmtH(hrs), E.length + (E.length === 1 ? ' entry' : ' entries')],
      ['billed', money0(billed), invoiceStateText()],
      ['expenses', money0(spent), X.length + (X.length === 1 ? ' expense' : ' expenses')],
      ['owed to you', money0(owedToMe()), 'across all months']
    ].forEach(function (s) {
      var d = el('div', 'stat' + (s[0] === 'owed to you' ? ' accent' : '')); d.appendChild(el('div', 'k', s[0])); d.appendChild(el('div', 'v', s[1])); d.appendChild(el('div', 's', s[2])); stats.appendChild(d);
    });

    // category bars (one series, one hue, direct labels)
    var bars = $('cat-bars'); bars.textContent = '';
    var byCat = CATEGORIES.map(function (c) { return [c, sum(X.filter(function (x) { return x.category === c; }), function (x) { return x.amount; })]; })
      .filter(function (c) { return c[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
    var max = byCat.length ? byCat[0][1] : 0;
    $('cat-total').textContent = spent ? money(spent) : '';
    if (!byCat.length) bars.appendChild(el('p', 'empty', 'no expenses in ' + monthShort(ym) + '.'));
    byCat.forEach(function (c) {
      var row = el('div', 'bar-row'); row.title = c[0] + ': ' + money(c[1]) + ' (' + Math.round(c[1] / spent * 100) + '%)';
      row.appendChild(el('span', 'lbl', c[0]));
      var tr = el('div', 'bar-track'), f = el('div', 'bar-fill'); f.style.width = (c[1] / max * 100) + '%'; tr.appendChild(f); row.appendChild(tr);
      row.appendChild(el('span', 'amt', money(c[1])));
      bars.appendChild(row);
    });

    // arya only: what's waiting on him across the team
    $('overview-grid').classList.toggle('solo', !isAdmin);
    var st = $('standing'); st.textContent = '';
    if (isAdmin) {
      var byOld = function (a, b) { return (a.submitted || '') < (b.submitted || '') ? -1 : 1; };
      var items = [];
      D.requests.forEach(function (r) {
        if (r.status === 'pending') items.push({ who: r.name, kind: 'review', t: 'reimbursement ' + r.number, d: 'to review · ' + r.lines.length + (r.lines.length === 1 ? ' item' : ' items') + ' · sent ' + fmtStamp(r.submitted), amt: r.total, submitted: r.submitted });
        else if (r.status === 'approved') items.push({ who: r.name, kind: 'payR', t: 'reimbursement ' + r.number, d: 'approved, to pay · sent ' + fmtStamp(r.submitted), amt: r.total, submitted: r.submitted });
      });
      D.invoices.forEach(function (i) {
        if (i.status !== 'paid') items.push({ who: i.name, kind: 'payI', t: 'invoice #' + i.number, d: 'to pay · ' + fmtH(i.hours) + ' hrs · ' + periodLabel(i) + ' · sent ' + fmtStamp(i.submitted), amt: i.amount, submitted: i.submitted });
      });
      var people = {};
      items.sort(byOld).forEach(function (it) { (people[it.who] = people[it.who] || []).push(it); });
      Object.keys(people).forEach(function (who) {
        var list = people[who];
        var n = function (k) { return list.filter(function (x) { return x.kind === k; }).length; };
        var rv = n('review'), pr = n('payR'), pi = n('payI'), parts = [];
        if (rv) parts.push(rv + ' pending ' + (rv === 1 ? 'reimbursement' : 'reimbursements'));
        if (pr) parts.push(pr + ' approved ' + (pr === 1 ? 'reimbursement' : 'reimbursements') + ' to pay');
        if (pi) parts.push(pi + ' pending ' + (pi === 1 ? 'invoice' : 'invoices'));
        var grp = el('div', 'stand-group' + (openPeople[who] ? ' open' : ''));
        var head = el('button', 'stand'); head.type = 'button'; head.setAttribute('aria-expanded', String(!!openPeople[who]));
        var l = el('div', 'who'); l.appendChild(el('span', 'avatar', who.charAt(0)));
        var tx = el('div'); tx.appendChild(el('div', 't', who + ' has ' + parts.join(' and ').replace(/ and (?=.* and )/g, ', '))); tx.appendChild(el('div', 'd', 'oldest sent ' + fmtStamp(list[0].submitted))); l.appendChild(tx);
        var rr = el('div', 'r'); rr.appendChild(el('span', null, money(sum(list, function (x) { return x.amt; })))); rr.appendChild(el('span', 'chev', '›'));
        head.appendChild(l); head.appendChild(rr); grp.appendChild(head);
        var body = el('div', 'stand-items');
        list.forEach(function (it) {
          var row = el('div', 'stand-item'), a = el('div');
          a.appendChild(el('div', 't', it.t)); a.appendChild(el('div', 'd', it.d));
          row.appendChild(a); row.appendChild(el('span', 'amt', money(it.amt))); body.appendChild(row);
        });
        var go = el('button', 'btn ghost small', 'review in approvals'); go.type = 'button';
        go.addEventListener('click', function () { location.hash = 'approvals'; });
        var gf = el('div', 'stand-foot'); gf.appendChild(go); body.appendChild(gf);
        grp.appendChild(body);
        head.addEventListener('click', function () { openPeople[who] = !openPeople[who]; grp.classList.toggle('open', openPeople[who]); head.setAttribute('aria-expanded', String(openPeople[who])); });
        st.appendChild(grp);
      });
      if (!st.children.length) st.appendChild(el('p', 'empty', 'nothing pending. all caught up.'));
    }

    // recent activity
    var feed = $('feed'); feed.textContent = '';
    var items = E.map(function (e) { return { k: 't', t: e.matter, d: fmtDate(e.date) + ' · ' + fmtH(e.hours) + (e.start ? ' · ' + fmtRange(e.start, e.hours) : ''), a: money(e.hours * e.rate), c: e.created }; })
      .concat(X.map(function (x) { return { k: 'x', t: x.merchant, d: fmtDate(x.date) + ' · ' + x.category, a: money(x.amount), c: x.created }; }))
      .sort(function (a, b) { return a.c < b.c ? 1 : -1; }).slice(0, 8);
    if (!items.length) feed.appendChild(el('li', 'empty-li', 'nothing yet in ' + monthShort(ym) + '. log some time or add an expense.'));
    items.forEach(function (it) {
      var li = el('li'); li.appendChild(el('span', 'ic' + (it.k === 'x' ? ' x' : ''), it.k === 't' ? 'hr' : '$'));
      var m = el('div'); m.appendChild(el('div', 't', it.t)); m.appendChild(el('div', 'd', it.d)); li.appendChild(m);
      li.appendChild(el('span', 'a', it.a)); feed.appendChild(li);
    });
  }
  function invoiceStateText() {
    var inv = mine(D.invoices).filter(function (i) { return i.month === ym; });
    var un = inMonth(mine(D.entries)).filter(function (e) { return !e.invoiceId; }).length;
    if (!inv.length) return un ? 'not invoiced yet' : 'nothing to invoice';
    if (un) return 'new time since last invoice';
    return inv.every(function (i) { return i.status === 'paid'; }) ? 'paid' : 'invoice sent';
  }

  // ---------- time ----------
  var hours = 0;
  function fmtRange(start, h) {
    if (!start) return '';
    var p = start.split(':'), s = (+p[0]) * 60 + (+p[1]), e = (s + Math.round(h * 60)) % 1440;
    function part(m) { var hh = Math.floor(m / 60), mm = m % 60; return (hh % 12 || 12) + (mm ? ':' + pad(mm) : ''); }
    function ap(m) { return m < 720 ? 'a' : 'p'; }
    return ap(s) === ap(e) ? part(s) + '–' + part(e) + ap(e) : part(s) + ap(s) + '–' + part(e) + ap(e);
  }
  // "1p", "1:30p", "130p", "9", "930", "13:00", "noon". no am/pm: 7-11 morning, 12-6 afternoon. snaps to 15 min.
  function parseTime(v) {
    var s = String(v || '').trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
    if (!s) return '';
    if (s === 'noon') s = '12p'; if (s === 'midnight') s = '12a';
    var m = s.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
    if (!m) return null;
    var h = +m[1], min = m[2] ? +m[2] : 0, ap = m[3] ? m[3][0] : '';
    if (min > 59) return null;
    if (ap) { if (h < 1 || h > 12) return null; if (ap === 'p' && h !== 12) h += 12; if (ap === 'a' && h === 12) h = 0; }
    else if (h > 23) return null;
    else if (h >= 1 && h <= 6) h += 12;
    var t = Math.round((h * 60 + min) / 15) * 15 % 1440;
    return pad(Math.floor(t / 60)) + ':' + pad(t % 60);
  }
  function niceTime(hhmm) { var p = hhmm.split(':'), h = +p[0]; return (h % 12 || 12) + ':' + p[1] + ' ' + (h < 12 ? 'am' : 'pm'); }
  function endTime(st, h) { var p = st.split(':'), m = ((+p[0]) * 60 + (+p[1]) + Math.round(h * 60)) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function getRate() { var r = parseFloat($('rate').value); return isFinite(r) && r >= 0 ? r : NaN; }
  function setHours(h) { hours = Math.min(24, Math.max(0, Math.round(h * 4) / 4)); $('hours').textContent = fmtH(hours); updatePreview(); }
  function updateRange() {
    var st = parseTime($('start').value), rp = $('range-preview');
    rp.classList.toggle('bad', st === null);
    rp.textContent = st === null ? 'try 1p or 9:30a' : (st && hours ? fmtRange(st, hours) : '');
  }
  function updatePreview() {
    updateRange();
    var r = getRate(), pv = $('preview'); pv.textContent = '';
    if (!isFinite(r)) { pv.textContent = 'set your rate to see the amount'; return; }
    if (!hours) return;
    pv.append(fmtH(hours) + ' × ' + money(r) + '/hr = ', el('strong', null, money(hours * r)));
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.max(44, t.scrollHeight + 2) + 'px'; }

  $('rate').addEventListener('input', function () { var r = getRate(); if (isFinite(r)) store.set('inv.rate.' + me, String(r)); else store.del('inv.rate.' + me); updatePreview(); });
  $$('.step').forEach(function (b) { b.addEventListener('click', function () { setHours(hours + parseFloat(b.dataset.d)); }); });
  $$('#entry-form .chip').forEach(function (b) { b.addEventListener('click', function () { setHours(hours + parseFloat(b.dataset.h)); }); });
  $('clear-time').addEventListener('click', function () { setHours(0); });
  $('start').addEventListener('input', updateRange);
  $('start').addEventListener('blur', function () { var s = parseTime($('start').value); if (s) $('start').value = niceTime(s); updateRange(); });
  $('start').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('start').blur(); } });
  $('matter').addEventListener('input', function () { grow($('matter')); });
  $('matter').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('add-entry').click(); } });

  $('entry-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('entry-err'), r = getRate(), matter = $('matter').value.trim(), date = $('date').value, st = parseTime($('start').value);
    err.textContent = '';
    if (!isFinite(r)) { err.textContent = 'set your hourly rate first.'; $('rate').focus(); return; }
    if (!date) { err.textContent = 'pick a date.'; return; }
    if (!matter) { err.textContent = 'add what you worked on.'; $('matter').focus(); return; }
    if (!hours) { err.textContent = 'add some time.'; return; }
    if (st === null) { err.textContent = "couldn't read that start time, try 1p or 9:30a."; $('start').focus(); return; }
    var btn = $('add-entry'), h = hours; btn.disabled = true;
    api('POST', '/api/entries', { name: me, date: date, matter: matter, hours: h, rate: r, start: st || '' })
      .then(function (d) {
        D.entries.push(d.entry);
        $('start').value = st ? niceTime(endTime(st, h)) : '';      // next entry starts where this one ended
        $('matter').value = ''; grow($('matter')); setHours(0);
        render();
      })
      .catch(function (x) { err.textContent = x.message; })
      .then(function () { btn.disabled = false; });
  });

  function renderTime() {
    var E = mine(D.entries).filter(function (e) { return !e.invoiceId; }).sort(byDateDesc), tb = $('entry-rows'); tb.textContent = '';
    E.forEach(function (e) {
      var tr = el('tr');
      tr.appendChild(el('td', null, fmtDate(e.date)));
      tr.appendChild(el('td', 'work', e.matter));
      var tc = el('td', 'num', fmtH(e.hours)); if (e.start) tc.appendChild(el('span', 'sub', fmtRange(e.start, e.hours))); tr.appendChild(tc);
      tr.appendChild(el('td', 'num hide-sm', money(e.rate)));
      tr.appendChild(el('td', 'num', money(e.hours * e.rate)));
      var act = el('td', 'act');
      if (e.invoiceId) act.appendChild(el('span', 'catpill', '#' + e.invoiceNumber));
      else {
        var b = el('button', 'del', '×'); b.type = 'button'; b.title = 'delete'; b.setAttribute('aria-label', 'delete entry');
        b.addEventListener('click', function () {
          if (!armed(b, 'delete?', 2500)) return;
          b.disabled = true;
          api('DELETE', '/api/entries?id=' + encodeURIComponent(e.id) + '&name=' + encodeURIComponent(me))
            .then(function () { D.entries = D.entries.filter(function (x) { return x.id !== e.id; }); render(); })
            .catch(function (x) { toast(x.message); b.disabled = false; });
        });
        act.appendChild(b);
      }
      tr.appendChild(act); tb.appendChild(tr);
    });
    $('t-hours').textContent = fmtH(sum(E, function (e) { return e.hours; }));
    $('t-amount').textContent = money(sum(E, function (e) { return e.hours * e.rate; }));
    $('entry-empty').hidden = E.length > 0;
    document.querySelector('#entry-rows').closest('table').querySelector('tfoot').hidden = !E.length;

    var un = E.filter(function (e) { return !e.invoiceId; }), sumP = $('invoice-sum'), sb = $('submit-invoice');
    sumP.textContent = '';
    if (un.length) {
      sumP.append(un.length + (un.length === 1 ? ' entry' : ' entries') + ' to invoice: ', el('strong', null, fmtH(sum(un, function (e) { return e.hours; })) + ' · ' + money(sum(un, function (e) { return e.hours * e.rate; }))));
      sb.disabled = false;
    } else { sumP.textContent = 'nothing new to invoice.'; sb.disabled = true; disarm(sb); }

    var inv = mine(D.invoices).sort(byNewest), ib = $('invoice-rows'); ib.textContent = '';
    inv.forEach(function (i) {
      var tr = el('tr');
      tr.appendChild(el('td', null, '#' + i.number));
      tr.appendChild(el('td', null, periodLabel(i)));
      tr.appendChild(el('td', 'num hide-sm', fmtH(i.hours)));
      tr.appendChild(el('td', 'num', money(i.amount)));
      var sc = el('td'); sc.appendChild(pill(INV_STATUS, i.status || 'submitted')); tr.appendChild(sc);
      tr.appendChild(el('td', 'act'));
      ib.appendChild(tr);
      expandable(tr, 'i' + i.id, 6, function () { return invoiceDetail(i); });
    });
    $('invoice-empty').hidden = inv.length > 0;
  }
  $('submit-invoice').addEventListener('click', function () {
    var b = $('submit-invoice');
    if (!armed(b, 'tap again to send to arya')) return;
    b.disabled = true;
    api('POST', '/api/invoices', { name: me })
      .then(function (d) { toast('invoice #' + d.invoice.number + ' sent to arya'); return load(); })
      .catch(function (x) { toast(x.message); render(); });
  });

  // ---------- expenses ----------
  var receipt = null, category = '';
  var cats = $('cats');
  CATEGORIES.forEach(function (c) {
    var b = el('button', 'chip', c); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
    b.addEventListener('click', function () { category = c; $$('.chip', cats).forEach(function (o) { var on = o === b; o.classList.toggle('on', on); o.setAttribute('aria-checked', on); }); });
    cats.appendChild(b);
  });

  function readAsDataURL(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(file); }); }
  function loadImage(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    return viaImg(file);
    function viaImg(f) { return new Promise(function (res, rej) { var u = URL.createObjectURL(f), i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('bad image')); }; i.src = u; }); }
  }
  // photos get shrunk to a sharp-enough jpeg (~200-400 KB) before upload
  function prepareReceipt(file) {
    if (file.type === 'application/pdf') {
      if (file.size > 3 * 1024 * 1024) return Promise.reject(new Error('that pdf is over 3 MB, try a photo or a smaller pdf'));
      return readAsDataURL(file).then(function (u) { return { data: u, type: 'application/pdf', filename: file.name, preview: '' }; });
    }
    return loadImage(file).then(function (img) {
      var w = img.width, h = img.height, max = 1600, k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      var q = 0.78, u = c.toDataURL('image/jpeg', q);
      while (u.length > 1.4e6 && q > 0.4) { q -= 0.12; u = c.toDataURL('image/jpeg', q); }
      return { data: u, type: 'image/jpeg', filename: (file.name || 'receipt').replace(/\.\w+$/, '') + '.jpg', preview: u };
    }).catch(function () { throw new Error("couldn't read that image. try a jpg or png, or a screenshot of it"); });
  }
  function setReceipt(file) {
    $('expense-err').textContent = '';
    prepareReceipt(file).then(function (r) {
      receipt = r;
      $('drop-empty').hidden = true; $('drop-full').hidden = false;
      $('drop-img').hidden = !r.preview; if (r.preview) $('drop-img').src = r.preview;
      $('drop-pdf').hidden = !!r.preview;
      $('drop-name').textContent = file.name || 'receipt';
      scanReceipt(r);
    }).catch(function (e) { $('expense-err').textContent = e.message; });
  }

  // ---------- receipt reading: AI on the server when connected, otherwise read the photo in the browser ----------
  var scanId = 0;
  function scanStatus(t, busy) { var n = $('scan-status'); n.textContent = t || ''; n.classList.toggle('busy', !!busy); }
  function scanReceipt(r) {
    var id = ++scanId;
    scanStatus('reading receipt…', true);
    api('POST', '/api/scan', { name: me, receipt: { data: r.data, type: r.type } })
      .then(function (d) { return d.fields || {}; })
      .catch(function () {                                   // not connected (or failed): read it here
        if (r.type === 'application/pdf') return null;
        return ocrText(r.data).then(parseReceiptText);
      })
      .then(function (f) {
        if (id !== scanId || !receipt) return;                 // a newer receipt replaced this one
        var n = f ? autofill(f) : 0;
        scanStatus(n ? 'filled ' + n + (n === 1 ? ' field' : ' fields') + ' from the receipt, check them' : (f === null ? 'add the details below' : "couldn't read much, add the details below"));
        if (!$('merchant').value) $('merchant').focus();
      })
      .catch(function () { if (id === scanId) scanStatus("couldn't read it, add the details below"); });
  }
  function mark(input) { input.classList.add('autofilled'); setTimeout(function () { input.classList.remove('autofilled'); }, 2600); }
  // only fills fields that are still empty, so nothing typed gets overwritten
  function autofill(f) {
    var n = 0;
    if (f.merchant && !$('merchant').value.trim()) { $('merchant').value = f.merchant; mark($('merchant')); n++; }
    if (f.amount > 0 && !$('amount').value.trim()) { $('amount').value = Number(f.amount).toFixed(2); mark($('amount').parentNode); n++; }
    if (f.date && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.date <= today() && ($('xdate').value === today() || !$('xdate').value)) {
      if (f.date !== $('xdate').value) { $('xdate').value = f.date; mark($('xdate')); } n++;
    }
    if (f.category && CATEGORIES.indexOf(f.category) > -1 && !category) {
      var chip = $$('.chip', cats).filter(function (c) { return c.textContent === f.category; })[0]; if (chip) { chip.click(); n++; }
    }
    if (f.note && !$('xnote').value.trim()) { $('xnote').value = f.note; n++; }
    return n;
  }

  // in-browser OCR (tesseract.js, loaded only when needed)
  var tessLoading = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tessLoading) return tessLoading;
    tessLoading = new Promise(function (res, rej) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      sc.onload = function () { res(window.Tesseract); }; sc.onerror = function () { tessLoading = null; rej(new Error('ocr unavailable')); };
      document.head.appendChild(sc);
    });
    return tessLoading;
  }
  function ocrText(dataUrl) { return loadTesseract().then(function (T) { return T.recognize(dataUrl, 'eng'); }).then(function (o) { return (o && o.data && o.data.text) || ''; }); }

  var CAT_WORDS = {
    transport: /\b(uber|lyft|taxi|cab|metro|mta|subway|transit|parking|park|toll|shell|exxon|chevron|mobil|bp|sunoco|fuel|gas|airline|airlines|delta|jetblue|united|american air|southwest|spirit|amtrak|train|rail|citi ?bike|lime|bird|revel|car rental|hertz|avis|enterprise)\b/,
    lodging: /\b(hotel|inn|suites?|marriott|hilton|hyatt|westin|sheraton|airbnb|motel|lodge|resort|hostel)\b/,
    software: /\b(figma|notion|google|workspace|aws|amazon web services|github|slack|openai|anthropic|adobe|zoom|linear|vercel|dropbox|microsoft|subscription|saas|software|app store|apple\.com\/bill)\b/,
    equipment: /\b(best buy|apple store|b&h|staples|office depot|micro center|newegg|hardware|electronics|monitor|keyboard|cable)\b/,
    events: /\b(eventbrite|ticket|tickets|venue|conference|admission|luma|partiful|meetup|booth)\b/,
    food: /\b(restaurant|cafe|caf[eé]|coffee|starbucks|dunkin|sweetgreen|chipotle|pizza|grill|bar|kitchen|bistro|deli|bakery|diner|sushi|burger|taco|doordash|uber ?eats|grubhub|seamless|caviar|food|lunch|dinner|breakfast|brunch|tip|gratuity|server|table)\b/
  };
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function parseReceiptText(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var low = lines.map(function (l) { return l.toLowerCase(); });
    var money = /(?:\$|usd\s?)?\s?(\d{1,5}(?:,\d{3})*[.,]\d{2})(?!\d)/g;
    function amounts(l) { var out = [], m; money.lastIndex = 0; while ((m = money.exec(l))) out.push(parseFloat(m[1].replace(/,(?=\d{3})/g, '').replace(',', '.'))); return out; }
    var f = {};
    // total: last amount on a "total"-like line (not subtotal), else the largest amount on the receipt
    var best = null;
    low.forEach(function (l, i) {
      if (/(^|\b)(grand total|total due|amount due|balance due|total|amount paid|you paid|charged)\b/.test(l) && !/sub\s?-?total|total savings|items?\s+total/.test(l)) {
        var a = amounts(lines[i]); if (!a.length && lines[i + 1]) a = amounts(lines[i + 1]);
        if (a.length) best = a[a.length - 1];
      }
    });
    if (best == null) { var all = []; lines.forEach(function (l) { all = all.concat(amounts(l)); }); if (all.length) best = Math.max.apply(null, all); }
    if (best > 0) f.amount = best;
    // date
    var yNow = new Date().getFullYear(), txt = low.join(' '), d = null, m;
    if ((m = txt.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/))) d = [+m[1], +m[2], +m[3]];
    else if ((m = txt.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/))) d = [+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2]];
    else if ((m = txt.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/))) d = [+m[3], MONTHS[m[1]], +m[2]];
    else if ((m = txt.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s+(20\d{2})\b/))) d = [+m[3], MONTHS[m[2]], +m[1]];
    if (d && d[1] >= 1 && d[1] <= 12 && d[2] >= 1 && d[2] <= 31 && d[0] >= yNow - 2 && d[0] <= yNow) f.date = d[0] + '-' + pad(d[1]) + '-' + pad(d[2]);
    // merchant: first line that reads like a name
    for (var i = 0; i < Math.min(lines.length, 8); i++) {
      var l = lines[i], lw = low[i];
      if (/[a-z]{3,}/i.test(l) && !/receipt|invoice|order|welcome|thank|tel|phone|www\.|http|@|\d{3}[-.\s]\d{3}[-.\s]\d{4}|^\d+\s|street|st\.|ave|suite|date|time/.test(lw) && l.replace(/[^a-z]/gi, '').length >= 3) {
        f.merchant = l.replace(/[^\w&' .-]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60); break;
      }
    }
    // category from keywords
    for (var c in CAT_WORDS) { if (CAT_WORDS[c].test(txt)) { f.category = c; break; } }
    return f;
  }
  function clearReceipt() { scanId++; scanStatus(''); receipt = null; $('receipt').value = ''; $('drop-empty').hidden = false; $('drop-full').hidden = true; $('drop-img').removeAttribute('src'); }
  $('receipt').addEventListener('change', function () { if (this.files[0]) setReceipt(this.files[0]); });
  $('drop-clear').addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    if (receipt) { clearReceipt(); if (editing && editing.receiptId && !removeExisting) showExistingReceipt(); }
    else if (editing && editing.receiptId) { removeExisting = true; clearReceipt(); }
    else clearReceipt();
  });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) setReceipt(f); });

  function parseAmount(v) { var n = parseFloat(String(v || '').replace(/[$,\s]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; }
  $('amount').addEventListener('blur', function () { var n = parseAmount(this.value); if (isFinite(n) && n > 0) this.value = n.toFixed(2); });

  // ---------- editing an expense (only before it's sent to arya, or after a rejection) ----------
  var editing = null, removeExisting = false;
  function setCategory(c) { category = c || ''; $$('.chip', cats).forEach(function (o) { var on = o.textContent === category; o.classList.toggle('on', on); o.setAttribute('aria-checked', on); }); }
  function showExistingReceipt() {
    $('drop-empty').hidden = true; $('drop-full').hidden = false;
    $('drop-img').hidden = true; $('drop-pdf').hidden = false; $('drop-pdf').textContent = 'saved';
    $('drop-name').textContent = 'current receipt · drop a new one to replace';
  }
  function startEdit(x) {
    editing = x; removeExisting = false; receipt = null; scanId++; scanStatus('');
    $('merchant').value = x.merchant; $('amount').value = Number(x.amount).toFixed(2); $('xdate').value = x.date; $('xnote').value = x.note || '';
    setCategory(x.category);
    if (x.receiptId) showExistingReceipt(); else { $('drop-empty').hidden = false; $('drop-full').hidden = true; }
    $('expense-form-title').textContent = 'edit expense';
    $('add-expense').textContent = 'save changes';
    $('cancel-edit').hidden = false;
    $('expense-form').classList.add('editing');
    $('expense-err').textContent = '';
    $('expense-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { $('merchant').focus(); }, 300);
  }
  function endEdit() {
    editing = null; removeExisting = false;
    $('merchant').value = ''; $('amount').value = ''; $('xnote').value = ''; $('xdate').value = today();
    setCategory(''); clearReceipt(); $('drop-pdf').textContent = 'pdf';
    $('expense-form-title').textContent = 'add expense';
    $('add-expense').textContent = 'add expense';
    $('cancel-edit').hidden = true;
    $('expense-form').classList.remove('editing');
  }
  $('cancel-edit').addEventListener('click', endEdit);

  $('expense-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('expense-err'), merchant = $('merchant').value.trim(), amount = parseAmount($('amount').value), date = $('xdate').value;
    err.textContent = '';
    if (!merchant) { err.textContent = 'add where it was from.'; $('merchant').focus(); return; }
    if (!(amount > 0)) { err.textContent = 'add the amount.'; $('amount').focus(); return; }
    if (!date) { err.textContent = 'pick a date.'; return; }
    if (!category) { err.textContent = 'pick a category.'; return; }
    var btn = $('add-expense'); btn.disabled = true;
    if (editing) {
      btn.textContent = 'saving…';
      var ed = editing;
      api('PATCH', '/api/expenses', { name: me, id: ed.id, date: date, merchant: merchant, amount: amount, category: category, note: $('xnote').value.trim(),
        receipt: receipt ? { data: receipt.data, type: receipt.type, filename: receipt.filename } : null, removeReceipt: removeExisting })
        .then(function (d) {
          D.expenses = D.expenses.map(function (o) { return o.id === d.expense.id ? d.expense : o; });
          endEdit();
          toast('saved ' + merchant + ' · ' + money(amount));
          render();
        })
        .catch(function (x) { err.textContent = x.message; btn.textContent = 'save changes'; })
        .then(function () { btn.disabled = false; });
      return;
    }
    btn.textContent = receipt ? 'uploading…' : 'adding…';
    api('POST', '/api/expenses', { name: me, date: date, merchant: merchant, amount: amount, category: category, note: $('xnote').value.trim(), receipt: receipt ? { data: receipt.data, type: receipt.type, filename: receipt.filename } : null })
      .then(function (d) {
        D.expenses.push(d.expense);
        $('merchant').value = ''; $('amount').value = ''; $('xnote').value = ''; clearReceipt();
        setCategory('');
        selected[d.expense.id] = true;
        toast('added ' + merchant + ' · ' + money(amount));
        render();
      })
      .catch(function (x) { err.textContent = x.message; })
      .then(function () { btn.disabled = false; btn.textContent = 'add expense'; });
  });

  function selectable(x) { return x.name === me && (x.status === 'unsubmitted' || x.status === 'rejected'); }
  function receiptButton(x) {
    var b = el('button', 'rc', 'receipt'); b.type = 'button'; b.addEventListener('click', function () { openReceipt(x); }); return b;
  }
  function renderExpenses() {
    var X = mine(D.expenses).filter(selectable).sort(byDateDesc), tb = $('expense-rows'); tb.textContent = '';
    Object.keys(selected).forEach(function (id) { var x = D.expenses.filter(function (e) { return e.id === id; })[0]; if (!x || !selectable(x)) delete selected[id]; });
    X.forEach(function (x) {
      var tr = el('tr');
      var c0 = el('td', 'chk');
      if (selectable(x)) {
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!selected[x.id]; cb.setAttribute('aria-label', 'include ' + x.merchant);
        cb.addEventListener('change', function () { if (cb.checked) selected[x.id] = true; else delete selected[x.id]; renderReimbBar(X); });
        c0.appendChild(cb);
      }
      tr.appendChild(c0);
      tr.appendChild(el('td', null, fmtDate(x.date)));
      var w = el('td', 'work', x.merchant);
      if (x.note) w.appendChild(el('span', 'sub', x.note));
      if (x.status === 'rejected' && x.reviewNote) w.appendChild(el('span', 'sub', 'arya: ' + x.reviewNote));
      var ms = el('span', 'sub show-sm'); ms.appendChild(pill(EXP_STATUS, x.status)); w.appendChild(ms);
      tr.appendChild(w);
      var cc = el('td', 'hide-sm'); cc.appendChild(el('span', 'catpill', x.category)); tr.appendChild(cc);
      tr.appendChild(el('td', 'num', money(x.amount)));
      var sc = el('td', 'hide-sm'); sc.appendChild(pill(EXP_STATUS, x.status)); tr.appendChild(sc);
      var act = el('td', 'act');
      if (selectable(x)) {
        var eb = el('button', 'rc edit', 'edit'); eb.type = 'button'; eb.addEventListener('click', function () { startEdit(x); }); act.appendChild(eb);
      }
      if (x.receiptId) act.appendChild(receiptButton(x));
      if (selectable(x)) {
        var d = el('button', 'del', '×'); d.type = 'button'; d.setAttribute('aria-label', 'delete expense');
        d.addEventListener('click', function () {
          if (!armed(d, 'delete?', 2500)) return;
          d.disabled = true;
          api('DELETE', '/api/expenses?id=' + encodeURIComponent(x.id) + '&name=' + encodeURIComponent(me))
            .then(function () { if (editing && editing.id === x.id) endEdit(); D.expenses = D.expenses.filter(function (o) { return o.id !== x.id; }); delete selected[x.id]; render(); })
            .catch(function (er) { toast(er.message); d.disabled = false; });
        });
        act.appendChild(d);
      }
      tr.appendChild(act); tb.appendChild(tr);
    });
    $('expense-empty').hidden = X.length > 0;
    var sel = X.filter(selectable);
    $('check-all').disabled = !sel.length;
    $('check-all').checked = sel.length > 0 && sel.every(function (x) { return selected[x.id]; });
    renderReimbBar(X);

    var R = mine(D.requests).sort(byNewest), rb = $('request-rows'); rb.textContent = '';
    R.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r.number));
      var sent = el('td', null, fmtStamp(r.submitted)); if (r.note) sent.appendChild(el('span', 'sub', 'arya: ' + r.note)); tr.appendChild(sent);
      tr.appendChild(el('td', 'num hide-sm', String(r.lines.length)));
      tr.appendChild(el('td', 'num', money(r.total)));
      var sc = el('td'); sc.appendChild(pill(REQ_STATUS, r.status)); tr.appendChild(sc);
      tr.appendChild(el('td', 'act'));
      rb.appendChild(tr);
      expandable(tr, 'r' + r.id, 6, function () { return requestDetail(r); });
    });
    $('request-empty').hidden = R.length > 0;
  }
  function renderReimbBar(X) {
    var picked = X.filter(function (x) { return selected[x.id] && selectable(x); }), p = $('reimb-sum'), b = $('submit-reimb');
    p.textContent = '';
    var open = X.filter(selectable);
    if (picked.length) { p.append(picked.length + ' selected: ', el('strong', null, money(sum(picked, function (x) { return x.amount; })))); b.disabled = false; }
    else { p.textContent = open.length ? 'select expenses to send to arya.' : 'nothing waiting to be sent.'; b.disabled = true; disarm(b); }
    $('check-all').checked = open.length > 0 && open.every(function (x) { return selected[x.id]; });
  }
  $('check-all').addEventListener('change', function () {
    var on = this.checked;
    mine(D.expenses).filter(selectable).forEach(function (x) { if (on) selected[x.id] = true; else delete selected[x.id]; });
    renderExpenses();
  });
  $('submit-reimb').addEventListener('click', function () {
    var b = $('submit-reimb'), ids = Object.keys(selected);
    if (!ids.length) return;
    if (!armed(b, 'tap again to send to arya')) return;
    b.disabled = true;
    api('POST', '/api/reimbursements', { name: me, expenseIds: ids })
      .then(function (d) { selected = {}; toast(d.request.number + ' sent to arya · ' + money(d.request.total)); return load(); })
      .catch(function (x) { toast(x.message); render(); });
  });

  // ---------- tap a row for its breakdown ----------
  var opened = {};
  function expandable(tr, id, cols, build) {
    tr.classList.add('click'); tr.tabIndex = 0; tr.setAttribute('aria-expanded', 'false');
    var chev = el('span', 'chev', '›'); tr.lastChild.appendChild(chev);
    var dr = el('tr', 'detail'), td = el('td'); td.colSpan = cols; dr.appendChild(td);
    function show(on) {
      opened[id] = on; tr.classList.toggle('open', on); tr.setAttribute('aria-expanded', String(on));
      td.textContent = ''; if (on) td.appendChild(build());
      if (on) tr.after(dr); else dr.remove();
    }
    tr.addEventListener('click', function (e) { if (e.target.closest('button,a,input')) return; show(!opened[id]); });
    tr.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); show(!opened[id]); } });
    if (opened[id]) show(true);
  }
  function periodLabel(i) {
    var ds = (i.lines || []).map(function (l) { return l.date; }).sort();
    var a = i.from || ds[0], b = i.to || ds[ds.length - 1];
    if (!a) return monthLabel(i.month);
    return a === b ? fmtDate(a) : fmtDate(a) + ' – ' + fmtDate(b);
  }
  function steps(list) {
    var t = el('ol', 'timeline');
    list.forEach(function (s) { if (!s) return; var li = el('li', s[2] ? 'bad' : null); li.appendChild(el('b', null, s[0])); li.appendChild(el('span', null, fmtStamp(s[1]))); t.appendChild(li); });
    return t;
  }
  function invoiceDetail(i) {
    var box = el('div', 'breakdown');
    box.appendChild(steps([['submitted', i.submitted], i.paidAt ? ['paid', i.paidAt] : null]));
    var tbl = el('table', 'tbl mini'), tb = el('tbody');
    i.lines.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (l) {
      var tr = el('tr');
      tr.appendChild(el('td', null, fmtDate(l.date)));
      tr.appendChild(el('td', 'work', l.matter));
      var tc = el('td', 'num', fmtH(l.hours)); if (l.start) tc.appendChild(el('span', 'sub', fmtRange(l.start, l.hours))); tr.appendChild(tc);
      tr.appendChild(el('td', 'num hide-sm', money(l.rate) + '/hr'));
      tr.appendChild(el('td', 'num', money(l.amount)));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    var tf = el('tfoot'), fr = el('tr');
    fr.appendChild(el('td', null, 'total')); fr.appendChild(el('td')); fr.appendChild(el('td', 'num', fmtH(i.hours))); fr.appendChild(el('td', 'hide-sm')); fr.appendChild(el('td', 'num', money(i.amount)));
    tf.appendChild(fr); tbl.appendChild(tf); box.appendChild(tbl);
    var foot = el('div', 'breakdown-foot'), p = el('button', 'btn ghost small', 'print / save pdf'); p.type = 'button';
    p.addEventListener('click', function () { printInvoice(i); }); foot.appendChild(p); box.appendChild(foot);
    return box;
  }
  function requestDetail(r) {
    var box = el('div', 'breakdown');
    box.appendChild(steps([['sent', r.submitted], r.approvedAt ? ['approved', r.approvedAt] : null, r.rejectedAt ? ['rejected', r.rejectedAt, true] : null, r.paidAt ? ['paid', r.paidAt] : null]));
    if (r.note) box.appendChild(el('p', 'breakdown-note', 'arya: ' + r.note));
    var tbl = el('table', 'tbl mini'), tb = el('tbody');
    r.lines.forEach(function (l) {
      var tr = el('tr');
      tr.appendChild(el('td', null, fmtDate(l.date)));
      var w = el('td', 'work', l.merchant); if (l.note) w.appendChild(el('span', 'sub', l.note)); tr.appendChild(w);
      var cc = el('td', 'hide-sm'); cc.appendChild(el('span', 'catpill', l.category)); tr.appendChild(cc);
      tr.appendChild(el('td', 'num', money(l.amount)));
      var act = el('td', 'act');
      if (l.hasReceipt) act.appendChild(receiptButton({ id: l.expenseId })); else act.appendChild(el('span', 'muted hide-sm', 'no receipt'));
      tr.appendChild(act); tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    var byCat = {};
    r.lines.forEach(function (l) { byCat[l.category] = (byCat[l.category] || 0) + l.amount; });
    var tf = el('tfoot'), fr = el('tr');
    fr.appendChild(el('td', null, 'total')); var mc = el('td', 'muted-cell'); mc.appendChild(el('span', 'hide-sm', Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).map(function (c) { return c + ' ' + money0(byCat[c]); }).join(' · '))); fr.appendChild(mc);
    fr.appendChild(el('td', 'hide-sm')); fr.appendChild(el('td', 'num', money(r.total))); fr.appendChild(el('td'));
    tf.appendChild(fr); tbl.appendChild(tf); box.appendChild(tbl);
    if (r.status === 'rejected') box.appendChild(el('p', 'breakdown-note', 'these expenses are back in unsent expenses. fix them up and send again.'));
    return box;
  }

  // receipt viewer
  var lastUrl = null;
  function openReceipt(x) {
    fetch('/api/receipt?id=' + encodeURIComponent(x.id) + '&name=' + encodeURIComponent(me), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('could not load that receipt'); return r.blob(); })
      .then(function (blob) {
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(blob);
        var pdf = blob.type === 'application/pdf';
        $('viewer-img').hidden = pdf; $('viewer-pdf').hidden = !pdf;
        if (pdf) $('viewer-pdf').src = lastUrl; else $('viewer-img').src = lastUrl;
        $('viewer').hidden = false;
      })
      .catch(function (e) { toast(e.message); });
  }
  function closeViewer() { $('viewer').hidden = true; $('viewer-pdf').removeAttribute('src'); }
  $('viewer-close').addEventListener('click', closeViewer);
  $('viewer').addEventListener('click', function (e) { if (e.target === $('viewer')) closeViewer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('viewer').hidden) closeViewer(); });

  // ---------- approvals (arya) ----------
  function review(r, action, note, btn) {
    btn.disabled = true;
    api('PATCH', '/api/reimbursements', { name: me, id: r.id, action: action, note: note || '' })
      .then(function () { toast(r.number + ' ' + ({ approve: 'approved', reject: 'rejected', paid: 'marked paid' })[action]); return load(); })
      .catch(function (x) { toast(x.message); btn.disabled = false; });
  }
  function renderApprovals() {
    var list = $('approval-list'); list.textContent = '';
    var open = D.requests.filter(function (r) { return r.status === 'pending' || r.status === 'approved'; })
      .sort(function (a, b) { return (a.status === b.status ? 0 : a.status === 'pending' ? -1 : 1) || (a.submitted < b.submitted ? -1 : 1); });
    var pend = open.filter(function (r) { return r.status === 'pending'; }).length;
    var badge = $('approvals-badge'); badge.hidden = !pend; badge.textContent = pend;
    if (!open.length) list.appendChild(el('div', 'approvals-empty', 'no reimbursement requests waiting. nice.'));
    open.forEach(function (r) {
      var c = el('div', 'req');
      var head = el('div', 'req-head'), who = el('div', 'who');
      who.appendChild(el('span', 'avatar', r.name.charAt(0)));
      var t = el('div'); t.appendChild(el('strong', null, r.name + ' · ' + r.number)); t.appendChild(el('div', 'd', 'sent ' + fmtStamp(r.submitted) + ' · ' + r.lines.length + (r.lines.length === 1 ? ' item' : ' items'))); who.appendChild(t);
      var right = el('div'); right.style.textAlign = 'right'; right.appendChild(el('div', 'req-total', money(r.total))); right.appendChild(pill(REQ_STATUS, r.status));
      head.appendChild(who); head.appendChild(right); c.appendChild(head);

      var wrap = el('div', 'table-wrap'), tbl = el('table', 'tbl'), tb = el('tbody');
      r.lines.forEach(function (l) {
        var tr = el('tr');
        tr.appendChild(el('td', null, fmtDate(l.date)));
        var w = el('td', 'work', l.merchant); if (l.note) w.appendChild(el('span', 'sub', l.note)); tr.appendChild(w);
        var cc = el('td', 'hide-sm'); cc.appendChild(el('span', 'catpill', l.category)); tr.appendChild(cc);
        tr.appendChild(el('td', 'num', money(l.amount)));
        var act = el('td', 'act');
        if (l.hasReceipt) act.appendChild(receiptButton({ id: l.expenseId })); else act.appendChild(el('span', 'muted', 'no receipt'));
        tr.appendChild(act); tb.appendChild(tr);
      });
      tbl.appendChild(tb); wrap.appendChild(tbl); c.appendChild(wrap);

      var acts = el('div', 'req-actions');
      if (r.status === 'pending') {
        var note = document.createElement('input'); note.placeholder = 'note (optional, shown to ' + r.name + ')'; note.maxLength = 300;
        var rej = el('button', 'btn ghost', 'reject'); rej.type = 'button';
        rej.addEventListener('click', function () { if (armed(rej, 'tap to reject')) review(r, 'reject', note.value, rej); });
        var ok = el('button', 'btn primary', 'approve'); ok.type = 'button';
        ok.addEventListener('click', function () { review(r, 'approve', note.value, ok); });
        var paid = el('button', 'btn ghost', 'approve + paid'); paid.type = 'button';
        paid.addEventListener('click', function () { review(r, 'paid', note.value, paid); });
        acts.appendChild(note); acts.appendChild(rej); acts.appendChild(paid); acts.appendChild(ok);
      } else {
        acts.appendChild(el('span', 'muted', 'approved ' + fmtStamp(r.approvedAt) + (r.note ? ' · "' + r.note + '"' : '') + '. mark paid once the money is sent.'));
        var mp = el('button', 'btn primary', 'mark paid'); mp.type = 'button'; mp.style.marginLeft = 'auto';
        mp.addEventListener('click', function () { review(r, 'paid', r.note, mp); });
        acts.appendChild(mp);
      }
      c.appendChild(acts); list.appendChild(c);
    });

    // invoices to pay
    var inv = D.invoices.filter(function (i) { return i.status !== 'paid'; }).sort(function (a, b) { return a.submitted < b.submitted ? -1 : 1; });
    var pb = $('pay-rows'); pb.textContent = '';
    inv.forEach(function (i) {
      var tr = el('tr');
      tr.appendChild(el('td', null, '#' + i.number));
      tr.appendChild(el('td', null, i.name));
      tr.appendChild(el('td', null, monthLabel(i.month)));
      tr.appendChild(el('td', 'num', money(i.amount)));
      var sc = el('td'); sc.appendChild(pill(INV_STATUS, i.status || 'submitted')); tr.appendChild(sc);
      var act = el('td', 'act');
      var pr = el('button', 'link', 'view'); pr.type = 'button'; pr.style.marginRight = '12px'; pr.addEventListener('click', function () { printInvoice(i); });
      var mp = el('button', 'btn primary small', 'mark paid'); mp.type = 'button';
      mp.addEventListener('click', function () {
        mp.disabled = true;
        api('PATCH', '/api/invoices', { name: me, id: i.id, status: 'paid' })
          .then(function () { toast('invoice #' + i.number + ' marked paid'); return load(); })
          .catch(function (x) { toast(x.message); mp.disabled = false; });
      });
      act.appendChild(pr); act.appendChild(mp); tr.appendChild(act); pb.appendChild(tr);
    });
    $('pay-empty').hidden = inv.length > 0;

    // history
    var ev = [];
    D.requests.forEach(function (r) {
      if (r.rejectedAt) ev.push({ at: r.rejectedAt, t: r.name + ' · ' + r.number + ' rejected', a: money(r.total), s: 'rejected' });
      if (r.paidAt) ev.push({ at: r.paidAt, t: r.name + ' · ' + r.number + ' paid', a: money(r.total), s: 'paid' });
      else if (r.approvedAt) ev.push({ at: r.approvedAt, t: r.name + ' · ' + r.number + ' approved', a: money(r.total), s: 'approved' });
    });
    D.invoices.forEach(function (i) { if (i.paidAt) ev.push({ at: i.paidAt, t: i.name + ' · invoice #' + i.number + ' paid', a: money(i.amount), s: 'paid' }); });
    ev.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var h = $('history'); h.textContent = '';
    if (!ev.length) h.appendChild(el('li', 'empty-li', 'nothing reviewed yet.'));
    ev.slice(0, 20).forEach(function (x) {
      var li = el('li'); li.appendChild(el('span', 'ic' + (x.s === 'rejected' ? ' x' : ''), x.s === 'rejected' ? '×' : '✓'));
      var m = el('div'); m.appendChild(el('div', 't', x.t)); m.appendChild(el('div', 'd', fmtStamp(x.at))); li.appendChild(m);
      li.appendChild(el('span', 'a', x.a)); h.appendChild(li);
    });
  }

  // ---------- team (arya) ----------
  function renderTeam() {
    var E = inMonth(D.entries), X = inMonth(D.expenses), paidInv = {};
    D.invoices.forEach(function (i) { if (i.status === 'paid') paidInv[i.id] = true; });
    var rows = $('team-rows'); rows.textContent = '';
    var T = { h: 0, b: 0, x: 0, p: 0 };
    var names = TEAM.slice(); E.concat(X).forEach(function (o) { if (names.indexOf(o.name) < 0) names.push(o.name); });
    names.forEach(function (n) {
      var e = E.filter(function (o) { return o.name === n; }), x = X.filter(function (o) { return o.name === n; });
      var h = sum(e, function (o) { return o.hours; }), b = sum(e, function (o) { return o.hours * o.rate; }), xs = sum(x, function (o) { return o.amount; });
      var p = sum(e.filter(function (o) { return o.invoiceId && paidInv[o.invoiceId]; }), function (o) { return o.hours * o.rate; }) + sum(x.filter(function (o) { return o.status === 'reimbursed'; }), function (o) { return o.amount; });
      T.h += h; T.b += b; T.x += xs; T.p += p;
      var tr = el('tr', teamFilter === n ? 'on' : '');
      tr.appendChild(el('td', null, n));
      tr.appendChild(el('td', 'num', fmtH(h)));
      tr.appendChild(el('td', 'num', money(b)));
      tr.appendChild(el('td', 'num', money(xs)));
      tr.appendChild(el('td', 'num', money(p)));
      tr.appendChild(el('td', 'num', money(b + xs - p)));
      tr.addEventListener('click', function () { teamFilter = teamFilter === n ? '' : n; renderTeam(); });
      rows.appendChild(tr);
    });
    var ft = $('team-foot'); ft.textContent = '';
    var fr = el('tr'); ['total', fmtH(T.h), money(T.b), money(T.x), money(T.p), money(T.b + T.x - T.p)].forEach(function (v, i) { fr.appendChild(el('td', i ? 'num' : null, v)); }); ft.appendChild(fr);
    $('team-filter-label').textContent = teamFilter ? 'showing ' + teamFilter + ' · tap again to clear' : 'everyone';

    var fe = E.filter(function (o) { return !teamFilter || o.name === teamFilter; }).sort(byDateDesc), eb = $('team-entries'); eb.textContent = '';
    fe.forEach(function (o) {
      var tr = el('tr');
      tr.appendChild(el('td', null, fmtDate(o.date)));
      tr.appendChild(el('td', null, o.name));
      tr.appendChild(el('td', 'work', o.matter));
      var tc = el('td', 'num', fmtH(o.hours)); if (o.start) tc.appendChild(el('span', 'sub', fmtRange(o.start, o.hours))); tr.appendChild(tc);
      tr.appendChild(el('td', 'num', money(o.hours * o.rate)));
      var tg = el('td', 'act'); if (o.invoiceId) tg.appendChild(el('span', 'catpill', '#' + o.invoiceNumber + (paidInv[o.invoiceId] ? ' · paid' : ''))); tr.appendChild(tg);
      eb.appendChild(tr);
    });
    $('team-entries-empty').hidden = fe.length > 0;

    var fx = X.filter(function (o) { return !teamFilter || o.name === teamFilter; }).sort(byDateDesc), xb = $('team-expenses'); xb.textContent = '';
    fx.forEach(function (o) {
      var tr = el('tr');
      tr.appendChild(el('td', null, fmtDate(o.date)));
      tr.appendChild(el('td', null, o.name));
      var w = el('td', 'work', o.merchant); if (o.note) w.appendChild(el('span', 'sub', o.note));
      var ms = el('span', 'sub show-sm'); ms.appendChild(pill(EXP_STATUS, o.status)); w.appendChild(ms); tr.appendChild(w);
      var cc = el('td', 'hide-sm'); cc.appendChild(el('span', 'catpill', o.category)); tr.appendChild(cc);
      tr.appendChild(el('td', 'num', money(o.amount)));
      var sc = el('td', 'hide-sm'); sc.appendChild(pill(EXP_STATUS, o.status)); tr.appendChild(sc);
      var act = el('td', 'act'); if (o.receiptId) act.appendChild(receiptButton(o)); tr.appendChild(act);
      xb.appendChild(tr);
    });
    $('team-expenses-empty').hidden = fx.length > 0;
  }

  // ---------- print one invoice ----------
  function printInvoice(inv) {
    var box = $('print-invoice'); box.textContent = '';
    var head = el('div', 'pi-head'), left = el('div');
    left.appendChild(el('div', 'pi-title', 'invoice #' + inv.number)); left.appendChild(el('div', null, inv.name));
    var right = el('div', 'pi-meta');
    right.appendChild(el('div', null, 'period: ' + periodLabel(inv)));
    right.appendChild(el('div', null, 'submitted: ' + fmtStamp(inv.submitted)));
    if (inv.paidAt) right.appendChild(el('div', null, 'paid: ' + fmtStamp(inv.paidAt)));
    head.appendChild(left); head.appendChild(right); box.appendChild(head);
    var t = el('table'), hr = el('tr'), th = el('thead');
    [['date'], ['work'], ['time', 'num'], ['rate', 'num'], ['amount', 'num']].forEach(function (c) { hr.appendChild(el('th', c[1], c[0])); });
    th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody');
    inv.lines.forEach(function (l) {
      var tr = el('tr');
      tr.appendChild(el('td', null, fmtDate(l.date)));
      tr.appendChild(el('td', null, l.matter));
      tr.appendChild(el('td', 'num', fmtH(l.hours) + (l.start ? ' (' + fmtRange(l.start, l.hours) + ')' : '')));
      tr.appendChild(el('td', 'num', money(l.rate)));
      tr.appendChild(el('td', 'num', money(l.amount)));
      tb.appendChild(tr);
    });
    t.appendChild(tb); box.appendChild(t);
    var tot = el('div', 'pi-total'); tot.appendChild(el('span', null, 'total ' + fmtH(inv.hours) + ' hrs')); tot.appendChild(el('span', null, money(inv.amount))); box.appendChild(tot);
    document.body.classList.add('print-inv'); window.print();
  }
  window.addEventListener('afterprint', function () { document.body.classList.remove('print-inv'); });

  // refresh when you come back to the tab so arya's decisions and teammates' entries show up
  document.addEventListener('visibilitychange', function () { if (!document.hidden && me) load(); });

  // ---------- theme: light by default, dark on request (remembered on this device) ----------
  function setTheme(t) {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
    if (t === 'dark') store.set('inv.theme', 'dark'); else store.del('inv.theme');
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#0B091F' : '#FFFFFF';
    $$('[data-theme-set]').forEach(function (b) { var on = b.dataset.themeSet === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  }
  $$('[data-theme-set]').forEach(function (b) { b.addEventListener('click', function () { setTheme(b.dataset.themeSet); }); });
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

  $('date').value = today();
  $('xdate').value = today();
  setHours(0);
  start();
})();
