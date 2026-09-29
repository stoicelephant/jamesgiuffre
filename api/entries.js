// Shared data for /invoice (Upstash Redis via Vercel Storage).
// GET    /api/entries?name=..          -> { entries, invoices, expenses, requests, admin }  (your own; arya gets everyone's)
// POST   /api/entries  {name,date,matter,hours,rate,start} -> { entry }
// DELETE /api/entries?id=..&name=..    -> { ok: true }  (own entries only, not once invoiced)
const crypto = require('crypto');
const db = require('./_redis');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });

  try {
    if (req.method === 'GET') {
      const who = db.member(req.query && req.query.name);
      if (!who) return res.status(403).json({ error: 'name is not on the team list' });
      const [e, i, x, r] = await Promise.all([db.ENTRIES, db.INVOICES, db.EXPENSES, db.REQUESTS].map((k) => db.cmd(['HGETALL', k])));
      const mine = (o) => who === db.ADMIN || o.name === who;
      return res.status(200).json({
        entries: db.parseHash(e).filter(mine),
        invoices: db.parseHash(i).filter(mine),
        expenses: db.parseHash(x).filter(mine),
        requests: db.parseHash(r).filter(mine),
        admin: who === db.ADMIN
      });
    }

    if (req.method === 'POST') {
      const b = db.body(req);
      const name = db.member(b.name);
      const matter = String(b.matter == null ? '' : b.matter).trim().slice(0, 500);
      const date = String(b.date || '');
      const hours = Number(b.hours);
      const rate = Number(b.rate);
      if (!name) return res.status(403).json({ error: 'name is not on the team list' });
      if (!matter) return res.status(400).json({ error: 'missing subject matter' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
      if (!(hours >= 0.25 && hours <= 24) || Math.round(hours * 4) !== hours * 4) return res.status(400).json({ error: 'time must be in 15 minute steps' });
      if (!(rate >= 0 && rate <= 10000)) return res.status(400).json({ error: 'bad rate' });
      const start = String(b.start || '');
      if (start && !(/^([01]\d|2[0-3]):(00|15|30|45)$/.test(start))) return res.status(400).json({ error: 'start time must be on a 15 minute mark' });
      const entry = { id: crypto.randomUUID(), name, date, matter, hours, start, rate: db.money(rate), created: new Date().toISOString() };
      await db.cmd(['HSET', db.ENTRIES, entry.id, JSON.stringify(entry)]);
      return res.status(201).json({ entry });
    }

    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || '');
      const name = db.member(req.query && req.query.name);
      const raw = id && (await db.cmd(['HGET', db.ENTRIES, id]));
      if (!raw) return res.status(404).json({ error: 'entry not found' });
      const e = JSON.parse(raw);
      if (db.canon(e.name) !== name) return res.status(403).json({ error: 'you can only delete your own entries' });
      if (e.invoiceId) return res.status(409).json({ error: 'already on a submitted invoice' });
      await db.cmd(['HDEL', db.ENTRIES, id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
