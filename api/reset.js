// TEMPORARY one-time wipe of all /invoice data (removed right after use).
const crypto = require('crypto');
const db = require('./_redis');
const HASH = 'cf555a048c38855c1b9a6d2917397d882b8d1efbfd24b0c78d54c73aed29d805';
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const b = db.body(req);
  if (req.method !== 'POST' || crypto.createHash('sha256').update(String(b.code || '')).digest('hex') !== HASH) return res.status(404).json({ error: 'not found' });
  const hashes = [db.ENTRIES, db.INVOICES, db.EXPENSES, db.RECEIPTS, db.REQUESTS];
  const before = {};
  for (const k of hashes) before[k] = await db.cmd(['HLEN', k]);
  await db.cmd(['DEL', ...hashes, db.SEQ, db.RSEQ]);
  const after = {};
  for (const k of hashes) after[k] = await db.cmd(['HLEN', k]);
  return res.status(200).json({ before, after });
};
