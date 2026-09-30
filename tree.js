// /tree: draws every page on the site as a tree. Wide screens grow left -> right with curved branches;
// phones get an indented, directory-style tree. Little light pulses run from the root out to every leaf.
(function () {
  // ---- the site. add a page here and it grows a new branch. ----
  var SITE = {
    name: 'jamesgiuffre.com', path: '/', href: '/', kids: [
      { name: 'lights', path: '/lights', href: '/lights', note: 'music-reactive lights, down to the pcb', kids: [
        { name: 'see it run', href: '/lights' },
        { name: 'the build', href: '/lights' },
        { name: 'the room', href: '/lights' }
      ] },
      { name: 'invoice', path: '/invoice', href: '/invoice', note: 'fomo team hours + expenses', tag: 'team', kids: [
        { name: 'overview', path: '#overview', href: '/invoice#overview' },
        { name: 'time', path: '#time', href: '/invoice#time' },
        { name: 'expenses', path: '#expenses', href: '/invoice#expenses' },
        { name: 'approvals', path: '#approvals', href: '/invoice#approvals' },
        { name: 'team', path: '/team', href: '/team' }
      ] },
      { name: 'tracker', path: '/tracker', href: '/tracker', note: 'tasks, time, links + media', tag: 'locked', kids: [
        { name: 'not started', href: '/tracker' },
        { name: 'in progress', href: '/tracker' },
        { name: 'complete', href: '/tracker' }
      ] },
      { name: 'tree', path: '/tree', href: '/tree', note: 'this page', tag: 'you are here', here: true }
    ]
  };

  var stage = document.getElementById('stage');
  var svg = document.getElementById('wires');
  var box = document.getElementById('nodes');
  var NS = 'http://www.w3.org/2000/svg';
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // flatten + build DOM
  var all = [], edges = [];
  (function walk(n, depth, parent) {
    n.depth = depth; n.parent = parent; n.kids = n.kids || [];
    all.push(n);
    var a = document.createElement('a');
    a.className = 'node' + (depth === 0 ? ' root' : n.kids.length || depth === 1 ? '' : ' leaf');
    a.href = n.href;
    if (n.here) a.setAttribute('aria-current', 'page');
    var html = '';
    if (depth === 0) html += '<span class="led"></span>';
    var inner = '<span class="nm"></span>' + (n.path ? ' <span class="pt"></span>' : '');
    if (depth === 1 && n.note) html += '<span class="tx"><span>' + inner + '</span><span class="note"></span></span>';
    else html += '<span>' + inner + '</span>';
    if (n.tag) html += '<span class="tag' + (n.here ? ' here' : '') + '"></span>';
    a.innerHTML = html;
    a.querySelector('.nm').textContent = n.name;
    if (n.path) a.querySelector('.pt').textContent = n.path;
    if (a.querySelector('.note')) a.querySelector('.note').textContent = n.note;
    if (n.tag) a.querySelector('.tag').textContent = n.tag;
    box.appendChild(a);
    n.el = a;
    if (parent) {
      var p = document.createElementNS(NS, 'path'); p.setAttribute('class', 'wire'); svg.appendChild(p);
      var s = document.createElementNS(NS, 'circle'); s.setAttribute('class', 'spark'); s.setAttribute('r', '2.6'); svg.appendChild(s);
      edges.push({ from: parent, to: n, path: p, spark: s, len: 0 });
    }
    n.kids.forEach(function (k) { walk(k, depth + 1, n); });
  })(SITE, 0, null);

  var maxDepth = Math.max.apply(null, all.map(function (n) { return n.depth; }));

  // ---- layout ----
  function layout() {
    var W = stage.clientWidth;
    all.forEach(function (n) { n.w = n.el.offsetWidth; n.h = n.el.offsetHeight; });
    var colX = [0], maxW = [], sumW = 0;
    for (var d = 0; d <= maxDepth; d++) { maxW[d] = Math.max.apply(null, all.filter(function (n) { return n.depth === d; }).map(function (n) { return n.w; })); sumW += maxW[d]; }
    // branches stretch to use the width (long, lazy curves on big screens), but never shorter than 76px
    var GAP = Math.max(76, Math.min(240, (W * 0.92 - sumW) / maxDepth));
    for (d = 1; d <= maxDepth; d++) colX[d] = colX[d - 1] + maxW[d - 1] + GAP;
    var wide = colX[maxDepth] + maxW[maxDepth] <= W;
    var H;

    if (wide) {
      // leaves stack top to bottom; each parent sits at the middle of its children
      var y = 0;
      (function place(n) {
        n.x = colX[n.depth];
        if (!n.kids.length) { n.y = y + n.h / 2; y += n.h + 6; return; }
        n.kids.forEach(function (k, i) { if (n.depth === 0 && i) y += 16; place(k); });
        n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2;
      })(SITE);
      H = y - 6;
      edges.forEach(function (e) {
        var ax = e.from.x + e.from.w, ay = e.from.y, bx = e.to.x, by = e.to.y, k = (bx - ax) * 0.55;
        e.d = 'M' + ax + ',' + ay + ' C' + (ax + k) + ',' + ay + ' ' + (bx - k) + ',' + by + ' ' + bx + ',' + by;
      });
    } else {
      // phone: indented rows, like the `tree` command
      var IND = 26, yy = 0;
      all.forEach(function (n) {           // `all` is already in pre-order
        if (n.depth === 1 && n !== SITE.kids[0]) yy += 10;
        n.x = n.depth * IND; n.y = yy + n.h / 2; yy += n.h + 8;
      });
      H = yy - 8;
      edges.forEach(function (e) {
        var sx = e.from.x + 12, sy = e.from.y + e.from.h / 2, bx = e.to.x, by = e.to.y, r = 8;
        e.d = 'M' + sx + ',' + sy + ' V' + (by - r) + ' Q' + sx + ',' + by + ' ' + (sx + r) + ',' + by + ' H' + bx;
      });
    }

    stage.style.height = H + 'px';
    all.forEach(function (n) { n.el.style.transform = 'translate(' + Math.round(n.x) + 'px,' + Math.round(n.y - n.h / 2) + 'px)'; });
    edges.forEach(function (e) { e.path.setAttribute('d', e.d); e.len = e.path.getTotalLength(); });
  }

  // ---- grow in ----
  function grow() {
    edges.forEach(function (e) {
      var p = e.path;
      p.style.transition = 'none';
      p.style.strokeDasharray = e.len; p.style.strokeDashoffset = still ? 0 : e.len;
    });
    svg.getBoundingClientRect();
    edges.forEach(function (e) {
      var delay = (e.to.depth - 1) * 0.38 + 0.15;
      e.path.style.transition = 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1) ' + delay + 's, stroke .25s, stroke-width .25s, opacity .25s';
      e.path.style.strokeDashoffset = 0;
    });
    all.forEach(function (n) {
      setTimeout(function () { n.el.classList.add('in'); }, still ? 0 : n.depth * 380 + (n.depth ? 480 : 0));
    });
    // once drawn, let the dashes go so resizing never shows gaps
    setTimeout(function () { edges.forEach(function (e) { e.path.style.strokeDasharray = 'none'; }); }, still ? 0 : maxDepth * 380 + 1200);
  }

  // ---- light pulses: root -> every leaf, one hop per beat ----
  var HOP = 0.9, REST = 1.6, CYCLE = maxDepth * HOP + REST, t0 = null;
  function ease(p) { return p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  function frame(ts) {
    if (t0 === null) t0 = ts;
    var t = ((ts - t0) / 1000) % CYCLE;
    edges.forEach(function (e) {
      var start = (e.to.depth - 1) * HOP, p = (t - start) / HOP;
      if (p < 0 || p > 1 || !e.len) { e.spark.style.opacity = 0; return; }
      var pt = e.path.getPointAtLength(e.len * ease(p));
      e.spark.setAttribute('cx', pt.x); e.spark.setAttribute('cy', pt.y);
      e.spark.style.opacity = Math.min(1, p * 5, (1 - p) * 5);
    });
    requestAnimationFrame(frame);
  }

  // ---- hover: trace a branch back to the root (and everything under it) ----
  function trace(n) {
    var on = new Set();
    for (var a = n; a; a = a.parent) on.add(a);
    (function down(x) { on.add(x); x.kids.forEach(down); })(n);
    stage.classList.add('dim');
    all.forEach(function (x) { x.el.classList.toggle('lit', on.has(x)); });
    edges.forEach(function (e) { e.path.classList.toggle('lit', on.has(e.to) && on.has(e.from)); });
  }
  function clear() {
    stage.classList.remove('dim');
    all.forEach(function (x) { x.el.classList.remove('lit'); });
    edges.forEach(function (e) { e.path.classList.remove('lit'); });
  }
  all.forEach(function (n) {
    n.el.addEventListener('mouseenter', function () { trace(n); });
    n.el.addEventListener('focus', function () { trace(n); });
    n.el.addEventListener('mouseleave', clear);
    n.el.addEventListener('blur', clear);
  });

  // ---- `$ tree jamesgiuffre.com` ----
  var cmd = 'tree jamesgiuffre.com', typed = document.getElementById('typed');
  if (still) typed.textContent = cmd;
  else (function type(i) { typed.textContent = cmd.slice(0, i); if (i < cmd.length) setTimeout(function () { type(i + 1); }, 45 + Math.random() * 40); })(0);

  var pages = all.filter(function (n) { return n.depth <= 1; }).length;
  var secs = all.length - pages;
  document.getElementById('count').textContent = pages + ' pages, ' + secs + ' sections';

  // ---- go ----
  function start() {
    layout(); grow();
    if (!still) setTimeout(function () { requestAnimationFrame(frame); }, maxDepth * 380 + 900);
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(layout, 80); });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else window.addEventListener('load', start);
})();
