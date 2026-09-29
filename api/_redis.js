// Tiny Upstash Redis REST client (files starting with _ are not deployed as endpoints).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

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
