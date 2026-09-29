// Submit an invoice: bundles one person's not-yet-invoiced entries for a month.
// GET  /api/invoices?name=..        -> { invoices }  (your own; arya gets everyone's)
// POST /api/invoices {name, month}  -> { invoice }   (month = "YYYY-MM")
// PATCH /api/invoices {name: 'arya', id, status: 'paid' | 'submitted'} -> { invoice }   (arya marks paid)
const crypto = require('crypto');
const db = require('./_redis');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });

  try {
    if (req.method === 'GET') {
      const who = db.member(req.query && req.query.name);
      if (!who) return res.status(403).json({ error: 'name is not on the team list' });
      const all = db.parseHash(await db.cmd(['HGETALL', db.INVOICES]));
      return res.status(200).json({ invoices: all.filter((x) => who === db.ADMIN || x.name === who) });
    }

    if (req.method === 'POST') {
      const b = db.body(req);
      const name = db.member(b.name);
      const month = String(b.month || '');
      if (!name) return res.status(403).json({ error: 'name is not on the team list' });
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'bad month' });

      const mine = db.parseHash(await db.cmd(['HGETALL', db.ENTRIES]))
        .filter((e) => e.name === name && e.date.slice(0, 7) === month && !e.invoiceId)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created < b.created ? -1 : 1));
      if (!mine.length) return res.status(400).json({ error: 'nothing new to submit for this month' });

      const seq = await db.cmd(['INCR', db.SEQ]);
      const hours = mine.reduce((s, e) => s + e.hours, 0);
      const amount = Math.round(mine.reduce((s, e) => s + e.hours * e.rate, 0) * 100) / 100;
      const invoice = {
        id: crypto.randomUUID(),
        number: String(seq).padStart(4, '0'),
        name, month, hours, amount,
        status: 'submitted',
        submitted: new Date().toISOString(),
        lines: mine.map((e) => ({ entryId: e.id, date: e.date, matter: e.matter, hours: e.hours, start: e.start || '', rate: e.rate, amount: Math.round(e.hours * e.rate * 100) / 100 }))
      };
      const cmds = [['HSET', db.INVOICES, invoice.id, JSON.stringify(invoice)]];
      mine.forEach((e) => cmds.push(['HSET', db.ENTRIES, e.id, JSON.stringify(Object.assign({}, e, { invoiceId: invoice.id, invoiceNumber: invoice.number }))]));
      await db.multi(cmds);
      return res.status(201).json({ invoice });
    }

    if (req.method === 'PATCH') {
      const b = db.body(req);
      if (db.member(b.name) !== db.ADMIN) return res.status(403).json({ error: 'only arya can update invoices' });
      const status = String(b.status || '');
      if (!['paid', 'submitted'].includes(status)) return res.status(400).json({ error: 'bad status' });
      const raw = await db.cmd(['HGET', db.INVOICES, String(b.id || '')]);
      if (!raw) return res.status(404).json({ error: 'invoice not found' });
      const inv = JSON.parse(raw);
      inv.status = status;
      if (status === 'paid') inv.paidAt = new Date().toISOString(); else delete inv.paidAt;
      await db.cmd(['HSET', db.INVOICES, inv.id, JSON.stringify(inv)]);
      inv.name = db.canon(inv.name);
      return res.status(200).json({ invoice: inv });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
