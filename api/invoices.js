// Submit an invoice: bundles all of one person's not-yet-invoiced entries (optionally only one month's).
// GET  /api/invoices?name=..        -> { invoices }  (your own; arya gets everyone's)
// POST /api/invoices {name, month?} -> { invoice }   (month = "YYYY-MM" limits it to that month)
// PATCH /api/invoices {name: 'arya', id, action: 'approve' | 'reject' | 'paid', note} -> { invoice }
//   reject sends the invoice's time back to the person's unbilled list
const crypto = require('crypto');
const db = require('./_redis');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });
  try { if (!(await db.gate(req, res))) return; } catch (e) { return res.status(500).json({ error: 'could not reach storage, try again' }); }

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
      if (month && !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'bad month' });

      const mine = db.parseHash(await db.cmd(['HGETALL', db.ENTRIES]))
        .filter((e) => e.name === name && (!month || e.date.slice(0, 7) === month) && !e.invoiceId)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.created < b.created ? -1 : 1));
      if (!mine.length) return res.status(400).json({ error: 'nothing new to invoice' });

      const seq = await db.cmd(['INCR', db.SEQ]);
      const hours = mine.reduce((s, e) => s + e.hours, 0);
      const amount = Math.round(mine.reduce((s, e) => s + e.hours * e.rate, 0) * 100) / 100;
      const invoice = {
        id: crypto.randomUUID(),
        number: String(seq).padStart(4, '0'),
        name, hours, amount,
        month: mine[mine.length - 1].date.slice(0, 7),
        from: mine[0].date, to: mine[mine.length - 1].date,
        status: 'pending',
        submitted: new Date().toISOString(),
        lines: mine.map((e) => ({ entryId: e.id, date: e.date, matter: e.matter, hours: e.hours, start: e.start || '', rate: e.rate, amount: Math.round(e.hours * e.rate * 100) / 100 }))
      };
      const cmds = [['HSET', db.INVOICES, invoice.id, JSON.stringify(invoice)]];
      mine.forEach((e) => { const n = Object.assign({}, e, { invoiceId: invoice.id, invoiceNumber: invoice.number }); delete n.rejectedFrom; delete n.reviewNote; cmds.push(['HSET', db.ENTRIES, e.id, JSON.stringify(n)]); });
      await db.multi(cmds);
      return res.status(201).json({ invoice });
    }

    if (req.method === 'PATCH') {
      const b = db.body(req);
      if (db.member(b.name) !== db.ADMIN) return res.status(403).json({ error: 'only arya can review invoices' });
      // older clients sent {status:'paid'}
      const action = String(b.action || (b.status === 'paid' ? 'paid' : ''));
      if (!['approve', 'reject', 'paid'].includes(action)) return res.status(400).json({ error: 'bad action' });
      const raw = await db.cmd(['HGET', db.INVOICES, String(b.id || '')]);
      if (!raw) return res.status(404).json({ error: 'invoice not found' });
      const inv = JSON.parse(raw);
      const cur = inv.status === 'submitted' ? 'pending' : inv.status;   // invoices sent before approvals existed
      const allowed = { approve: ['pending'], reject: ['pending', 'approved'], paid: ['pending', 'approved'] };
      if (!allowed[action].includes(cur)) return res.status(409).json({ error: 'this invoice is already ' + cur });
      const now = new Date().toISOString();
      inv.status = { approve: 'approved', reject: 'rejected', paid: 'paid' }[action];
      inv.note = String(b.note == null ? (inv.note || '') : b.note).trim().slice(0, 300);
      inv[{ approve: 'approvedAt', reject: 'rejectedAt', paid: 'paidAt' }[action]] = now;
      if (action === 'paid' && !inv.approvedAt) inv.approvedAt = now;
      const cmds = [['HSET', db.INVOICES, inv.id, JSON.stringify(inv)]];
      if (action === 'reject') {
        // the time goes back to the person's unbilled list so they can fix it and invoice again
        const ids = (inv.lines || []).map((l) => l.entryId).filter(Boolean);
        const raws = ids.length ? await db.multi(ids.map((id) => ['HGET', db.ENTRIES, id])) : [];
        raws.forEach((r) => {
          if (!r) return;
          const e = JSON.parse(r);
          if (e.invoiceId !== inv.id) return;
          delete e.invoiceId; delete e.invoiceNumber;
          e.rejectedFrom = inv.number; e.reviewNote = inv.note;
          cmds.push(['HSET', db.ENTRIES, e.id, JSON.stringify(e)]);
        });
      }
      await db.multi(cmds);
      inv.name = db.canon(inv.name);
      return res.status(200).json({ invoice: inv });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
