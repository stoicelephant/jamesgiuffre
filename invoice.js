// /invoice: name-only sign in, hourly rate, 15-minute time entries, shared log.
// Entries are stored through /api/entries (shared by the whole team). If that
// isn't connected yet, the page falls back to this browser's storage.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var LOCAL_KEY = 'inv.entries.local';

  var me = (store.get('inv.name') || '').trim();
  var hours = 0.25;
  var entries = [];
  var mode = 'remote';       // 'remote' = shared via /api, 'local' = this browser only
  var scope = 'mine';

  // ---------- helpers ----------
  function key(n) { return String(n || '').trim().toLowerCase(); }
  function fmtH(h) { var m = Math.round(h * 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function monthLabel(ym) { if (!ym) return 'all time'; var p = ym.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase(); }
  function fmtDate(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase(); }
  function rateKey() { return 'inv.rate.' + key(me); }
  function getRate() { var r = parseFloat($('rate').value); return isFinite(r) && r >= 0 ? r : NaN; }
  function msg(t, err) { var m = $('msg'); m.textContent = t || ''; m.classList.toggle('err', !!err); }

  // ---------- storage ----------
  function localAll() { try { return JSON.parse(store.get(LOCAL_KEY) || '[]'); } catch (e) { return []; } }
  function localSave(list) { store.set(LOCAL_KEY, JSON.stringify(list)); }

  function load() {
    return fetch('/api/entries', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { mode = 'remote'; entries = d.entries || []; })
      .catch(function () { mode = 'local'; entries = localAll(); })
      .then(render);
  }

  function add(e) {
    if (mode === 'local') {
      e.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      e.created = new Date().toISOString();
      var list = localAll(); list.push(e); localSave(list); entries = list;
      return Promise.resolve();
    }
    return fetch('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'could not save'); return d; }); })
      .then(function (d) { entries.push(d.entry); });
  }

  function remove(id) {
    if (mode === 'local') {
      var list = localAll().filter(function (e) { return e.id !== id; }); localSave(list); entries = list;
      return Promise.resolve();
    }
    return fetch('/api/entries?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(me), { method: 'DELETE' })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'could not delete'); }); })
      .then(function () { entries = entries.filter(function (e) { return e.id !== id; }); });
  }

  // ---------- view ----------
  function visible() {
    var ym = $('month').value;
    return entries
      .filter(function (e) { return (!ym || e.date.slice(0, 7) === ym) && (scope === 'all' || key(e.name) === key(me)); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.created < b.created ? 1 : -1); });
  }

  function render() {
    var list = visible(), rows = $('rows'), th = 0, ta = 0;
    rows.textContent = '';
    list.forEach(function (e) {
      var amt = e.hours * e.rate; th += e.hours; ta += amt;
      var tr = document.createElement('tr');
      function td(text, cls) { var c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text; tr.appendChild(c); return c; }
      td(fmtDate(e.date), 'c-date');
      td(e.name, 'c-who');
      td(e.matter, 'matter');
      td(fmtH(e.hours), 'num');
      td(money(e.rate), 'num c-rate');
      td(money(amt), 'num');
      var x = td('', 'c-x');
      if (key(e.name) === key(me)) {
        var b = document.createElement('button');
        b.className = 'del'; b.type = 'button'; b.textContent = '×'; b.title = 'delete entry'; b.setAttribute('aria-label', 'delete entry');
        b.addEventListener('click', function () {
          if (b.dataset.armed) {
            b.disabled = true;
            remove(e.id).then(render).catch(function (err) { msg(err.message, true); b.disabled = false; });
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
    document.querySelector('table').classList.toggle('mine', scope === 'mine');

    var sync = $('sync');
    sync.textContent = mode === 'remote' ? 'shared with your team' : 'saved in this browser only (shared storage not connected yet)';
    sync.classList.toggle('local', mode === 'local');

    $('print-meta').textContent = (scope === 'mine' ? me : 'all team members') + ' · ' + monthLabel($('month').value) + ' · ' + fmtH(th) + ' hrs · ' + money(ta);
  }

  function setHours(h) {
    hours = Math.min(24, Math.max(0.25, Math.round(h * 4) / 4));
    $('hours').textContent = fmtH(hours);
    updatePreview();
  }
  function updatePreview() {
    var r = getRate();
    $('preview').innerHTML = '';
    if (!isFinite(r)) { $('preview').textContent = 'set your rate above'; return; }
    var s = document.createElement('strong'); s.textContent = money(hours * r);
    $('preview').append(fmtH(hours) + ' × ' + money(r) + '/hr = ', s);
  }

  function show() {
    var signedIn = !!me;
    $('login').hidden = signedIn;
    $('app').hidden = !signedIn;
    if (!signedIn) { $('login-name').focus(); return; }
    $('who').textContent = me;
    $('rate').value = store.get(rateKey()) || '';
    updatePreview();
    load();
  }

  // ---------- events ----------
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = $('login-name').value.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!n) return;
    me = n; store.set('inv.name', me); show();
  });
  $('switch').addEventListener('click', function () { me = ''; store.del('inv.name'); $('login-name').value = ''; show(); });

  $('rate').addEventListener('input', function () {
    var r = getRate();
    if (isFinite(r)) store.set(rateKey(), String(r)); else store.del(rateKey());
    updatePreview();
  });

  document.querySelectorAll('.step').forEach(function (b) {
    b.addEventListener('click', function () { setHours(hours + parseFloat(b.dataset.d)); });
  });
  document.querySelectorAll('.chip').forEach(function (b) {
    b.addEventListener('click', function () { setHours(parseFloat(b.dataset.h)); });
  });

  $('entry-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = getRate(), matter = $('matter').value.trim(), date = $('date').value;
    if (!isFinite(r)) { msg('set your hourly rate first.', true); $('rate').focus(); return; }
    if (!matter) { msg('add the subject matter.', true); $('matter').focus(); return; }
    if (!date) { msg('pick a date.', true); return; }
    var btn = $('add'); btn.disabled = true; msg('saving…');
    add({ name: me, date: date, matter: matter.slice(0, 500), hours: hours, rate: r })
      .then(function () {
        msg('added ' + fmtH(hours) + ' for ' + money(hours * r) + '.');
        $('matter').value = ''; setHours(0.25);
        if ($('month').value && $('month').value !== date.slice(0, 7)) $('month').value = date.slice(0, 7);
        render();
      })
      .catch(function (err) { msg(err.message || 'could not save, try again.', true); })
      .then(function () { btn.disabled = false; });
  });

  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      scope = b.dataset.scope;
      document.querySelectorAll('.seg button').forEach(function (o) { o.classList.toggle('on', o === b); });
      render();
    });
  });
  $('month').addEventListener('change', render);

  $('csv').addEventListener('click', function () {
    var q = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['date', 'name', 'subject matter', 'hours', 'rate', 'amount'].join(',')];
    visible().forEach(function (e) { lines.push([e.date, e.name, e.matter, e.hours.toFixed(2), e.rate.toFixed(2), (e.hours * e.rate).toFixed(2)].map(q).join(',')); });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'invoice-' + (scope === 'mine' ? key(me).replace(/\s+/g, '-') : 'team') + '-' + ($('month').value || 'all') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('print').addEventListener('click', function () { window.print(); });

  // refresh when coming back to the tab, so teammates' entries show up
  document.addEventListener('visibilitychange', function () { if (!document.hidden && me && mode === 'remote') load(); });

  $('date').value = today();
  $('month').value = today().slice(0, 7);
  setHours(0.25);
  show();
})();
