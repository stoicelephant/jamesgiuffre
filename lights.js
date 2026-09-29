// videos: autoplay muted + loop; tap a video (or its label) to turn its sound on, only one at a time
(function () {
  var vids = [].slice.call(document.querySelectorAll('.vid video'));
  function setSound(v, on) {
    v.muted = !on;
    var b = v.parentNode.querySelector('.sound');
    if (b) { b.textContent = on ? 'sound on' : 'sound off'; b.setAttribute('aria-label', on ? 'turn sound off' : 'turn sound on'); b.classList.toggle('on', on); }
    if (on) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
  }
  vids.forEach(function (v) {
    function toggle() {
      var on = v.muted;
      vids.forEach(function (o) { if (o !== v) setSound(o, false); });
      setSound(v, on);
    }
    v.addEventListener('click', toggle);
    var b = v.parentNode.querySelector('.sound');
    if (b) b.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
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
