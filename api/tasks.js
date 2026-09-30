// Shared board for /tracker (same Upstash Redis as /invoice).
// Every request needs the header  x-tracker-pass: <pin>  matching the TRACKER_PASSWORD env var in Vercel.
// (The repo is public, so the PIN lives in Vercel settings, never in this code.)
// GET /api/tasks          -> { tasks }
// PUT /api/tasks {tasks}  -> { ok: true }   (replaces the whole board; it's small)
const crypto = require('crypto');
const db = require('./_redis');

const KEY = 'tracker:tasks';
const STATUSES = ['todo', 'doing', 'done'];
const MAX_FAILS = 10;        // wrong PINs allowed per IP per hour
const WINDOW = 3600;

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

async function authorized(req, res) {
  const pass = process.env.TRACKER_PASSWORD;
  if (!pass) { res.status(503).json({ error: 'password not set up yet' }); return false; }
  const failKey = 'tracker:fails:' + ipOf(req);
  const fails = Number(await db.cmd(['GET', failKey])) || 0;
  if (fails >= MAX_FAILS) { res.status(429).json({ error: 'too many wrong tries, wait an hour' }); return false; }
  const given = String(req.headers['x-tracker-pass'] || '');
  if (given && crypto.timingSafeEqual(hash(given), hash(pass))) return true;
  if (given) await db.multi([['INCR', failKey], ['EXPIRE', failKey, String(WINDOW)]]);
  res.status(401).json({ error: given ? 'wrong password' : 'password required' });
  return false;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });

  try {
    if (!(await authorized(req, res))) return;

    if (req.method === 'GET') {
      const raw = await db.cmd(['GET', KEY]);
      let tasks = [];
      try { tasks = JSON.parse(raw || '[]'); } catch (e) {}
      return res.status(200).json({ tasks: Array.isArray(tasks) ? tasks : [] });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const b = db.body(req);
      if (!Array.isArray(b.tasks)) return res.status(400).json({ error: 'expected a list of tasks' });
      if (b.tasks.length > 500) return res.status(400).json({ error: 'too many tasks' });
      const tasks = b.tasks.map((t) => ({
        id: db.clean(t && t.id, 64),
        title: db.clean(t && t.title, 300),
        status: STATUSES.includes(t && t.status) ? t.status : 'todo',
        created: db.clean(t && t.created, 40)
      })).filter((t) => t.id && t.title);
      await db.cmd(['SET', KEY, JSON.stringify(tasks)]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
