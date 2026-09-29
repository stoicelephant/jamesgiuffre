// GET /api/receipt?id=<expenseId>&name=..  -> the receipt file (owner or arya only)
const db = require('./_redis');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });
  try {
    const who = db.member(req.query && req.query.name);
    if (!who) return res.status(403).json({ error: 'name is not on the team list' });
    const raw = await db.cmd(['HGET', db.EXPENSES, String((req.query && req.query.id) || '')]);
    if (!raw) return res.status(404).json({ error: 'expense not found' });
    const x = JSON.parse(raw);
    if (who !== db.ADMIN && db.canon(x.name) !== who) return res.status(403).json({ error: 'not your receipt' });
    if (!x.receiptId) return res.status(404).json({ error: 'no receipt on this expense' });
    const r = await db.cmd(['HGET', db.RECEIPTS, x.receiptId]);
    if (!r) return res.status(404).json({ error: 'receipt not found' });
    const f = JSON.parse(r);
    res.setHeader('Content-Type', f.type);
    res.setHeader('Content-Disposition', 'inline; filename="' + (f.filename || 'receipt').replace(/[^\w.\- ]/g, '') + '"');
    res.statusCode = 200;
    return res.end(Buffer.from(f.data, 'base64'));
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
