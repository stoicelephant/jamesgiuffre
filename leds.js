// dot-matrix "led panel": a music-style equalizer that runs in grey,
// and switches to full color when you hover ("lights on").
(function () {
  var canvas = document.getElementById('leds');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var COLS = 56, ROWS = 42;
  var S = 32 / COLS;                        // keeps the motion the same at any resolution
  var SPEED = 0.4;                          // < 1 slows the whole thing down (1 = the old, busier pace)
  var BPM = 124, beatLen = 60 / BPM;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var w = 0, h = 0, cell = 0, ox = 0, oy = 0, dpr = 1;
  var color = 0, colorTarget = 0;          // 0 = grey, 1 = full color
  var ripples = [];                         // {x, y, t0}
  var last = { x: -1, y: -1, t: 0 };
  var running = true, start = performance.now();
  var HUES = 48, sprites = [], spriteR = 0;  // pre-drawn glowing leds, one per hue

  // one soft, glowing led per hue: bright core, full color at the edge, halo fading out inside its own cell
  function buildSprites(rad) {
    sprites = [];
    spriteR = Math.ceil(rad * 1.3 * dpr);
    var size = spriteR * 2;
    for (var i = 0; i < HUES; i++) {
      var cv = document.createElement('canvas');
      cv.width = cv.height = size;
      var g = cv.getContext('2d');
      var c = hsl(i * 360 / HUES, 0.95, 0.52);
      var rgb = (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0);
      var core = [c[0] + (255 - c[0]) * 0.28, c[1] + (255 - c[1]) * 0.28, c[2] + (255 - c[2]) * 0.28];
      var grad = g.createRadialGradient(spriteR, spriteR, 0, spriteR, spriteR, spriteR);
      var edge = rad * dpr / spriteR;       // where the dot ends and the halo begins
      grad.addColorStop(0, 'rgb(' + (core[0] | 0) + ',' + (core[1] | 0) + ',' + (core[2] | 0) + ')');
      grad.addColorStop(edge * 0.55, 'rgb(' + rgb + ')');
      grad.addColorStop(edge, 'rgba(' + rgb + ',0.95)');
      grad.addColorStop(Math.min(1, edge + 0.08), 'rgba(' + rgb + ',0.28)');
      grad.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      sprites.push(cv);
    }
  }

  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    w = r.width; h = r.height;
    cell = Math.min(w / COLS, h / ROWS);
    ox = (w - cell * COLS) / 2; oy = (h - cell * ROWS) / 2;
    buildSprites(cell * 0.38);
    if (reduce) draw(start + 900);
  }

  // column height 0..1, shaped like a spectrum with a kick on every beat
  function level(c, t) {
    var beat = (t % beatLen) / beatLen;
    var kick = Math.exp(-beat * 3.5);                     // softer, longer beat instead of a sharp hit
    var x = c / (COLS - 1);
    var base = 0.55 - 0.3 * x;                               // more bass than treble
    var wob = 0.18 * Math.sin(t * 2.1 + c * S * 0.55)
            + 0.12 * Math.sin(t * 3.7 - c * S * 0.9)
            + 0.08 * Math.sin(t * 7.3 + c * S * 1.7);
    var k = kick * (0.22 - 0.12 * x);
    return Math.max(0.06, Math.min(1, base + wob + k));
  }

  function draw(now) {
    var real = (now - start) / 1000, t = real * SPEED;   // t drives the music, real drives the hover ripples
    color += (colorTarget - color) * 0.08;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ripples = ripples.filter(function (r) { return real - r.t0 < 1.4; });
    var rad = cell * 0.38;

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
          var rp = ripples[i], age = real - rp.t0;
          var d = Math.hypot(cx - rp.x, cy - rp.y) - age * cell * 24;
          boost += Math.max(0, 1 - Math.abs(d) / (cell * 1.3)) * (1 - age / 1.4);
        }
        var I = Math.min(1, on + boost * 0.9);

        // base dot: dark grey when lit (grey mode), plain light grey when off / in color mode
        var g = 235 - I * 190 * (1 - color);                   // #ebebeb -> #2d2d2d
        ctx.fillStyle = 'rgb(' + (g | 0) + ',' + (g | 0) + ',' + (g | 0) + ')';
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.fill();

        // color mode: the led itself lights up and glows
        var lightUp = color * I;
        if (lightUp > 0.02) {
          var hue = (c * S * 9 + r * S * 2 + t * 40) % 360;
          ctx.globalAlpha = lightUp;
          ctx.drawImage(sprites[Math.floor(hue / 360 * HUES) % HUES], cx - spriteR / dpr, cy - spriteR / dpr, spriteR * 2 / dpr, spriteR * 2 / dpr);
          ctx.globalAlpha = 1;
        }
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
    if (Math.hypot(x - last.x, y - last.y) > cell * 5 || now - last.t > 0.25) {
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
