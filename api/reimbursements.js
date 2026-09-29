// Reimbursement requests: bundle expenses and send them to arya.
// POST  /api/reimbursements {name, expenseIds:[..]}                  -> { request }
// PATCH /api/reimbursements {name:'arya', id, action, note}          -> { request }
//        action: 'approve' | 'reject' | 'paid'
const crypto = require('crypto');
const db = require('./_redis');

const EXPENSE_STATUS = { approve: 'approved', reject: 'rejected', paid: 'reimbursed' };
const REQUEST_STATUS = { approve: 'approved', reject: 'rejected', paid: 'paid' };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });

  try {
    if (req.method === 'POST') {
      const b = db.body(req);
      const name = db.member(b.name);
      if (!name) return res.status(403).json({ error: 'name is not on the team list' });
      const ids = Array.isArray(b.expenseIds) ? [...new Set(b.expenseIds.map(String))].slice(0, 200) : [];
      if (!ids.length) return res.status(400).json({ error: 'pick at least one expense' });
      const raws = await db.multi(ids.map((id) => ['HGET', db.EXPENSES, id]));
      const list = [];
      for (const raw of raws) {
        if (!raw) return res.status(404).json({ error: 'an expense was not found, refresh and try again' });
        const x = JSON.parse(raw);
        if (db.canon(x.name) !== name) return res.status(403).json({ error: 'you can only submit your own expenses' });
        if (!['unsubmitted', 'rejected'].includes(x.status)) return res.status(409).json({ error: 'one of those is already with arya' });
        list.push(x);
      }
      list.sort((a, b) => (a.date < b.date ? -1 : 1));
      const seq = await db.cmd(['INCR', db.RSEQ]);
      const request = {
        id: crypto.randomUUID(),
        number: 'R' + String(seq).padStart(4, '0'),
        name,
        status: 'pending',
        submitted: new Date().toISOString(),
        total: db.money(list.reduce((s, x) => s + x.amount, 0)),
        expenseIds: list.map((x) => x.id),
        lines: list.map((x) => ({ expenseId: x.id, date: x.date, merchant: x.merchant, category: x.category, amount: x.amount, note: x.note, hasReceipt: !!x.receiptId }))
      };
      const cmds = [['HSET', db.REQUESTS, request.id, JSON.stringify(request)]];
      list.forEach((x) => cmds.push(['HSET', db.EXPENSES, x.id, JSON.stringify(Object.assign({}, x, { status: 'pending', requestId: request.id, requestNumber: request.number, reviewNote: '' }))]));
      await db.multi(cmds);
      return res.status(201).json({ request });
    }

    if (req.method === 'PATCH') {
      const b = db.body(req);
      if (db.member(b.name) !== db.ADMIN) return res.status(403).json({ error: 'only arya can review reimbursements' });
      const action = String(b.action || '');
      if (!REQUEST_STATUS[action]) return res.status(400).json({ error: 'bad action' });
      const raw = await db.cmd(['HGET', db.REQUESTS, String(b.id || '')]);
      if (!raw) return res.status(404).json({ error: 'request not found' });
      const request = JSON.parse(raw);
      const allowed = { approve: ['pending'], reject: ['pending', 'approved'], paid: ['approved', 'pending'] };
      if (!allowed[action].includes(request.status)) return res.status(409).json({ error: 'this request is already ' + request.status });
      const now = new Date().toISOString();
      request.status = REQUEST_STATUS[action];
      request.note = String(b.note == null ? '' : b.note).trim().slice(0, 300);
      request[{ approve: 'approvedAt', reject: 'rejectedAt', paid: 'paidAt' }[action]] = now;
      if (action === 'paid' && !request.approvedAt) request.approvedAt = now;
      const raws = await db.multi(request.expenseIds.map((id) => ['HGET', db.EXPENSES, id]));
      const cmds = [['HSET', db.REQUESTS, request.id, JSON.stringify(request)]];
      raws.forEach((r) => {
        if (!r) return;
        const x = JSON.parse(r);
        x.status = EXPENSE_STATUS[action];
        x.reviewNote = request.note;
        if (action === 'reject') { delete x.requestId; x.rejectedFrom = request.number; }
        cmds.push(['HSET', db.EXPENSES, x.id, JSON.stringify(x)]);
      });
      await db.multi(cmds);
      request.name = db.canon(request.name);
      return res.status(200).json({ request });
    }

    res.setHeader('Allow', 'POST, PATCH');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
