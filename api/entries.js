// Shared hour log for /invoice, stored in Upstash Redis (connect it in Vercel → Storage).
// GET    /api/entries                 -> { entries: [...] }
// POST   /api/entries  {name,date,matter,hours,rate} -> { entry }
// DELETE /api/entries?id=..&name=..   -> { ok: true }   (only the person who logged it)
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = 'invoice:entries';

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || 'storage error');
  return d.result;
}

const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'storage not connected' });

  try {
    if (req.method === 'GET') {
      const flat = (await redis(['HGETALL', HASH])) || [];
      const entries = [];
      for (let i = 1; i < flat.length; i += 2) { try { entries.push(JSON.parse(flat[i])); } catch (e) {} }
      return res.status(200).json({ entries });
    }

    if (req.method === 'POST') {
      let b = req.body || {};
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      const name = clean(b.name, 60);
      const matter = String(b.matter == null ? '' : b.matter).trim().slice(0, 500);
      const date = String(b.date || '');
      const hours = Number(b.hours);
      const rate = Number(b.rate);
      if (!name) return res.status(400).json({ error: 'missing name' });
      if (!matter) return res.status(400).json({ error: 'missing subject matter' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
      if (!(hours >= 0.25 && hours <= 24) || Math.round(hours * 4) !== hours * 4) return res.status(400).json({ error: 'time must be in 15 minute steps' });
      if (!(rate >= 0 && rate <= 10000)) return res.status(400).json({ error: 'bad rate' });
      const entry = { id: crypto.randomUUID(), name, date, matter, hours, rate: Math.round(rate * 100) / 100, created: new Date().toISOString() };
      await redis(['HSET', HASH, entry.id, JSON.stringify(entry)]);
      return res.status(201).json({ entry });
    }

    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || '');
      const name = clean(req.query && req.query.name, 60).toLowerCase();
      const raw = id && (await redis(['HGET', HASH, id]));
      if (!raw) return res.status(404).json({ error: 'entry not found' });
      if (JSON.parse(raw).name.toLowerCase() !== name) return res.status(403).json({ error: 'you can only delete your own entries' });
      await redis(['HDEL', HASH, id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
