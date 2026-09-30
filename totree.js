// "← tree" pill: shows up on a page you reached by clicking it on /tree, so you can hop back.
// /tree remembers which page you clicked (for this browser tab); any other page ignores this.
(function () {
  var KEY = 'tree.from';
  var norm = function (p) { return (p || '/').replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '').replace(/(.)\/$/, '$1') || '/'; };
  var target = '';
  try { target = sessionStorage.getItem(KEY) || ''; } catch (e) {}
  if (!target || norm(target) !== norm(location.pathname) || norm(location.pathname) === '/tree') return;

  var css = document.createElement('style');
  css.textContent =
    '.to-tree{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:45;display:inline-flex;align-items:center;gap:6px;' +
    'font:500 13px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#333;text-decoration:none;' +
    'background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid #e6e6e6;border-radius:999px;' +
    'padding:9px 16px;box-shadow:0 6px 24px rgba(0,0,0,.08);transition:border-color .2s,color .2s,transform .2s}' +
    '.to-tree:hover{border-color:#b4472c;color:#b4472c;transform:translateX(-50%) translateY(-1px)}' +
    '.to-tree i{width:6px;height:6px;border-radius:50%;background:#b4472c;box-shadow:0 0 6px #b4472c}' +
    '@media print{.to-tree{display:none}}';
  document.head.appendChild(css);

  var a = document.createElement('a');
  a.className = 'to-tree';
  a.href = '/tree';
  a.innerHTML = '<i></i>← tree';
  a.setAttribute('aria-label', 'back to the site tree');
  a.addEventListener('click', function () { try { sessionStorage.removeItem(KEY); } catch (e) {} });
  (document.body || document.documentElement).appendChild(a);
})();
