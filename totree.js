// "← back to tree" pill: shows up in a row at the top of a page you reached by clicking it on /tree, so you can hop back.
// It pulses slowly for ~3 seconds when you land so it's hard to miss, then sits still.
// /tree remembers which page you clicked (for this browser tab); any other page ignores this.
(function () {
  var KEY = 'tree.from';
  var norm = function (p) { return (p || '/').replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '').replace(/(.)\/$/, '$1') || '/'; };
  var target = '';
  try { target = sessionStorage.getItem(KEY) || ''; } catch (e) {}
  if (!target || norm(target) !== norm(location.pathname) || norm(location.pathname) === '/tree') return;

  var css = document.createElement('style');
  css.textContent =
    '.to-tree-bar{display:flex;justify-content:center;padding:14px 16px 0;position:relative;z-index:45}' +
    '.to-tree{display:inline-flex;align-items:center;gap:8px;' +
    'font:500 14px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;color:#fff;text-decoration:none;' +
    'background:#b4472c;border:1px solid #b4472c;border-radius:999px;padding:10px 18px 10px 14px;' +
    'box-shadow:0 6px 22px rgba(180,71,44,.35);transition:background .2s,box-shadow .2s,transform .2s}' +
    '.to-tree:hover{background:#9c3c24;box-shadow:0 8px 28px rgba(180,71,44,.45);transform:translateY(1px)}' +
    '.to-tree i{width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 8px #fff}' +
    // arrival: three slow blinks with a soft ring, ~3s total
    '.to-tree.hello{animation:toTreeBlink 1s ease-in-out 3}' +
    '@keyframes toTreeBlink{0%,100%{opacity:1;box-shadow:0 6px 22px rgba(180,71,44,.35),0 0 0 0 rgba(180,71,44,.45)}' +
    '50%{opacity:.45;box-shadow:0 6px 22px rgba(180,71,44,.2),0 0 0 10px rgba(180,71,44,0)}}' +
    '@media (prefers-reduced-motion:reduce){.to-tree.hello{animation:none}}' +
    '@media print{.to-tree-bar{display:none}}';
  document.head.appendChild(css);

  var a = document.createElement('a');
  a.className = 'to-tree hello';
  a.href = '/tree';
  a.innerHTML = '<i></i>← back to tree';
  a.setAttribute('aria-label', 'back to the site tree');
  a.addEventListener('animationend', function () { a.classList.remove('hello'); });
  a.addEventListener('click', function () { try { sessionStorage.removeItem(KEY); } catch (e) {} });
  // its own row at the very top of the page, so it never covers anything
  var bar = document.createElement('div');
  bar.className = 'to-tree-bar';
  bar.appendChild(a);
  document.body.insertBefore(bar, document.body.firstChild);
})();
