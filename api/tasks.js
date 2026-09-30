// Shared board for /tracker (same Upstash Redis as /invoice). Password-checked, see _tracker.js.
// GET /api/tasks          -> { tasks }
// PUT /api/tasks {tasks}  -> { ok: true }   (replaces the whole board; it's small)
// A task: { id, title, status, created, took?(minutes), links?:[{url}], files?:[{id,type,name,size,parts}] }
// Files themselves live in /api/task-files; any file dropped from the board here gets deleted.
const db = require('./_redis');
const tr = require('./_tracker');

const STATUSES = ['todo', 'doing', 'done'];

function cleanTask(t) {
  t = t || {};
  const out = {
    id: db.clean(t.id, 64),
    title: db.clean(t.title, 300),
    status: STATUSES.includes(t.status) ? t.status : 'todo',
    created: db.clean(t.created, 40)
  };
  const took = Math.round(Number(t.took));
  if (took > 0 && took < 100000) out.took = took;
  const links = (Array.isArray(t.links) ? t.links : [])
    .map((l) => ({ url: db.clean(l && l.url, 2000) }))
    .filter((l) => /^https?:\/\/\S+$/i.test(l.url)).slice(0, 50);
  if (links.length) out.links = links;
  const files = (Array.isArray(t.files) ? t.files : [])
    .map((f) => ({
      id: db.clean(f && f.id, 64),
      type: db.clean(f && f.type, 80),
      name: db.clean(f && f.name, 120),
      size: Math.max(0, Math.round(Number(f && f.size) || 0)),
      parts: Math.max(1, Math.min(tr.MAX_PARTS, Math.round(Number(f && f.parts) || 1)))
    }))
    .filter((f) => tr.validId(f.id) && /^(image|video)\//.test(f.type)).slice(0, 30);
  if (files.length) out.files = files;
  return out;
}

const fileIds = (tasks) => new Set([].concat(...tasks.map((t) => (t.files || []).map((f) => f.id))));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });

  try {
    if (!(await tr.authorized(req, res))) return;

    const read = async () => { try { const v = JSON.parse((await db.cmd(['GET', tr.BOARD])) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };

    if (req.method === 'GET') return res.status(200).json({ tasks: await read() });

    if (req.method === 'PUT' || req.method === 'POST') {
      const b = db.body(req);
      if (!Array.isArray(b.tasks)) return res.status(400).json({ error: 'expected a list of tasks' });
      if (b.tasks.length > 500) return res.status(400).json({ error: 'too many tasks' });
      const tasks = b.tasks.map(cleanTask).filter((t) => t.id && t.title);
      const before = fileIds(await read());
      const now = fileIds(tasks);
      const gone = [...before].filter((id) => !now.has(id));
      await db.multi([['SET', tr.BOARD, JSON.stringify(tasks)]].concat(gone.length ? [['DEL', ...gone.map(tr.fileKey)]] : []));
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
