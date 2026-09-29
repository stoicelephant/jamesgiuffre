// videos: demo 1 autoplays muted (tap for sound); the others wait for a tap and play with sound.
// only one video makes sound at a time.
(function () {
  var vids = [].slice.call(document.querySelectorAll('.vid video'));
  function label(v) {
    var b = v.parentNode.querySelector('.sound'); if (!b) return;
    var manual = !v.hasAttribute('autoplay');
    var txt, aria;
    if (manual && v.paused) { txt = '▶ play'; aria = 'play video'; }
    else if (manual) { txt = '❚❚ pause'; aria = 'pause video'; }
    else { txt = v.muted ? 'sound off' : 'sound on'; aria = v.muted ? 'turn sound on' : 'turn sound off'; }
    b.textContent = txt; b.setAttribute('aria-label', aria);
    b.classList.toggle('on', !v.muted && !v.paused);
  }
  function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  function quietOthers(v) {
    vids.forEach(function (o) {
      if (o === v) return;
      if (o.hasAttribute('autoplay')) o.muted = true; else o.pause();
      label(o);
    });
  }
  vids.forEach(function (v) {
    function toggle() {
      if (v.hasAttribute('autoplay')) {
        if (v.muted) quietOthers(v);
        v.muted = !v.muted; play(v);
      } else {
        if (v.paused) { quietOthers(v); v.muted = false; play(v); } else v.pause();
      }
      label(v);
    }
    v.addEventListener('click', toggle);
    v.addEventListener('play', function () { label(v); });
    v.addEventListener('pause', function () { label(v); });
    var b = v.parentNode.querySelector('.sound');
    if (b) b.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    label(v);
  });
})();

// photo viewer, so clicks stay on the site
(function () {
  var links = [].slice.call(document.querySelectorAll('a.ph'));
  var box = document.querySelector('.lightbox');
  if (!links.length || !box) return;
  var img = box.querySelector('img'), cap = box.querySelector('figcaption'), i = 0;
  function show(n) {
    i = (n + links.length) % links.length;
    var a = links[i], t = a.querySelector('img'), fc = a.parentNode.querySelector('figcaption');
    img.src = a.href; img.alt = t ? t.alt : '';
    cap.textContent = fc ? fc.textContent : '';
  }
  function open(n) { show(n); box.hidden = false; document.body.style.overflow = 'hidden'; requestAnimationFrame(function () { box.classList.add('open'); }); }
  function close() { box.classList.remove('open'); document.body.style.overflow = ''; setTimeout(function () { box.hidden = true; }, 200); }
  links.forEach(function (a, n) { a.addEventListener('click', function (e) { e.preventDefault(); open(n); }); });
  box.querySelector('.lb-close').addEventListener('click', close);
  box.querySelector('.lb-prev').addEventListener('click', function (e) { e.stopPropagation(); show(i - 1); });
  box.querySelector('.lb-next').addEventListener('click', function (e) { e.stopPropagation(); show(i + 1); });
  box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'FIGURE') close(); });
  document.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
  });
  var x0 = null;
  box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
  });
})();
