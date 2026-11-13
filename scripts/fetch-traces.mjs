// Download session logs and level stats from the trace collector.
//  - session logs are paired into replayable traces in traces/
//  - level stats (how each attempt at each level went) go to stats/levels/
//
//   npm run fetch-traces
//
// Needs TRACE_URL and TRACE_READ_KEY, from the environment or from .env.local, e.g.
//   TRACE_URL=https://splitstorm-traces.<you>.workers.dev
//   TRACE_READ_KEY=<the READ_KEY secret you gave the Worker>
// Each player uploads their own part; a session is replayable once every player's part is here.
import fs from 'node:fs';
import path from 'node:path';

const env = { ...process.env };
for (const file of ['.env', '.env.local']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2];
  }
}
const base = (env.TRACE_URL || env.VITE_TRACE_URL || '').replace(/\/$/, '');
const key = env.TRACE_READ_KEY;
if (!base || !key) { console.error('Set TRACE_URL and TRACE_READ_KEY (in .env.local).'); process.exit(1); }

const auth = { Authorization: `Bearer ${key}` };
const halvesDir = path.join('traces', '.halves');
fs.mkdirSync(halvesDir, { recursive: true });

/** Mirror every record under `prefix` into `dir` (skipping ones already here). */
async function mirror(prefix, dir) {
  fs.mkdirSync(dir, { recursive: true });
  let cursor = null, fetched = 0, total = 0;
  do {
    const res = await fetch(`${base}/list?prefix=${prefix}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: auth });
    if (!res.ok) { console.error(`list failed: ${res.status} ${await res.text()}`); process.exit(1); }
    const page = await res.json();
    for (const { key: k } of page.keys) {
      total++;
      const local = path.join(dir, k.slice(prefix.length).replace(/\//g, '_'));
      if (fs.existsSync(local)) continue;
      const r = await fetch(`${base}/get?key=${encodeURIComponent(k)}`, { headers: auth });
      if (!r.ok) { console.error(`get ${k} failed: ${r.status}`); continue; }
      fs.writeFileSync(local, await r.text());
      fetched++;
    }
    cursor = page.cursor;
  } while (cursor);
  return { fetched, total };
}

const { fetched, total } = await mirror('traces/', halvesDir);
const lv = await mirror('levels/', path.join('stats', 'levels'));

// pair halves by session id
const sessions = new Map();
for (const f of fs.readdirSync(halvesDir)) {
  let half;
  try { half = JSON.parse(fs.readFileSync(path.join(halvesDir, f), 'utf8')); } catch { continue; }
  if (half.format !== 'splitstorm-half') continue;
  const s = sessions.get(half.sid) ?? { meta: half.meta, peers: Array.from({ length: half.meta.players ?? 2 }, () => null) };
  const who = half.role === 'host' ? 0 : half.role === 'guest' ? 1 : +half.role.slice(1);
  if (who < s.peers.length) s.peers[who] = half.log;
  sessions.set(half.sid, s);
}
let complete = 0, written = 0;
for (const [sid, s] of sessions) {
  if (s.peers.some((p) => !p)) continue;
  complete++;
  const out = path.join('traces', `${s.meta.date.slice(0, 10)}_${sid}.json`);
  if (fs.existsSync(out)) continue;
  fs.writeFileSync(out, JSON.stringify({ format: 'splitstorm-trace', v: 1, sessions: [s] }));
  written++;
}
console.log(`${total} player logs on the server, ${fetched} newly downloaded. ${complete} complete sessions (${written} new) in traces/. ${sessions.size - complete} still missing a player's log.`);
console.log(`${lv.total} level-stat records on the server, ${lv.fetched} newly downloaded to stats/levels/.`);
