// Read a receipt and suggest expense details.
// POST /api/scan {name, receipt:{data(base64 or data URL), type}} -> { fields:{merchant,amount,date,category,note}, source:'ai' }
// Uses Claude (vision) when ANTHROPIC_API_KEY is set in Vercel. Without a key it answers 501,
// and the page falls back to reading the photo in the browser.
const db = require('./_redis');

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.SCAN_MODEL || 'claude-haiku-4-5-20251001';
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

function prompt(today) {
  return [
    'You are reading a receipt or invoice for an expense report. Reply with ONLY a JSON object, no prose, with these keys:',
    '"merchant": the business name, short and in lowercase (e.g. "sweetgreen", "uber", "marriott"),',
    '"amount": the final total actually paid, as a number (include tax and tip; not the subtotal),',
    '"date": the purchase date as "YYYY-MM-DD" (today is ' + today + '; use it only to resolve a missing year),',
    '"category": exactly one of ' + JSON.stringify(db.CATEGORIES) + ',',
    '"note": at most 8 lowercase words describing what it was, or "".',
    'Use null for anything you cannot read. Do not guess an amount you cannot see.'
  ].join('\n');
}

function clean(f) {
  const out = {};
  if (f && typeof f.merchant === 'string' && f.merchant.trim()) out.merchant = f.merchant.trim().toLowerCase().slice(0, 80);
  const amt = typeof f.amount === 'string' ? parseFloat(f.amount.replace(/[$,\s]/g, '')) : Number(f && f.amount);
  if (amt > 0 && amt < 100000) out.amount = Math.round(amt * 100) / 100;
  if (f && /^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ''))) out.date = f.date;
  if (f && db.CATEGORIES.includes(f.category)) out.category = f.category;
  if (f && typeof f.note === 'string' && f.note.trim()) out.note = f.note.trim().toLowerCase().slice(0, 120);
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });
  try { if (!(await db.gate(req, res))) return; } catch (e) { return res.status(500).json({ error: 'could not reach storage, try again' }); }
  const b = db.body(req);
  if (!db.member(b.name)) return res.status(403).json({ error: 'name is not on the team list' });
  if (!KEY) return res.status(501).json({ error: 'receipt reading is not connected' });

  const r = b.receipt || {};
  const type = String(r.type || '');
  const data = String(r.data || '').replace(/^data:[^,]*,/, '');
  if (!TYPES.includes(type) || !data) return res.status(400).json({ error: 'send a photo or pdf' });
  if (data.length * 3 / 4 > 4 * 1024 * 1024) return res.status(413).json({ error: 'that receipt is too big to read' });

  const source = { type: 'base64', media_type: type, data };
  const block = type === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
  const today = new Date().toISOString().slice(0, 10);

  try {
    const ai = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: 'user', content: [block, { type: 'text', text: prompt(today) }] }] })
    });
    const d = await ai.json();
    if (!ai.ok) return res.status(502).json({ error: 'could not read that receipt', detail: d && d.error && d.error.type });
    const text = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    let parsed = {};
    try { parsed = m ? JSON.parse(m[0]) : {}; } catch (e) { parsed = {}; }
    return res.status(200).json({ fields: clean(parsed), source: 'ai' });
  } catch (err) {
    return res.status(502).json({ error: 'could not read that receipt' });
  }
};
