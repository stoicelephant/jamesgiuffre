// Photos and videos attached to /tracker tasks, stored in Redis in ~512 KB base64 chunks
// (keeps every request and response well under Vercel's and Upstash's size limits).
// POST /api/task-files?id=<fileId>&part=<n>  {data}  -> { ok: true }   upload one chunk
// GET  /api/task-files?id=<fileId>&part=<n>          -> { data }       read one chunk
// Password-checked like /api/tasks. The page stitches chunks back into the file.
const db = require('./_redis');
const tr = require('./_tracker');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!db.ready()) return res.status(503).json({ error: 'storage not connected' });

  try {
    if (!(await tr.authorized(req, res))) return;
    const q = req.query || {};
    const id = String(q.id || '');
    const part = Number(q.part);
    if (!tr.validId(id)) return res.status(400).json({ error: 'bad file id' });
    if (!(Number.isInteger(part) && part >= 0 && part < tr.MAX_PARTS)) return res.status(400).json({ error: 'bad part' });

    if (req.method === 'GET') {
      const data = await db.cmd(['HGET', tr.fileKey(id), String(part)]);
      if (data == null) return res.status(404).json({ error: 'file not found' });
      return res.status(200).json({ data });
    }

    if (req.method === 'POST') {
      const data = String(db.body(req).data || '');
      if (!data || data.length > tr.CHUNK_CHARS || !/^[A-Za-z0-9+/=]+$/.test(data)) return res.status(400).json({ error: 'bad chunk' });
      await db.cmd(['HSET', tr.fileKey(id), String(part), data]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'could not reach storage, try again' });
  }
};
