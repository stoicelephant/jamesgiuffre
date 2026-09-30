// /tracker: add tasks, drag them between not started / in progress / complete.
// Saves to /api/tasks (shared across devices). Locked behind a password the server checks;
// once entered, it's remembered on this device until you hit "lock".
(function () {
  var PASS = 'tracker.pass';
  var tasks = [];
  var pass = '';
  var $ = function (id) { return document.getElementById(id); };
  var cols = Array.prototype.slice.call(document.querySelectorAll('.col'));
  var statusEl = $('save-status');
  var lockMsg = $('lock-msg');

  var remember = {
    get: function () { try { return localStorage.getItem(PASS) || ''; } catch (e) { return ''; } },
    set: function (v) { try { v ? localStorage.setItem(PASS, v) : localStorage.removeItem(PASS); } catch (e) {} }
  };
  function id() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function say(t) { statusEl.textContent = t || ''; }
  function api(method, body) {
    var opt = { method: method, cache: 'no-store', headers: { 'x-tracker-pass': pass } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch('/api/tasks', opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || 'error'); e.status = r.status; throw e; } return d; });
    });
  }

  // ---------- lock ----------
  function lock(msg, isErr) {
    tasks = []; pass = '';
    $('app').hidden = true;
    $('lock').hidden = false;
    lockMsg.textContent = msg || '';
    lockMsg.classList.toggle('err', !!isErr);
    $('lock-pass').value = '';
    setTimeout(function () { $('lock-pass').focus(); }, 30);
  }
  function unlock(p) {
    pass = p;
    lockMsg.textContent = 'checking…'; lockMsg.classList.remove('err');
    api('GET').then(function (d) {
      remember.set(pass);
      tasks = d.tasks || [];
      $('lock').hidden = true;
      $('app').hidden = false;
      render();
    }).catch(function (e) {
      remember.set('');
      lock(e.status === 401 || e.status === 429 || e.status === 503 ? e.message : 'couldn\u2019t reach the server, try again', true);
    });
  }
  $('lock').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = $('lock-pass').value.trim();
    if (p) unlock(p);
  });
  $('relock').addEventListener('click', function () { remember.set(''); lock(); });

  // ---------- save ----------
  var timer = null;
  function save() {
    clearTimeout(timer);
    say('saving…');
    timer = setTimeout(function () {
      api('PUT', { tasks: tasks })
        .then(function () { say('saved'); setTimeout(function () { if (statusEl.textContent === 'saved') say(''); }, 1500); })
        .catch(function (e) {
          if (e.status === 401) { remember.set(''); return lock('password changed, enter it again', true); }
          say('couldn\u2019t save, will retry on your next change');
        });
    }, 350);
  }

  // ---------- render ----------
  function render() {
    cols.forEach(function (col) {
      var s = col.dataset.status;
      var list = col.querySelector('.list');
      var mine = tasks.filter(function (t) { return t.status === s; });
      list.innerHTML = '';
      mine.forEach(function (t) { list.appendChild(card(t)); });
      if (!mine.length) { var e = document.createElement('li'); e.className = 'empty'; e.textContent = 'drop here'; list.appendChild(e); }
      col.querySelector('.n').textContent = mine.length || '';
    });
    var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
    $('progress-text').textContent = tasks.length ? done + ' of ' + tasks.length + ' complete' : 'nothing yet';
    $('progress-fill').style.width = tasks.length ? (done / tasks.length * 100) + '%' : '0';
  }

  function card(t) {
    var li = document.createElement('li');
    li.className = 'card';
    li.dataset.id = t.id;
    var span = document.createElement('span');
    span.className = 't';
    span.textContent = t.title;
    var x = document.createElement('button');
    x.className = 'x';
    x.type = 'button';
    x.setAttribute('aria-label', 'delete task');
    x.textContent = '×';
    li.appendChild(span);
    li.appendChild(x);
    return li;
  }

  // ---------- add / delete ----------
  $('add').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('add-title');
    var title = input.value.replace(/\s+/g, ' ').trim();
    if (!title) return;
    tasks.push({ id: id(), title: title, status: 'todo', created: new Date().toISOString() });
    input.value = '';
    render(); save();
  });

  document.querySelector('.board').addEventListener('click', function (e) {
    var x = e.target.closest('.x');
    if (!x) return;
    var tid = x.closest('.card').dataset.id;
    tasks = tasks.filter(function (t) { return t.id !== tid; });
    render(); save();
  });

  // ---------- drag (pointer events: works with mouse and touch) ----------
  var drag = null;
  var slot = document.createElement('li');
  slot.className = 'slot';

  document.querySelector('.board').addEventListener('pointerdown', function (e) {
    var c = e.target.closest('.card');
    if (!c || e.target.closest('.x') || e.button > 0) return;
    drag = { el: c, id: c.dataset.id, x0: e.clientX, y0: e.clientY, started: false, pid: e.pointerId };
  });

  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.started) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return;
      var r = drag.el.getBoundingClientRect();
      drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
      drag.lift = drag.el.cloneNode(true);
      drag.lift.classList.add('lift');
      drag.lift.style.width = r.width + 'px';
      document.body.appendChild(drag.lift);
      drag.el.classList.add('ghost');
      document.body.classList.add('dragging');
      drag.started = true;
    }
    e.preventDefault();
    drag.lift.style.left = (e.clientX - drag.dx) + 'px';
    drag.lift.style.top = (e.clientY - drag.dy) + 'px';

    var col = colAt(e.clientX, e.clientY);
    cols.forEach(function (c) { c.classList.toggle('over', c === col); });
    if (!col) { if (slot.parentNode) slot.remove(); return; }
    var list = col.querySelector('.list');
    var before = null;
    var cards = list.querySelectorAll('.card:not(.ghost)');
    for (var i = 0; i < cards.length; i++) {
      var b = cards[i].getBoundingClientRect();
      if (e.clientY < b.top + b.height / 2) { before = cards[i]; break; }
    }
    list.insertBefore(slot, before);
  });

  function colAt(x, y) {
    for (var i = 0; i < cols.length; i++) {
      var r = cols[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 10 && y <= r.bottom + 40) return cols[i];
    }
    return null;
  }

  function finish(e) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    var d = drag; drag = null;
    if (!d.started) return;
    d.lift.remove();
    document.body.classList.remove('dragging');
    cols.forEach(function (c) { c.classList.remove('over'); });
    if (!slot.parentNode || (e && e.type === 'pointercancel')) { if (slot.parentNode) slot.remove(); render(); return; }

    var col = slot.closest('.col');
    var next = slot.nextElementSibling;
    while (next && (!next.classList.contains('card') || next.dataset.id === d.id)) next = next.nextElementSibling;
    slot.remove();

    var t = tasks.filter(function (x) { return x.id === d.id; })[0];
    if (!t) return render();
    tasks = tasks.filter(function (x) { return x.id !== d.id; });
    t.status = col.dataset.status;
    var at = next ? tasks.findIndex(function (x) { return x.id === next.dataset.id; }) : -1;
    if (at < 0) {
      // end of that column: place after its last task
      var last = -1;
      tasks.forEach(function (x, i) { if (x.status === t.status) last = i; });
      at = last + 1 || tasks.length;
    }
    tasks.splice(at, 0, t);
    render(); save();
  }
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);

  var saved = remember.get();
  if (saved) unlock(saved); else lock();
})();
