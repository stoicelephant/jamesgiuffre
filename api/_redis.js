// Tiny Upstash Redis REST client (files starting with _ are not deployed as endpoints).
// Vercel may add a custom prefix to these names (e.g. STORAGE_KV_REST_API_URL), so match on the ending.
function pick(ends, avoid) {
  const keys = Object.keys(process.env).filter((k) => ends.some((e) => k.endsWith(e)) && !(avoid && k.includes(avoid)) && process.env[k]);
  keys.sort((a, b) => a.length - b.length);            // prefer the plain name when several exist
  return keys.length ? process.env[keys[0]] : undefined;
}
const URL_ = pick(['KV_REST_API_URL', 'REDIS_REST_URL']);
const TOKEN = pick(['KV_REST_API_TOKEN', 'REDIS_REST_TOKEN'], 'READ_ONLY');
// names only (never values), to help debug a missing connection
const seen = () => Object.keys(process.env).filter((k) => /KV_|REDIS|UPSTASH/.test(k)).sort();

async function call(path, body) {
  const r = await fetch(URL_ + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok || (d && d.error)) throw new Error((d && d.error) || 'storage error');
  return d;
}

// The only names allowed on /invoice (keep in sync with TEAM in invoice.js).
const TEAM = ['Arya Toufanian', 'Hammaad Sattar', 'Milo', 'Ballah', 'Golam Khan'];
const member = (n) => TEAM.find((t) => t.toLowerCase() === String(n || '').replace(/\s+/g, ' ').trim().toLowerCase()) || null;

module.exports = {
  TEAM, member,
  ready: () => !!(URL_ && TOKEN),
  seen,
  cmd: async (c) => (await call('', c)).result,
  // several commands in one request, all-or-nothing
  multi: async (cmds) => (await call('/multi-exec', cmds)).map((x) => { if (x.error) throw new Error(x.error); return x.result; }),
  ENTRIES: 'invoice:entries',
  INVOICES: 'invoice:invoices',
  SEQ: 'invoice:seq',
  parseHash: (flat) => { const out = []; for (let i = 1; i < (flat || []).length; i += 2) { try { out.push(JSON.parse(flat[i])); } catch (e) {} } return out; },
  clean: (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n),
  body: (req) => { let b = req.body || {}; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } } return b; }
};
