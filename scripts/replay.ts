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

interface Decoded { ticks: number[]; inputs: number[]; rx: { t: number; n: number }[] }

function decode(log: PeerLog): Decoded {
  const ticks: number[] = [];
  let t = 0;
  for (const d of log.tick) { t += d; ticks.push(t / 10); }
  const inputs = new Array<number>(ticks.length).fill(0);
  for (let i = 0; i < log.in.length; i += 2) {
    const end = i + 2 < log.in.length ? log.in[i + 2] : ticks.length;
    for (let k = log.in[i]; k < end; k++) inputs[k] = log.in[i + 1];
  }
  const rx: { t: number; n: number }[] = [];
  t = 0;
  for (let i = 0; i < log.rx.length; i += 2) { t += log.rx[i]; rx.push({ t: t / 10, n: log.rx[i + 1] }); }
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

function replay(name: string, ses: TraceSession): { ok: boolean; bad: number } | null {
  const [la, lb] = ses.peers;
  const set = SETS[ses.meta.set];
  if (!la || !lb || !set || !set.levels[ses.meta.level]) { console.log(`skip ${name}: incomplete (needs both players' logs)`); return null; }
  const A = decode(la), B = decode(lb);
  if (A.ticks.length < 120 || B.ticks.length < 120) { console.log(`skip ${name}: too short`); return null; }

  // Raw "delay" of each packet is measured across two unsynchronised clocks. Assuming the
  // fastest packet each way took equally long (as NTP does) gives the clock offset.
  const raw = (rx: Decoded['rx'], senderTicks: number[]) => {
    const m = new Map<number, number>();
    for (const r of rx) if (r.n < senderTicks.length && !m.has(r.n)) m.set(r.n, r.t - senderTicks[r.n]);
    return m;
  };
  const ab = raw(B.rx, A.ticks), ba = raw(A.rx, B.ticks);
  if (ab.size < 30 || ba.size < 30) { console.log(`skip ${name}: almost no packets got through`); return null; }
  const off = (Math.min(...ab.values()) - Math.min(...ba.values())) / 2; // B's clock minus A's
  const bTicks = B.ticks.map((t) => t - off);
  const delays = [new Map<number, number>(), new Map<number, number>()];
  for (const [n, d] of ab) delays[0].set(n, Math.max(0.5, d - off));
  for (const [n, d] of ba) delays[1].set(n, Math.max(0.5, d + off));
  const sendTimes = [A.ticks, bTicks];

  const script = (ticks: number[], inputs: number[]): PeerScript => ({
    frames: ticks.filter((t, i) => i === 0 || t > ticks[i - 1]),
    inputAt: (t) => inputs[lastAtOrBefore(ticks, t)],
  });
  const r = simulate(set.levels, ses.meta.level, ses.meta.seed, [script(A.ticks, A.inputs), script(bTicks, B.inputs)], {
    delay: (from, t) => delays[from].get(lastAtOrBefore(sendTimes[from], t)) ?? null,
  });

  const secs = Math.max(A.ticks[A.ticks.length - 1], B.ticks[B.ticks.length - 1]) / 1000;
  const link = (i: number, sent: number) => {
    const d = [...delays[i].values()];
    return `${median(d).toFixed(0)}ms (p95 ${pctl(d, 0.95).toFixed(0)}ms, lost ${(100 * (1 - d.length / sent)).toFixed(1)}%)`;
  };
  const bad = badness(r.stats[0]) + badness(r.stats[1]);
  const ok = !r.desync && r.mismatched === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${set.name} level ${ses.meta.level + 1}, ${secs.toFixed(0)}s, recorded on v${ses.meta.version}`);
  console.log(`       link: host->guest ${link(0, A.ticks.length)}, guest->host ${link(1, B.ticks.length)}, start offset ${(bTicks[0] - A.ticks[0]).toFixed(0)}ms`);
  const live = [la.end?.stats, lb.end?.stats] as (NetStats | undefined)[];
  ['host ', 'guest'].forEach((who, i) => {
    if (live[i]) console.log(`       ${who} then: ${describe(live[i]!)}`);
    console.log(`       ${who} now:  ${describe(r.stats[i])}`);
  });
  const liveBad = live[0] && live[1] ? (badness(live[0]) + badness(live[1])).toFixed(3) : 'n/a';
  console.log(`       badness then ${liveBad} -> now ${bad.toFixed(3)}${r.desync ? '   DESYNC IN REPLAY' : ''}`);
  return { ok, bad };
}

const dir = process.argv[2] ?? 'traces';
const files: string[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f: string) => f.endsWith('.json')).sort() : [];
if (!files.length) { console.log(`No traces in ${dir}/. Save session logs from the host's lobby (L) and drop the files there.`); process.exit(0); }
let total = 0, count = 0, allOk = true;
for (const f of files) {
  let data: { format?: string; sessions?: TraceSession[] };
  try { data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { console.log(`skip ${f}: not valid JSON`); continue; }
  if (data.format !== 'splitstorm-trace' || !data.sessions) { console.log(`skip ${f}: not a trace file`); continue; }
  data.sessions.forEach((ses, i) => {
    const res = replay(`${f} #${i + 1}`, ses);
    if (!res) return;
    count++;
    total += res.bad;
    if (!res.ok) allOk = false;
  });
}
console.log(`\n${count} session(s) replayed. Mean badness ${(count ? total / count : 0).toFixed(3)} (lower is better; 0 = no freezes, slowdowns or visible corrections).`);
process.exit(allOk ? 0 : 1);
