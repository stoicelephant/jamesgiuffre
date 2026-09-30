// /tracker: add tasks, drag them between not started / in progress / complete.
// Finishing a task asks how long it took. Clicking a task opens a dropdown for links, photos and videos.
// Saves to /api/tasks (shared across devices); photos/videos go to /api/task-files in chunks.
// Locked behind a password the server checks; once entered, it's remembered on this device until "lock".
(function () {
  var PASS = 'tracker.pass';
  var CHUNK = 512 * 1024;                 // bytes per uploaded chunk (server allows up to ~512 KB)
  var MAX_FILE = 50 * 1024 * 1024;        // 50 MB per photo/video
  var tasks = [];
  var pass = '';
  var open = {};                          // task id -> dropdown open (this device only)
  var media = {};                         // file id -> object URL, once downloaded
  var uploading = {};                     // task id -> "uploading 40%"
  var $ = function (id) { return document.getElementById(id); };
  var cols = Array.prototype.slice.call(document.querySelectorAll('.col'));
  var board = document.querySelector('.board');
  var statusEl = $('save-status');
  var lockMsg = $('lock-msg');

  var remember = {
    get: function () { try { return localStorage.getItem(PASS) || ''; } catch (e) { return ''; } },
    set: function (v) { try { v ? localStorage.setItem(PASS, v) : localStorage.removeItem(PASS); } catch (e) {} }
  };
  function id() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
  function say(t) { statusEl.textContent = t || ''; }
  function find(tid) { return tasks.filter(function (t) { return t.id === tid; })[0]; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function api(method, path, body) {
    var opt = { method: method, cache: 'no-store', headers: { 'x-tracker-pass': pass } };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || 'error'); e.status = r.status; throw e; } return d; });
    });
  }
  function fmt(min) {
    if (!min) return '';
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + 'h' : '') + (h && m ? ' ' : '') + (m ? m + 'm' : '');
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

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
    api('GET', '/api/tasks').then(function (d) {
      remember.set(pass);
      tasks = d.tasks || [];
      $('lock').hidden = true;
      $('app').hidden = false;
      render();
    }).catch(function (e) {
      remember.set('');
      lock(e.status === 401 || e.status === 429 || e.status === 503 ? e.message : 'couldn’t reach the server, try again', true);
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
      api('PUT', '/api/tasks', { tasks: tasks })
        .then(function () { say('saved'); setTimeout(function () { if (statusEl.textContent === 'saved') say(''); }, 1500); })
        .catch(function (e) {
          if (e.status === 401) { remember.set(''); return lock('password changed, enter it again', true); }
          say('couldn’t save, will retry on your next change');
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
      if (!mine.length) list.appendChild(el('li', 'empty', 'drop here'));
      col.querySelector('.n').textContent = mine.length || '';
    });
    var done = tasks.filter(function (t) { return t.status === 'done'; });
    var mins = done.reduce(function (a, t) { return a + (t.took || 0); }, 0);
    $('progress-text').textContent = tasks.length ? done.length + ' of ' + tasks.length + ' complete' + (mins ? ' · ' + fmt(mins) + ' logged' : '') : 'nothing yet';
    $('progress-fill').style.width = tasks.length ? (done.length / tasks.length * 100) + '%' : '0';
  }

  function card(t) {
    var li = el('li', 'card' + (open[t.id] ? ' open' : ''));
    li.dataset.id = t.id;
    var head = el('div', 'head');
    head.appendChild(el('span', 't', t.title));
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'delete task');
    head.appendChild(x);
    li.appendChild(head);

    var bits = [];
    if (t.status === 'done' && t.took) bits.push('took ' + fmt(t.took));
    var nl = (t.links || []).length;
    var np = (t.files || []).filter(function (f) { return /^image/.test(f.type); }).length;
    var nv = (t.files || []).length - np;
    if (nl) bits.push(plural(nl, 'link'));
    if (np) bits.push(plural(np, 'photo'));
    if (nv) bits.push(plural(nv, 'video'));
    if (uploading[t.id]) bits.push(uploading[t.id]);
    if (bits.length) li.appendChild(el('div', 'meta', bits.join(' · ')));

    if (open[t.id]) li.appendChild(panel(t));
    return li;
  }

  function panel(t) {
    var p = el('div', 'panel');

    if (t.status === 'done') {
      var row = el('div', 'row');
      row.appendChild(el('span', 'lbl', t.took ? 'took ' + fmt(t.took) : 'no time logged'));
      var ed = el('button', 'lnk', t.took ? 'edit' : 'add time'); ed.type = 'button'; ed.dataset.act = 'time';
      row.appendChild(ed);
      p.appendChild(row);
    }

    // links
    var ul = el('ul', 'links');
    (t.links || []).forEach(function (l, i) {
      var li = el('li');
      var a = el('a', null, pretty(l.url)); a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
      var rm = el('button', 'rm', '×'); rm.type = 'button'; rm.dataset.act = 'rm-link'; rm.dataset.i = i; rm.setAttribute('aria-label', 'remove link');
      li.appendChild(a); li.appendChild(rm); ul.appendChild(li);
    });
    if (ul.children.length) p.appendChild(ul);
    var f = el('form', 'mini'); f.dataset.act = 'add-link';
    var inp = el('input'); inp.type = 'text'; inp.inputMode = 'url'; inp.spellcheck = false; inp.placeholder = 'paste a link'; inp.name = 'url'; inp.autocomplete = 'off';
    var go = el('button', null, 'add link'); go.type = 'submit';
    f.appendChild(inp); f.appendChild(go);
    p.appendChild(f);

    // photos + videos
    if ((t.files || []).length) {
      var g = el('div', 'media');
      t.files.forEach(function (file, i) {
        var box = el('div', 'm');
        box.dataset.file = file.id;
        var isImg = /^image/.test(file.type);
        if (media[file.id]) box.appendChild(mediaEl(file, media[file.id]));
        else { box.appendChild(el('span', 'loading', 'loading ' + (isImg ? 'photo' : 'video') + '…')); fetchFile(file); }
        var rm = el('button', 'rm', '×'); rm.type = 'button'; rm.dataset.act = 'rm-file'; rm.dataset.i = i; rm.setAttribute('aria-label', 'remove');
        box.appendChild(rm);
        g.appendChild(box);
      });
      p.appendChild(g);
    }
    var up = el('label', 'upload');
    var fi = el('input'); fi.type = 'file'; fi.accept = 'image/*,video/*'; fi.multiple = true; fi.dataset.act = 'upload';
    up.appendChild(fi);
    up.appendChild(document.createTextNode(uploading[t.id] ? uploading[t.id] : '+ photo or video'));
    p.appendChild(up);
    return p;
  }

  function pretty(u) {
    try { var x = new URL(u); var s = x.hostname.replace(/^www\./, '') + (x.pathname !== '/' ? x.pathname : ''); return s.length > 48 ? s.slice(0, 46) + '…' : s; } catch (e) { return u; }
  }
  function mediaEl(file, url) {
    if (/^image/.test(file.type)) {
      var a = el('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      var img = el('img'); img.src = url; img.alt = file.name || 'photo';
      a.appendChild(img); return a;
    }
    var v = el('video'); v.src = url; v.controls = true; v.playsInline = true; v.preload = 'metadata';
    return v;
  }

  // ---------- files: download (stitch chunks) ----------
  var fetching = {};
  function fetchFile(file) {
    if (fetching[file.id]) return;
    fetching[file.id] = true;
    var parts = [];
    var i = 0;
    (function next() {
      if (i >= file.parts) {
        var blob = new Blob(parts, { type: file.type });
        media[file.id] = URL.createObjectURL(blob);
        document.querySelectorAll('.m[data-file="' + file.id + '"]').forEach(function (box) {
          var l = box.querySelector('.loading'); if (l) box.replaceChild(mediaEl(file, media[file.id]), l);
        });
        return;
      }
      api('GET', '/api/task-files?id=' + encodeURIComponent(file.id) + '&part=' + i).then(function (d) {
        var bin = atob(d.data), arr = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        parts.push(arr); i++; next();
      }).catch(function () {
        fetching[file.id] = false;
        document.querySelectorAll('.m[data-file="' + file.id + '"] .loading').forEach(function (l) { l.textContent = 'couldn’t load'; });
      });
    })();
  }

  // ---------- files: upload ----------
  function shrink(file) {
    // photos get resized to 2000px / jpeg so they upload fast; gifs and videos go as-is
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return resolve(file);
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(u);
        var s = Math.min(1, 2000 / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { resolve(b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(u); resolve(file); };
      img.src = u;
    });
  }
  function b64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // update the upload label in place (a full re-render would wipe a half-typed link or restart a video)
  function progress(tid, text) {
    uploading[tid] = text;
    var up = board.querySelector('.card[data-id="' + tid + '"] .upload');
    if (up) up.lastChild.textContent = text;
  }
  function upload(t, list) {
    var files = Array.prototype.slice.call(list);
    var bad = files.filter(function (f) { return !/^(image|video)\//.test(f.type); });
    if (bad.length) say('only photos and videos can be added');
    files = files.filter(function (f) { return /^(image|video)\//.test(f.type); });
    (function one() {
      var raw = files.shift();
      if (!raw) { delete uploading[t.id]; render(); return; }
      shrink(raw).then(function (file) {
        if (file.size > MAX_FILE) { say(file.name + ' is too big (50 MB max)'); return one(); }
        var fid = id(), parts = Math.max(1, Math.ceil(file.size / CHUNK)), i = 0;
        var label = /^image/.test(file.type) ? 'photo' : 'video';
        (function next() {
          progress(t.id, 'uploading ' + label + ' ' + Math.round(i / parts * 100) + '%');
          if (i >= parts) {
            var cur = find(t.id); if (!cur) return one();
            cur.files = (cur.files || []).concat({ id: fid, type: file.type, name: file.name, size: file.size, parts: parts });
            media[fid] = URL.createObjectURL(file);
            save(); return one();
          }
          file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer().then(function (buf) {
            return api('POST', '/api/task-files?id=' + fid + '&part=' + i, { data: b64(buf) });
          }).then(function () { i++; next(); }).catch(function (e) {
            if (e.status === 401) { remember.set(''); return lock('password changed, enter it again', true); }
            say('upload failed: ' + (e.message || 'try again'));
            delete uploading[t.id]; render();
          });
        })();
      });
    })();
  }

  // ---------- add / delete / dropdown actions ----------
  $('add').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('add-title');
    var title = input.value.replace(/\s+/g, ' ').trim();
    if (!title) return;
    tasks.push({ id: id(), title: title, status: 'todo', created: new Date().toISOString() });
    input.value = '';
    render(); save();
  });

  board.addEventListener('click', function (e) {
    var c = e.target.closest('.card'); if (!c) return;
    var t = find(c.dataset.id); if (!t) return;
    var act = e.target.closest('[data-act]');
    if (e.target.closest('.x')) {
      tasks = tasks.filter(function (x) { return x.id !== t.id; });
      delete open[t.id];
      render(); save(); return;
    }
    if (act && act.dataset.act === 'rm-link') { t.links.splice(+act.dataset.i, 1); if (!t.links.length) delete t.links; render(); save(); return; }
    if (act && act.dataset.act === 'rm-file') { t.files.splice(+act.dataset.i, 1); if (!t.files.length) delete t.files; render(); save(); return; }
    if (act && act.dataset.act === 'time') { askTime(t); return; }
    if (e.target.closest('.panel')) return;          // clicks inside the dropdown don't close it
    if (justDragged) return;
    open[t.id] = !open[t.id];
    render();
    if (open[t.id]) { var inp = board.querySelector('.card[data-id="' + t.id + '"] .mini input'); if (inp && matchMedia('(hover:hover)').matches) inp.focus(); }
  });

  board.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-act="add-link"]'); if (!f) return;
    e.preventDefault();
    var t = find(f.closest('.card').dataset.id); if (!t) return;
    var u = f.url.value.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { new URL(u); } catch (err) { say('that doesn’t look like a link'); return; }
    t.links = (t.links || []).concat({ url: u });
    render(); save();
    var inp = board.querySelector('.card[data-id="' + t.id + '"] .mini input'); if (inp) inp.focus();
  });

  board.addEventListener('change', function (e) {
    if (e.target.dataset.act !== 'upload' || !e.target.files.length) return;
    var t = find(e.target.closest('.card').dataset.id);
    if (t) upload(t, e.target.files);
  });

  // ---------- "how long did it take?" ----------
  var asking = null;
  function askTime(t) {
    asking = t.id;
    $('took-title').textContent = '“' + t.title + '”';
    $('took-h').value = t.took ? Math.floor(t.took / 60) || '' : '';
    $('took-m').value = t.took ? (t.took % 60) || '' : '';
    $('took').hidden = false;
    setTimeout(function () { $('took-h').focus(); }, 30);
  }
  function closeTime() { $('took').hidden = true; asking = null; }
  $('took-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = find(asking);
    if (t) {
      var m = Math.max(0, Math.round((parseFloat($('took-h').value) || 0) * 60 + (parseFloat($('took-m').value) || 0)));
      if (m) t.took = m; else delete t.took;
      render(); save();
    }
    closeTime();
  });
  $('took-skip').addEventListener('click', closeTime);
  $('took').addEventListener('click', function (e) { if (e.target === $('took')) closeTime(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('took').hidden) closeTime(); });

  // ---------- drag (pointer events: works with mouse and touch) ----------
  var drag = null, justDragged = false;
  var slot = el('li', 'slot');

  board.addEventListener('pointerdown', function (e) {
    var c = e.target.closest('.card');
    if (!c || e.button > 0 || e.target.closest('.x, .panel, button, a, input, label')) return;
    drag = { el: c, id: c.dataset.id, x0: e.clientX, y0: e.clientY, started: false, pid: e.pointerId };
  });

  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.started) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return;
      var r = drag.el.getBoundingClientRect();
      drag.dx = drag.x0 - r.left; drag.dy = Math.min(drag.y0 - r.top, 24);
      drag.lift = drag.el.cloneNode(true);
      var pn = drag.lift.querySelector('.panel'); if (pn) pn.remove();
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
      if (e.clientY < b.top + Math.min(b.height / 2, 24)) { before = cards[i]; break; }
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
    justDragged = true; setTimeout(function () { justDragged = false; }, 0);
    d.lift.remove();
    document.body.classList.remove('dragging');
    cols.forEach(function (c) { c.classList.remove('over'); });
    if (!slot.parentNode || (e && e.type === 'pointercancel')) { if (slot.parentNode) slot.remove(); render(); return; }

    var col = slot.closest('.col');
    var next = slot.nextElementSibling;
    while (next && (!next.classList.contains('card') || next.dataset.id === d.id)) next = next.nextElementSibling;
    slot.remove();

    var t = find(d.id);
    if (!t) return render();
    var was = t.status;
    tasks = tasks.filter(function (x) { return x.id !== d.id; });
    t.status = col.dataset.status;
    var at = next ? tasks.findIndex(function (x) { return x.id === next.dataset.id; }) : -1;
    if (at < 0) {
      var last = -1;
      tasks.forEach(function (x, i) { if (x.status === t.status) last = i; });
      at = last + 1 || tasks.length;
    }
    tasks.splice(at, 0, t);
    render(); save();
    if (t.status === 'done' && was !== 'done') askTime(t);
  }
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);

  var saved = remember.get();
  if (saved) unlock(saved); else lock();
})();
