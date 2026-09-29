// dot-matrix "led panel": a music-style equalizer that runs in grey,
// and switches to full color when you hover ("lights on").
(function () {
  var canvas = document.getElementById('leds');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var COLS = 32, ROWS = 24;
  var BPM = 124, beatLen = 60 / BPM;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var w = 0, h = 0, cell = 0, ox = 0, oy = 0, dpr = 1;
  var color = 0, colorTarget = 0;          // 0 = grey, 1 = full color
  var ripples = [];                         // {x, y, t0}
  var last = { x: -1, y: -1, t: 0 };
  var running = true, start = performance.now();

  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    w = r.width; h = r.height;
    cell = Math.min(w / COLS, h / ROWS);
    ox = (w - cell * COLS) / 2; oy = (h - cell * ROWS) / 2;
    if (reduce) draw(start + 900);
  }

  // column height 0..1, shaped like a spectrum with a kick on every beat
  function level(c, t) {
    var beat = (t % beatLen) / beatLen;
    var kick = Math.exp(-beat * 6);
    var x = c / (COLS - 1);
    var base = 0.55 - 0.3 * x;                               // more bass than treble
    var wob = 0.18 * Math.sin(t * 2.1 + c * 0.55)
            + 0.12 * Math.sin(t * 3.7 - c * 0.9)
            + 0.08 * Math.sin(t * 7.3 + c * 1.7);
    var k = kick * (0.35 - 0.2 * x);
    return Math.max(0.06, Math.min(1, base + wob + k));
  }

  function draw(now) {
    var t = (now - start) / 1000;
    color += (colorTarget - color) * 0.08;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ripples = ripples.filter(function (r) { return t - r.t0 < 1.4; });
    var rad = cell * 0.36;

    for (var c = 0; c < COLS; c++) {
      var lv = level(c, t) * ROWS;
      for (var r = 0; r < ROWS; r++) {
        var fromBottom = ROWS - 1 - r;
        var on = fromBottom < lv ? 1 : 0;
        if (on && fromBottom > lv - 1) on = lv - fromBottom; // soft top edge
        var cx = ox + c * cell + cell / 2, cy = oy + r * cell + cell / 2;

        // ripples add light
        var boost = 0;
        for (var i = 0; i < ripples.length; i++) {
          var rp = ripples[i], age = t - rp.t0;
          var d = Math.hypot(cx - rp.x, cy - rp.y) - age * cell * 14;
          boost += Math.max(0, 1 - Math.abs(d) / (cell * 1.4)) * (1 - age / 1.4);
        }
        var I = Math.min(1, on + boost * 0.9);

        // grey version
        var g = Math.round(235 - I * 190);                     // #ebebeb -> #2d2d2d
        var grey = [g, g, g];
        // color version
        var hue = (c * 9 + r * 2 + t * 40) % 360;
        var col = hsl(hue, 0.9, 0.55);
        var off = [238, 238, 238];
        var lit = [
          off[0] + (col[0] - off[0]) * I,
          off[1] + (col[1] - off[1]) * I,
          off[2] + (col[2] - off[2]) * I
        ];
        var R = grey[0] + (lit[0] - grey[0]) * color;
        var G = grey[1] + (lit[1] - grey[1]) * color;
        var B = grey[2] + (lit[2] - grey[2]) * color;

        if (color > 0.05 && I > 0.3) {                          // glow
          ctx.fillStyle = 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',' + (0.18 * I * color) + ')';
          ctx.beginPath(); ctx.arc(cx, cy, rad * 2, 0, 6.2832); ctx.fill();
        }
        ctx.fillStyle = 'rgb(' + (R | 0) + ',' + (G | 0) + ',' + (B | 0) + ')';
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.fill();
      }
    }
  }

  function hsl(hh, s, l) {
    hh /= 360;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
  }

  function loop(now) {
    if (running) draw(now);
    requestAnimationFrame(loop);
  }

  canvas.addEventListener('pointerenter', function () { colorTarget = 1; });
  canvas.addEventListener('pointerleave', function () { colorTarget = 0; });
  canvas.addEventListener('pointermove', function (e) {
    var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    var now = (performance.now() - start) / 1000;
    if (Math.hypot(x - last.x, y - last.y) > cell * 3 || now - last.t > 0.25) {
      ripples.push({ x: x, y: y, t0: now });
      if (ripples.length > 8) ripples.shift();
      last = { x: x, y: y, t: now };
    }
  });
  // phones can't hover, so the lights just stay on
  if (window.matchMedia && window.matchMedia('(hover: none)').matches) colorTarget = 1;

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { running = es[0].isIntersecting; }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () { running = !document.hidden; });

  window.addEventListener('resize', resize);
  resize();
  if (!reduce) requestAnimationFrame(loop);
})();
