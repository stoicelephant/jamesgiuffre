// Shared bits for /tracker's endpoints (files starting with _ are not deployed as endpoints).
// Every request needs the header  x-tracker-pass: <pin>  matching TRACKER_PASSWORD in Vercel.
// (The repo is public, so the PIN lives in Vercel settings, never in this code.)
const crypto = require('crypto');
const db = require('./_redis');

const MAX_FAILS = 10;        // wrong PINs allowed per IP per hour
const WINDOW = 3600;
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const ipOf = (req) => String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();

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

module.exports = {
  authorized,
  BOARD: 'tracker:tasks',
  fileKey: (id) => 'tracker:file:' + id,
  validId: (s) => /^[A-Za-z0-9-]{8,64}$/.test(String(s || '')),
  CHUNK_CHARS: 700000,       // base64 chars per chunk (~512 KB of file), keeps each request small
  MAX_PARTS: 100             // ~50 MB per file
};
