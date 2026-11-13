import { SETS } from '../src/levels';
import { tuning } from '../src/rollback';
import type { NetStats, PeerLog } from '../src/rollback';
import { badness, describe, simulate } from './netsim';
import type { PeerScript } from './netsim';

declare function require(name: string): any;
const fs = require('fs'), path = require('path');

export interface TraceSession {
  meta: { version: number; gid: number; set: number; level: number; seed: number; date: string; players?: number; mode?: string };
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

export let quiet = false;
export function setQuiet(q: boolean) { quiet = q; }
const say = (s: string) => { if (!quiet) console.log(s); };

export interface LinkInfo { a: number; b: number; median: number; p95: number; loss: number }
export interface ReplayResult {
  name: string; meta: TraceSession['meta']; players: number; secs: number; ok: boolean;
  /** Badness summed over players, replayed with today's netcode. */
  bad: number;
  stats: NetStats[];
  /** What the players actually experienced, as recorded during the live game. */
  live: (NetStats | undefined)[];
  links: LinkInfo[];
}

export function replay(name: string, ses: TraceSession): ReplayResult | null {
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
  const links: LinkInfo[] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (!linked(a, b)) { say(`       link P${a + 1}-P${b + 1}: none (relayed)`); continue; }
    const d1 = [...delays[a][b].values()], d2 = [...delays[b][a].values()];
    links.push({ a, b, median: median([...d1, ...d2]), p95: pctl([...d1, ...d2], 0.95), loss: 100 * (1 - (d1.length + d2.length) / (D[a].ticks.length + D[b].ticks.length)) });
    say(`       link P${a + 1}-P${b + 1}: ${median(d1).toFixed(0)}ms / ${median(d2).toFixed(0)}ms each way, p95 ${pctl(d1, 0.95).toFixed(0)} / ${pctl(d2, 0.95).toFixed(0)}ms, lost ${(100 * (1 - d1.length / D[a].ticks.length)).toFixed(1)}% / ${(100 * (1 - d2.length / D[b].ticks.length)).toFixed(1)}%`);
  }
  const live = logs.map((l) => l.end?.stats);
  logs.forEach((_, i) => {
    if (live[i]) say(`       P${i + 1} then: ${describe(live[i]!)}`);
    say(`       P${i + 1} now:  ${describe(r.stats[i])}`);
  });
  const liveBad = live.every(Boolean) ? live.reduce((a, s) => a + badness(s!), 0).toFixed(3) : 'n/a';
  say(`       badness then ${liveBad} -> now ${bad.toFixed(3)}${r.desync ? '   DESYNC IN REPLAY' : ''}`);
  return { name, meta: ses.meta, players: n, secs, ok, bad, stats: r.stats, live, links };
}

/** Every trace session in a folder. */
export function loadSessions(dir: string): { name: string; ses: TraceSession }[] {
  const files: string[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f: string) => f.endsWith('.json')).sort() : [];
  const out: { name: string; ses: TraceSession }[] = [];
  for (const f of files) {
    let data: { format?: string; sessions?: TraceSession[] };
    try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { say(`skip ${f}: not valid JSON`); continue; }
    if (data.format !== 'splitstorm-trace' || !data.sessions) { say(`skip ${f}: not a trace file`); continue; }
    data.sessions.forEach((ses, i) => out.push({ name: `${f} #${i + 1}`, ses }));
  }
  return out;
}

export interface Totals { n: number; ok: boolean; bad: number; ticks: number; stalled: number; slowed: number; rollbacks: number; rollbackFrames: number; maxRollback: number; confirmed: number; errSum: number; errFrames: number }
export const emptyTotals = (): Totals => ({ n: 0, ok: true, bad: 0, ticks: 0, stalled: 0, slowed: 0, rollbacks: 0, rollbackFrames: 0, maxRollback: 0, confirmed: 0, errSum: 0, errFrames: 0 });
export function addStats(T: Totals, s: NetStats) {
  T.ticks += s.ticks; T.stalled += s.stalled; T.slowed += s.slowed; T.rollbacks += s.rollbacks; T.rollbackFrames += s.rollbackFrames;
  T.maxRollback = Math.max(T.maxRollback, s.maxRollback); T.confirmed += s.confirmed; T.errSum += s.errSum; T.errFrames += s.errFrames;
}

/** Replay every session with the current `tuning`. */
export function runAll(sessions: { name: string; ses: TraceSession }[]): { T: Totals; results: ReplayResult[] } {
  const T = emptyTotals(), results: ReplayResult[] = [];
  for (const { name, ses } of sessions) {
    const res = replay(name, ses);
    if (!res) continue;
    results.push(res);
    T.n++;
    T.bad += res.bad;
    if (!res.ok) T.ok = false;
    for (const s of res.stats) addStats(T, s);
  }
  return { T, results };
}

/** The variants `--sweep` tries: one knob at a time, the rest at their defaults. */
export const SWEEP: [string, Partial<typeof tuning>][] = [
  ['current settings', {}],
  ['input delay 2 (33ms)', { inputDelay: 2 }],
  ['input delay 3 (50ms)', { inputDelay: 3 }],
  ['input delay 4 (67ms)', { inputDelay: 4 }],
  ['input delay 5 (83ms)', { inputDelay: 5 }],
  ['slow down later (30f)', { softAhead: 30 }],
  ['slow down sooner (12f)', { softAhead: 12 }],
  ['clock sync gentler (gain .006)', { rateGain: 0.006 }],
  ['clock sync firmer (gain .02)', { rateGain: 0.02 }],
  ['clock sync wider deadband (1.5f)', { deadband: 1.5 }],
];

export function sweep(sessions: { name: string; ses: TraceSession }[]): { label: string; T: Totals }[] {
  const base = { ...tuning }, wasQuiet = quiet, out: { label: string; T: Totals }[] = [];
  quiet = true;
  for (const [label, change] of SWEEP) {
    Object.assign(tuning, base, change);
    out.push({ label, T: runAll(sessions).T });
  }
  Object.assign(tuning, base);
  quiet = wasQuiet;
  return out;
}
