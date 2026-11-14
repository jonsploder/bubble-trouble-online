// Offline harness for the netcode: runs 2-4 RollbackSessions against each other on a
// simulated timeline. Used by nettest.ts (synthetic networks) and replay.ts (recorded ones).
// It drives the sessions exactly like the game loop in src/main.ts does.
import { RollbackSession } from '../src/rollback';
import type { InputMsg, NetStats } from '../src/rollback';
import { DT, newGame } from '../src/sim';
import type { Level } from '../src/sim';

export interface PeerScript {
  /** Display frame times in ms (when requestAnimationFrame fired), ascending. */
  frames: number[];
  /** Input bits held at time t. */
  inputAt(t: number): number;
}

export interface LinkModel {
  /** One-way delay in ms for a packet sent from -> to at time t; null if lost or there is no link. */
  delay(from: number, to: number, t: number): number | null;
}

export interface SimResult {
  stats: NetStats[];
  desync: boolean;
  compared: number;
  mismatched: number;
  frames: number[];
  confirmed: number[];
  /** Largest gap between any two players' frame counters seen after the first second. */
  maxFrameGap: number;
  phase: string;
  /** Per player: sounds heard (by type), and the events that really happened in the confirmed game. */
  heard: Record<string, number>[];
}

export function simulate(levels: Level[], level: number, seed: number, peers: PeerScript[], link: LinkModel): SimResult {
  const n = peers.length;
  const queue: { at: number; from: number; to: number; m: InputMsg }[] = [];
  let now = 0;
  const ses = peers.map((_, me) => new RollbackSession(levels, me, newGame(levels, n, level, seed), (to, m) => {
    const d = link.delay(me, to, now);
    if (d !== null) queue.push({ at: now + d, from: me, to, m: JSON.parse(JSON.stringify(m)) });
  }));
  const idx = peers.map(() => 0), acc = peers.map(() => 0), last = peers.map((p) => p.frames[0]);
  let maxFrameGap = 0;
  const heard: Record<string, number>[] = peers.map(() => ({}));
  for (;;) {
    // next display frame across all peers; stop when anyone runs out
    let p = -1, t = Infinity, done = false;
    for (let i = 0; i < n; i++) {
      if (idx[i] >= peers[i].frames.length) { done = true; break; }
      if (peers[i].frames[idx[i]] < t) { t = peers[i].frames[idx[i]]; p = i; }
    }
    if (done) break;
    now = t;
    idx[p]++;
    // deliver everything that has arrived by now, in arrival order
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) { const q = queue.shift()!; ses[q.to].receive(q.from, q.m, q.at); }
    const dt = Math.min(0.1, (now - last[p]) / 1000);
    last[p] = now;
    acc[p] = Math.min(acc[p] + dt * ses[p].rate, DT * 4);
    while (acc[p] >= DT) { acc[p] -= DT; ses[p].tick(peers[p].inputAt(now), now); }
    for (const e of ses[p].sounds) heard[p][e.t] = (heard[p][e.t] ?? 0) + 1;
    ses[p].sounds.length = 0;
    ses[p].events.length = 0;
    if (now > 1000) {
      const fr = ses.map((s) => s.frame);
      maxFrameGap = Math.max(maxFrameGap, Math.max(...fr) - Math.min(...fr));
    }
  }
  // every pair of players must agree on every checkpoint they both reached
  let compared = 0, mismatched = 0;
  for (let i = 1; i < n; i++) {
    for (const [f, sum] of ses[0].sums) {
      const other = ses[i].sums.get(f);
      if (other === undefined) continue;
      compared++;
      if (other !== sum) mismatched++;
    }
  }
  return {
    stats: ses.map((s) => s.stats), desync: ses.some((s) => s.desync), compared, mismatched,
    frames: ses.map((s) => s.frame), confirmed: ses.map((s) => s.confirmedFrame), maxFrameGap, phase: ses[0].confirmed.phase, heard,
  };
}

/** One line per player: the numbers that describe how the session felt. */
export function describe(s: NetStats): string {
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '0.0') + '%';
  return [
    `frozen ${pct(s.stalled, s.ticks)}`,
    `slowed ${pct(s.slowed, s.ticks)}`,
    `rollbacks ${s.rollbacks} (avg ${(s.rollbacks ? s.rollbackFrames / s.rollbacks : 0).toFixed(1)}f, max ${s.maxRollback}f)`,
    `other-player error avg ${(s.confirmed ? s.errSum / s.confirmed : 0).toFixed(2)}px max ${s.errMax.toFixed(0)}px >8px ${pct(s.errFrames, s.confirmed)}`,
  ].join('  ');
}

/** Single number to minimise when tuning: weighted share of bad frames. */
export function badness(s: NetStats): number {
  return (10 * s.stalled + 3 * s.slowed) / Math.max(1, s.ticks) + (2 * s.errFrames) / Math.max(1, s.confirmed);
}
