// Backtest the current netcode against recorded sessions.
//
//   npm run replay            (reads every .json in traces/)
//   npm run replay -- some/dir
//
// A trace holds, for each player: when their display frames happened, what they were
// holding, and when each packet from the other player arrived. From the two halves we
// rebuild the real link (delay of every packet, which ones were lost) and each player's
// real input timeline, then run today's RollbackSession over it. Because the trace records
// the *conditions* rather than what the old netcode did with them, it stays useful after
// the netcode changes. The stats recorded during the live game are printed alongside, so
// you can see both "what happened then" and "what would happen now".
import { SETS } from '../src/levels';
import { tuning } from '../src/rollback';
import type { NetStats, PeerLog } from '../src/rollback';
import { badness, describe, simulate } from './netsim';
import type { PeerScript } from './netsim';

declare function require(name: string): any;
declare const process: { argv: string[]; exit(code: number): never };
const fs = require('fs'), path = require('path');

interface TraceSession {
  meta: { version: number; gid: number; set: number; level: number; seed: number; date: string };
  peers: (PeerLog | null)[];
}

interface Decoded { ticks: number[]; inputs: number[]; rx: { t: number; n: number }[][] }

/** Unpack one player's log. `rx[q]` lists the packets received from player q. */
function decode(log: PeerLog, players: number): Decoded {
  const ticks: number[] = [];
  let t = 0;
  for (const d of log.tick) { t += d; ticks.push(t / 10); }
  const inputs = new Array<number>(ticks.length).fill(0);
  for (let i = 0; i < log.in.length; i += 2) {
    const end = i + 2 < log.in.length ? log.in[i + 2] : ticks.length;
    for (let k = log.in[i]; k < end; k++) inputs[k] = log.in[i + 1];
  }
  // old two-player logs hold one flat list: everything came from the other player
  const lists: number[][] = Array.from({ length: players }, () => []);
  if (typeof log.rx[0] === 'number' || log.rx.length === 0) lists[1 - log.me] = log.rx as number[];
  else (log.rx as number[][]).forEach((l, q) => { lists[q] = l; });
  const rx = lists.map((l) => {
    const out: { t: number; n: number }[] = [];
    let tt = 0;
    for (let i = 0; i < l.length; i += 2) { tt += l[i]; out.push({ t: tt / 10, n: l[i + 1] }); }
    return out;
  });
  return { ticks, inputs, rx };
}

