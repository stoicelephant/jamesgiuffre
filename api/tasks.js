// Shared board for /tracker (same Upstash Redis as /invoice).
// GET /api/tasks          -> { tasks }
// PUT /api/tasks {tasks}  -> { ok: true }   (replaces the whole board; it's small)
const db = require('./_redis');

const KEY = 'tracker:tasks';
const STATUSES = ['todo', 'doing', 'done'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });

  try {
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
