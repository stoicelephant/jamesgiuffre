// Expenses for /invoice.
// POST   /api/expenses {name,date,merchant,amount,category,note,receipt?:{data(base64),type,filename}} -> { expense }
// PATCH  /api/expenses {name,id,date,merchant,amount,category,note, receipt?:{..}, removeReceipt?} -> { expense }
//        (own expense, only while not submitted / after rejection; an edited rejection is ready to resend)
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

    if (req.method === 'PATCH') {
      const b = db.body(req);
      const name = db.member(b.name);
      const raw = b.id && (await db.cmd(['HGET', db.EXPENSES, String(b.id)]));
      if (!raw) return res.status(404).json({ error: 'expense not found' });
      const x = JSON.parse(raw);
      if (!name || db.canon(x.name) !== name) return res.status(403).json({ error: 'you can only edit your own expenses' });
      if (!['unsubmitted', 'rejected'].includes(x.status)) return res.status(409).json({ error: 'already sent to arya, it can\'t be edited' });
      const date = String(b.date || '');
      const merchant = db.clean(b.merchant, 80);
      const amount = db.money(b.amount);
      const category = String(b.category || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
      if (!merchant) return res.status(400).json({ error: 'add where it was from' });
      if (!(amount > 0 && amount <= 100000)) return res.status(400).json({ error: 'add an amount' });
      if (!db.CATEGORIES.includes(category)) return res.status(400).json({ error: 'pick a category' });
      const cmds = [];
      Object.assign(x, { date, merchant, amount, category, note: String(b.note == null ? '' : b.note).trim().slice(0, 300), edited: new Date().toISOString() });
      if (x.status === 'rejected') { x.status = 'unsubmitted'; }
      if (b.receipt && b.receipt.data) {
        const type = String(b.receipt.type || '');
        if (!TYPES.includes(type)) return res.status(400).json({ error: 'receipts can be a photo (jpg, png) or a pdf' });
        const data = String(b.receipt.data).replace(/^data:[^,]*,/, '');
        if (Math.floor(data.length * 3 / 4) > MAX_BYTES) return res.status(413).json({ error: 'that receipt is too big (3 MB max)' });
        if (x.receiptId) cmds.push(['HDEL', db.RECEIPTS, x.receiptId]);
        x.receiptId = crypto.randomUUID(); x.receiptType = type;
        cmds.push(['HSET', db.RECEIPTS, x.receiptId, JSON.stringify({ type, data, filename: db.clean(b.receipt.filename, 120), expenseId: x.id, name })]);
      } else if (b.removeReceipt && x.receiptId) {
        cmds.push(['HDEL', db.RECEIPTS, x.receiptId]);
        delete x.receiptId; delete x.receiptType;
      }
      cmds.push(['HSET', db.EXPENSES, x.id, JSON.stringify(x)]);
      await db.multi(cmds);
      x.name = db.canon(x.name);
      return res.status(200).json({ expense: x });
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

    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
