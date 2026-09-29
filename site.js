document.querySelectorAll('.yr').forEach(function (e) { e.textContent = new Date().getFullYear(); });
document.addEventListener('click', function (e) {
  document.querySelectorAll('details.dd[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
});
document.querySelectorAll('img[data-alt]').forEach(function (img) {
  img.addEventListener('error', function () {
    if (img.dataset.alt && img.src !== img.dataset.alt) { img.src = img.dataset.alt; img.removeAttribute('data-alt'); }
  });
});
document.querySelectorAll('a.mail').forEach(function (a) {
  a.href = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + a.dataset.u + '@' + a.dataset.d;
  a.target = '_blank';
  a.rel = 'noopener';
});
