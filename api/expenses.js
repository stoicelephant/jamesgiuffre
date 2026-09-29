// Expenses for /invoice.
// POST   /api/expenses {name,date,merchant,amount,category,note,receipt?:{data(base64),type,filename}} -> { expense }
// DELETE /api/expenses?id=..&name=..  -> { ok }   (own expense, only while not submitted / after rejection)
const crypto = require('crypto');
const db = require('./_redis');

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 3 * 1024 * 1024;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });

  try {
    if (req.method === 'POST') {
      const b = db.body(req);
      const name = db.member(b.name);
      if (!name) return res.status(403).json({ error: 'name is not on the team list' });
      const date = String(b.date || '');
      const merchant = db.clean(b.merchant, 80);
      const amount = db.money(b.amount);
      const category = String(b.category || '');
      const note = String(b.note == null ? '' : b.note).trim().slice(0, 300);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
      if (!merchant) return res.status(400).json({ error: 'add where it was from' });
      if (!(amount > 0 && amount <= 100000)) return res.status(400).json({ error: 'add an amount' });
      if (!db.CATEGORIES.includes(category)) return res.status(400).json({ error: 'pick a category' });

      const expense = { id: crypto.randomUUID(), name, date, merchant, amount, category, note, status: 'unsubmitted', created: new Date().toISOString() };
      const cmds = [];
      if (b.receipt && b.receipt.data) {
        const type = String(b.receipt.type || '');
        if (!TYPES.includes(type)) return res.status(400).json({ error: 'receipts can be a photo (jpg, png) or a pdf' });
        const data = String(b.receipt.data).replace(/^data:[^,]*,/, '');
        const bytes = Math.floor(data.length * 3 / 4);
        if (bytes > MAX_BYTES) return res.status(413).json({ error: 'that receipt is too big (3 MB max)' });
        expense.receiptId = crypto.randomUUID();
        expense.receiptType = type;
        cmds.push(['HSET', db.RECEIPTS, expense.receiptId, JSON.stringify({ type, data, filename: db.clean(b.receipt.filename, 120), expenseId: expense.id, name })]);
      }
      cmds.push(['HSET', db.EXPENSES, expense.id, JSON.stringify(expense)]);
      await db.multi(cmds);
      return res.status(201).json({ expense });
    }

    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || '');
      const name = db.member(req.query && req.query.name);
      const raw = id && (await db.cmd(['HGET', db.EXPENSES, id]));
      if (!raw) return res.status(404).json({ error: 'expense not found' });
      const x = JSON.parse(raw);
      if (db.canon(x.name) !== name) return res.status(403).json({ error: 'you can only delete your own expenses' });
      if (!['unsubmitted', 'rejected'].includes(x.status)) return res.status(409).json({ error: 'already sent to arya' });
      const cmds = [['HDEL', db.EXPENSES, id]];
      if (x.receiptId) cmds.push(['HDEL', db.RECEIPTS, x.receiptId]);
      await db.multi(cmds);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
