// Splitstorm trace collector.
//
//   POST /trace            upload one player's part of a session log (browser, allowed origins only)
//   POST /levels           upload how each attempt at each level went in one game (same rules)
//   GET  /list?prefix=&cursor=  list stored records (prefix traces/ or levels/; needs Authorization: Bearer READ_KEY)
//   GET  /get?key=         download one stored log     (needs Authorization: Bearer READ_KEY)
//
// Uploads are write-only and never overwrite. Reading requires the secret READ_KEY, which
// lives only in the Worker's settings and on the developer's machine.

const MAX_BYTES = 3 * 1024 * 1024;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function validHalf(o) {
  return o && o.format === 'splitstorm-half' && o.v === 1
    && typeof o.role === 'string' && /^(host|guest|p[0-3])$/.test(o.role)
    && typeof o.sid === 'string' && /^[A-Z]{4}-\d{1,12}-\d{1,6}$/.test(o.sid)
    && o.meta && Number.isInteger(o.meta.set) && Number.isInteger(o.meta.level) && Number.isInteger(o.meta.seed)
    && o.log && Array.isArray(o.log.tick) && Array.isArray(o.log.in) && Array.isArray(o.log.rx);
}

const MODES = ['classic', 'onegun', 'vip', 'versus', 'tethered', 'duo', 'revive'];
function validLevels(o) {
  return o && o.format === 'splitstorm-levels' && o.v === 1
    && typeof o.id === 'string' && /^[a-z0-9]{8,32}$/.test(o.id)
    && typeof o.set === 'string' && /^[a-z]{1,20}$/.test(o.set)
    && Number.isInteger(o.version) && Number.isInteger(o.players) && o.players >= 1 && o.players <= 4
    && MODES.includes(o.mode) && typeof o.online === 'boolean'
    && Array.isArray(o.hist) && o.hist.length >= 1 && o.hist.length <= 500
    && o.hist.every((h) => Array.isArray(h) && h.length === 4 && h.every((x) => Number.isInteger(x) && x >= 0 && x < 1e7));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : {};

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (req.method === 'POST' && url.pathname === '/trace') {
      if (!allowed.includes(origin)) return json({ error: 'origin not allowed' }, 403);
      if (+(req.headers.get('Content-Length') ?? 0) > MAX_BYTES) return json({ error: 'too large' }, 413, cors);
      const text = await req.text();
      if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413, cors);
      let half;
      try { half = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, cors); }
      if (!validHalf(half)) return json({ error: 'not a splitstorm log' }, 400, cors);
      const key = `traces/${new Date().toISOString().slice(0, 10)}/${half.sid}-${half.role}.json`;
      if ((await env.TRACES.get(key)) !== null) return json({ ok: true, stored: false }, 200, cors);
      await env.TRACES.put(key, text);
      return json({ ok: true, stored: true }, 201, cors);
    }

    if (req.method === 'POST' && url.pathname === '/levels') {
      if (!allowed.includes(origin)) return json({ error: 'origin not allowed' }, 403);
      const text = await req.text();
      if (text.length > 64 * 1024) return json({ error: 'too large' }, 413, cors);
      let rec;
      try { rec = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, cors); }
      if (!validLevels(rec)) return json({ error: 'not a splitstorm level record' }, 400, cors);
      const key = `levels/${new Date().toISOString().slice(0, 10)}/${rec.id}.json`;
      if ((await env.TRACES.get(key)) !== null) return json({ ok: true, stored: false }, 200, cors);
      await env.TRACES.put(key, text);
      return json({ ok: true, stored: true }, 201, cors);
    }

    if (req.method === 'GET' && (url.pathname === '/list' || url.pathname === '/get')) {
      if (!env.READ_KEY || req.headers.get('Authorization') !== `Bearer ${env.READ_KEY}`) return json({ error: 'unauthorized' }, 401);
      if (url.pathname === '/list') {
        const prefix = url.searchParams.get('prefix') === 'levels/' ? 'levels/' : 'traces/';
        const page = await env.TRACES.list({ prefix, cursor: url.searchParams.get('cursor') ?? undefined, limit: 1000 });
        return json({ keys: page.keys.map((k) => ({ key: k.name })), cursor: page.list_complete ? null : page.cursor });
      }
      const value = await env.TRACES.get(url.searchParams.get('key') ?? '');
      if (value === null) return json({ error: 'not found' }, 404);
      return new Response(value, { headers: { 'Content-Type': 'application/json' } });
    }

    return json({ error: 'not found' }, 404);
  },
};
