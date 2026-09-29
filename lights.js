// lights off: fade the page to black a beat after it opens
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(function () { document.body.classList.add('dark'); }, reduce ? 0 : 350);
})();

// on-page photo viewer, so clicks stay on the site
(function () {
  var links = [].slice.call(document.querySelectorAll('a.ph'));
  var box = document.querySelector('.lightbox');
  if (!links.length || !box) return;
  var img = box.querySelector('img'), cap = box.querySelector('figcaption'), i = 0;

  function show(n) {
    i = (n + links.length) % links.length;
    var a = links[i], thumb = a.querySelector('img');
    img.onerror = function () { if (img.src !== a.dataset.full) img.src = a.dataset.full; };
    img.src = thumb ? thumb.currentSrc || thumb.src : a.href;   // instant, then swap to full size
    var full = new Image();
    full.onload = function () { if (links[i] === a) img.src = full.src; };
    full.src = a.href;
    img.alt = thumb ? thumb.alt : '';
    var fc = a.parentNode.querySelector('figcaption');
    cap.textContent = fc ? fc.textContent : '';
  }
  function open(n) { show(n); box.hidden = false; document.body.style.overflow = 'hidden'; requestAnimationFrame(function () { box.classList.add('open'); }); }
  function close() { box.classList.remove('open'); document.body.style.overflow = ''; setTimeout(function () { box.hidden = true; }, 200); }

  links.forEach(function (a, n) {
    a.addEventListener('click', function (e) { e.preventDefault(); open(n); });
  });
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