/** Index of the last element <= t (or 0). */
function lastAtOrBefore(arr: number[], t: number): number {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const pctl = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

let quiet = false;
const say = (s: string) => { if (!quiet) console.log(s); };

function replay(name: string, ses: TraceSession): { ok: boolean; bad: number; stats: NetStats[] } | null {
  const set = SETS[ses.meta.set];
  const n = ses.peers.length;
  if (ses.peers.some((p) => !p) || !set || !set.levels[ses.meta.level]) { say(`skip ${name}: incomplete (needs every player's log)`); return null; }
  const logs = ses.peers as PeerLog[];
  const D = logs.map((l) => decode(l, n));
  if (D.some((d) => d.ticks.length < 120)) { say(`skip ${name}: too short`); return null; }

  // Raw "delay" of each packet is measured across two unsynchronised clocks. Assuming the
  // fastest packet each way took equally long (as NTP does) gives the clock offset.
  // raw[a][b]: packet number -> (arrival on b's clock) - (send on a's clock)
  const raw: Map<number, number>[][] = D.map((a, ai) => D.map((b) => {
    const m = new Map<number, number>();
    for (const r of b.rx[ai]) if (r.n < a.ticks.length && !m.has(r.n)) m.set(r.n, r.t - a.ticks[r.n]);
    return m;
  }));
  const linked = (a: number, b: number) => raw[a][b].size >= 30 && raw[b][a].size >= 30;
  // Every player's clock relative to player 0's, walking outward over the links that exist.
  const off: (number | null)[] = D.map((_, i) => (i === 0 ? 0 : null));
  for (let pass = 0; pass < n; pass++) {
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (off[a] === null || off[b] !== null || !linked(a, b)) continue;
      off[b] = off[a]! + (Math.min(...raw[a][b].values()) - Math.min(...raw[b][a].values())) / 2;
    }
  }
  if (off.some((o) => o === null)) { say(`skip ${name}: a player had no working link to the others`); return null; }
  const ticks = D.map((d, i) => d.ticks.map((t) => t - off[i]!)); // everyone on player 0's clock
  const delays: Map<number, number>[][] = raw.map((row, a) => row.map((m, b) => {
    const out = new Map<number, number>();
    for (const [k, d] of m) out.set(k, Math.max(0.5, d - (off[b]! - off[a]!)));
    return out;
  }));

  const r = simulate(set.levels, ses.meta.level, ses.meta.seed,
    D.map((d, i): PeerScript => ({
      frames: ticks[i].filter((t, k) => k === 0 || t > ticks[i][k - 1]),
      inputAt: (t) => d.inputs[lastAtOrBefore(ticks[i], t)],
    })),
    { delay: (from, to, t) => (linked(from, to) ? delays[from][to].get(lastAtOrBefore(ticks[from], t)) ?? null : null) });

  const secs = Math.max(...ticks.map((t) => t[t.length - 1])) / 1000;
  const bad = r.stats.reduce((a, s) => a + badness(s), 0);
  const ok = !r.desync && r.mismatched === 0;
  say(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${n} players, ${set.name} level ${ses.meta.level + 1}, ${secs.toFixed(0)}s, recorded on v${ses.meta.version}`);
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (!linked(a, b)) { say(`       link P${a + 1}-P${b + 1}: none (relayed)`); continue; }
    const d1 = [...delays[a][b].values()], d2 = [...delays[b][a].values()];
    say(`       link P${a + 1}-P${b + 1}: ${median(d1).toFixed(0)}ms / ${median(d2).toFixed(0)}ms each way, p95 ${pctl(d1, 0.95).toFixed(0)} / ${pctl(d2, 0.95).toFixed(0)}ms, lost ${(100 * (1 - d1.length / D[a].ticks.length)).toFixed(1)}% / ${(100 * (1 - d2.length / D[b].ticks.length)).toFixed(1)}%`);
  }
  const live = logs.map((l) => l.end?.stats);
  logs.forEach((_, i) => {
    if (live[i]) say(`       P${i + 1} then: ${describe(live[i]!)}`);
    say(`       P${i + 1} now:  ${describe(r.stats[i])}`);
  });
  const liveBad = live.every(Boolean) ? live.reduce((a, s) => a + badness(s!), 0).toFixed(3) : 'n/a';
  say(`       badness then ${liveBad} -> now ${bad.toFixed(3)}${r.desync ? '   DESYNC IN REPLAY' : ''}`);
  return { ok, bad, stats: r.stats };
}

const args = process.argv.slice(2);
const sweep = args.includes('--sweep');
const dir = args.find((a) => !a.startsWith('--')) ?? 'traces';
const files: string[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f: string) => f.endsWith('.json')).sort() : [];
if (!files.length) { console.log(`No traces in ${dir}/. Run "npm run fetch-traces", or save session logs from the host's lobby (L) and drop the files there.`); process.exit(0); }
const sessions: { name: string; ses: TraceSession }[] = [];
for (const f of files) {
  let data: { format?: string; sessions?: TraceSession[] };
  try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { console.log(`skip ${f}: not valid JSON`); continue; }
  if (data.format !== 'splitstorm-trace' || !data.sessions) { console.log(`skip ${f}: not a trace file`); continue; }
  data.sessions.forEach((ses, i) => sessions.push({ name: `${f} #${i + 1}`, ses }));
}

/** Replay everything with the current `tuning`; returns totals across all sessions and players. */
function runAll() {
  const T = { n: 0, ok: true, bad: 0, ticks: 0, stalled: 0, slowed: 0, rollbacks: 0, rollbackFrames: 0, maxRollback: 0, confirmed: 0, errSum: 0, errFrames: 0 };
  for (const { name, ses } of sessions) {
    const res = replay(name, ses);
    if (!res) continue;
    T.n++;
    T.bad += res.bad;
    if (!res.ok) T.ok = false;
    for (const s of res.stats) {
      T.ticks += s.ticks; T.stalled += s.stalled; T.slowed += s.slowed; T.rollbacks += s.rollbacks; T.rollbackFrames += s.rollbackFrames;
      T.maxRollback = Math.max(T.maxRollback, s.maxRollback); T.confirmed += s.confirmed; T.errSum += s.errSum; T.errFrames += s.errFrames;
    }
  }
  return T;
}
const row = (label: string, T: ReturnType<typeof runAll>) =>
  `${label.padEnd(34)} badness ${(T.bad / Math.max(1, T.n)).toFixed(3)}  frozen ${(100 * T.stalled / T.ticks).toFixed(2)}%  slowed ${(100 * T.slowed / T.ticks).toFixed(2)}%  ` +
  `rollback avg ${(T.rollbackFrames / Math.max(1, T.rollbacks)).toFixed(2)}f max ${T.maxRollback}f  other-player error avg ${(T.errSum / T.confirmed).toFixed(2)}px, >8px ${(100 * T.errFrames / T.confirmed).toFixed(2)}%${T.ok ? '' : '  DESYNC'}`;

if (sweep) {
  // Try alternative settings against every recorded session. One knob at a time, rest at defaults.
  quiet = true;
  const base = { ...tuning };
  const variants: [string, Partial<typeof tuning>][] = [
    ['current settings', {}],
    ['input delay 1 (16ms)', { inputDelay: 1 }],
    ['input delay 3 (50ms)', { inputDelay: 3 }],
    ['input delay 4 (67ms)', { inputDelay: 4 }],
    ['input delay 5 (83ms)', { inputDelay: 5 }],
    ['slow down later (30f)', { softAhead: 30 }],
    ['slow down sooner (12f)', { softAhead: 12 }],
    ['clock sync gentler (gain .006)', { rateGain: 0.006 }],
    ['clock sync firmer (gain .02)', { rateGain: 0.02 }],
    ['clock sync wider deadband (1.5f)', { deadband: 1.5 }],
    ['clock sync slower estimate (.03)', { offsetSmooth: 0.03 }],
    ['deadband 1.5 + estimate .03', { deadband: 1.5, offsetSmooth: 0.03 }],
  ];
  console.log(`${sessions.length} sessions\n`);
  for (const [label, change] of variants) {
    Object.assign(tuning, base, change);
    console.log(row(label, runAll()));
  }
  process.exit(0);
}

const T = runAll();
console.log(`\n${T.n} session(s) replayed. Mean badness ${(T.bad / Math.max(1, T.n)).toFixed(3)} (lower is better; 0 = no freezes, slowdowns or visible corrections).`);
console.log(row('all sessions, current netcode:', T));
process.exit(T.ok ? 0 : 1);
