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

// The only names allowed on /invoice (keep in sync with TEAM in app.js).
const TEAM = ['demo', 'arya', 'james', 'hammad', 'milo', 'ballah', 'golam'];
// arya can see everyone's hours, pay, and invoices; everyone else only sees their own.
const ADMIN = 'arya';
// entries saved before the switch to first names ("Arya Toufanian", "Hammaad Sattar"...) map to the new names
const ALIASES = { hammaad: 'hammad' };
const canon = (n) => {
  const s = String(n || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (TEAM.includes(s)) return s;
  const first = s.split(' ')[0];
  return TEAM.includes(first) ? first : ALIASES[first] || s;
};
const member = (n) => TEAM.find((t) => t.toLowerCase() === String(n || '').replace(/\s+/g, ' ').trim().toLowerCase()) || null;

// Shared team password for /invoice. It lives in Vercel (INVOICE_PASSWORD), never in this public repo.
// Until INVOICE_PASSWORD is added, the tracker's TRACKER_PASSWORD is used so nothing breaks.
// Clients send it as the header  x-team-pass. Wrong guesses are capped per IP per hour.
const crypto = require('crypto');
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const ipOf = (req) => String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
async function gate(req, res) {
  const pass = process.env.INVOICE_PASSWORD || process.env.TRACKER_PASSWORD;
  if (!pass) { res.status(503).json({ error: 'password not set up yet' }); return false; }
  const failKey = 'invoice:fails:' + ipOf(req);
  const fails = Number(await module.exports.cmd(['GET', failKey])) || 0;
  if (fails >= 10) { res.status(429).json({ error: 'too many wrong tries, wait an hour' }); return false; }
  const given = String(req.headers['x-team-pass'] || '');
  if (given && crypto.timingSafeEqual(sha(given), sha(pass))) return true;
  if (given) await module.exports.multi([['INCR', failKey], ['EXPIRE', failKey, '3600']]);
  res.status(401).json({ error: given ? 'wrong password' : 'password required' });
  return false;
}

module.exports = {
  TEAM, ADMIN, member, canon, gate,
  ready: () => !!(URL_ && TOKEN),
  seen,
  cmd: async (c) => (await call('', c)).result,
  // several commands in one request, all-or-nothing
  multi: async (cmds) => (await call('/multi-exec', cmds)).map((x) => { if (x.error) throw new Error(x.error); return x.result; }),
  ENTRIES: 'invoice:entries',
  INVOICES: 'invoice:invoices',
  SEQ: 'invoice:seq',
  EXPENSES: 'invoice:expenses',
  RECEIPTS: 'invoice:receipts',
  REQUESTS: 'invoice:reimbursements',
  RSEQ: 'invoice:rseq',
  CATEGORIES: ['food', 'transport', 'lodging', 'software', 'equipment', 'events', 'other'],
  money: (n) => Math.round(Number(n) * 100) / 100,
  parseHash: (flat) => { const out = []; for (let i = 1; i < (flat || []).length; i += 2) { try { const x = JSON.parse(flat[i]); if (x && x.name) x.name = canon(x.name); out.push(x); } catch (e) {} } return out; },
  clean: (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n),
  body: (req) => { let b = req.body || {}; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } } return b; }
};
