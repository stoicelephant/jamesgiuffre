// /team: arya's view of everyone's hours, pay, and submitted invoices.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var TEAM = ['arya', 'james', 'hammad', 'milo', 'ballah', 'golam'];   // keep in sync with invoice.js + api/_redis.js
  var me = '';
  try { me = (localStorage.getItem('inv.name') || '').trim().toLowerCase(); } catch (e) {}
  var entries = [], invoices = [];

  function fmtH(h) { var m = Math.round(h * 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function monthLabel(ym) { if (!ym) return 'all time'; var p = ym.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase(); }
  function fmtDate(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }).toLowerCase(); }
  function fmtStamp(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase(); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function thisMonth() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  if (me !== 'arya') { $('denied').hidden = false; return; }
  $('app').hidden = false;

  // person filter
  var sel = $('person');
  sel.appendChild(new Option('everyone', ''));
  TEAM.forEach(function (n) { sel.appendChild(new Option(n, n)); });
  $('month').value = thisMonth();

  function inPeriod(ym) { var m = $('month').value; return !m || ym === m; }
  function forPerson(n) { return !sel.value || n === sel.value; }

  function load() {
    return fetch('/api/entries?name=arya', { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'could not load'); return d; }); })
      .then(function (d) { entries = d.entries || []; invoices = d.invoices || []; $('sync').textContent = 'live · updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase(); $('sync').classList.remove('local'); })
      .catch(function (e) { $('sync').textContent = e.message; $('sync').classList.add('local'); })
      .then(render);
  }

  function render() {
    // --- by person
    var names = TEAM.slice();
    entries.forEach(function (e) { if (names.indexOf(e.name) < 0) names.push(e.name); });
    var body = $('sum-rows'); body.textContent = '';
    var T = { h: 0, b: 0, s: 0 };
    names.forEach(function (n) {
      var list = entries.filter(function (e) { return e.name === n && inPeriod(e.date.slice(0, 7)); });
      var h = 0, b = 0, s = 0;
      list.forEach(function (e) { var a = e.hours * e.rate; h += e.hours; b += a; if (e.invoiceId) s += a; });
      T.h += h; T.b += b; T.s += s;
      var tr = el('tr', 'pick' + (sel.value === n ? ' on' : ''));
      tr.appendChild(el('td', null, n));
      tr.appendChild(el('td', 'num', fmtH(h)));
      tr.appendChild(el('td', 'num', money(b)));
      tr.appendChild(el('td', 'num', money(s)));
      tr.appendChild(el('td', 'num' + (b - s > 0.004 ? ' due' : ''), money(b - s)));
      tr.title = 'show only ' + n;
      tr.addEventListener('click', function () { sel.value = sel.value === n ? '' : n; render(); });
      body.appendChild(tr);
    });
    $('s-hours').textContent = fmtH(T.h); $('s-billed').textContent = money(T.b);
    $('s-sub').textContent = money(T.s); $('s-pend').textContent = money(T.b - T.s);

    // --- all entries
    var list = visible(), rows = $('rows'); rows.textContent = '';
    list.forEach(function (e) {
      var tr = el('tr');
      tr.appendChild(el('td', 'c-date', fmtDate(e.date)));
      tr.appendChild(el('td', 'c-who', e.name));
      tr.appendChild(el('td', 'matter', e.matter));
      tr.appendChild(el('td', 'num', fmtH(e.hours)));
      tr.appendChild(el('td', 'num c-rate', money(e.rate)));
      tr.appendChild(el('td', 'num', money(e.hours * e.rate)));
      var x = el('td', 'c-x'); if (e.invoiceId) x.appendChild(el('span', 'tag', '#' + e.invoiceNumber)); tr.appendChild(x);
      rows.appendChild(tr);
    });
    $('empty').hidden = list.length > 0;
    var th = list.reduce(function (s, e) { return s + e.hours; }, 0), ta = list.reduce(function (s, e) { return s + e.hours * e.rate; }, 0);
    $('print-meta').textContent = (sel.value || 'everyone') + ' · ' + monthLabel($('month').value) + ' · ' + fmtH(th) + ' hrs · ' + money(ta);

    // --- invoices
    var inv = invoices.filter(function (i) { return forPerson(i.name) && inPeriod(i.month); })
      .sort(function (a, b) { return a.submitted < b.submitted ? 1 : -1; });
    var ib = $('inv-rows'); ib.textContent = '';
    inv.forEach(function (i) {
      var tr = el('tr');
      tr.appendChild(el('td', 'c-date', '#' + i.number));
      tr.appendChild(el('td', 'c-who', i.name));
      tr.appendChild(el('td', null, monthLabel(i.month)));
      tr.appendChild(el('td', 'num', fmtH(i.hours)));
      tr.appendChild(el('td', 'num', money(i.amount)));
      tr.appendChild(el('td', 'num c-sub', fmtStamp(i.submitted)));
      var x = el('td', 'c-x'), p = el('button', 'link', 'print'); p.type = 'button'; p.style.fontSize = '13px'; p.style.marginLeft = '12px';
      p.addEventListener('click', function () { printInvoice(i); }); x.appendChild(p); tr.appendChild(x);
      ib.appendChild(tr);
    });
    $('inv-empty').hidden = inv.length > 0;
  }

  function visible() {
    return entries.filter(function (e) { return forPerson(e.name) && inPeriod(e.date.slice(0, 7)); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created < b.created ? 1 : -1); });
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

  sel.addEventListener('change', render);
  $('month').addEventListener('change', render);
  $('all-time').addEventListener('click', function () { $('month').value = ''; render(); });
  $('print').addEventListener('click', function () { document.body.classList.remove('print-inv'); window.print(); });
  $('csv').addEventListener('click', function () {
    var q = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['date', 'name', 'subject matter', 'hours', 'rate', 'amount', 'invoice'].join(',')];
    visible().forEach(function (e) { lines.push([e.date, e.name, e.matter, e.hours.toFixed(2), e.rate.toFixed(2), (e.hours * e.rate).toFixed(2), e.invoiceNumber ? '#' + e.invoiceNumber : ''].map(q).join(',')); });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'team-hours-' + (sel.value || 'everyone') + '-' + ($('month').value || 'all-time') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });

  load();
})();
