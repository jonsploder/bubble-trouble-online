// Offline harness for the netcode: runs two RollbackSessions against each other on a
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
  /** One-way delay in ms for a packet sent by `from` at time t, or null if it is lost. */
  delay(from: number, t: number): number | null;
}

export interface SimResult {
  stats: NetStats[];
  desync: boolean;
  compared: number;
  mismatched: number;
  frames: number[];
  confirmed: number[];
  /** Largest gap between the two players' frame counters seen after the first second. */
  maxFrameGap: number;
  phase: string;
}

export function simulate(levels: Level[], level: number, seed: number, peers: PeerScript[], link: LinkModel): SimResult {
  const queue: { at: number; to: number; m: InputMsg }[] = [];
  let now = 0;
  const ses = [0, 1].map((me) => new RollbackSession(levels, me, newGame(levels, 2, level, seed), (m) => {
    const d = link.delay(me, now);
    if (d !== null) queue.push({ at: now + d, to: 1 - me, m: JSON.parse(JSON.stringify(m)) });
  }));
  const idx = [0, 0], acc = [0, 0], last = [peers[0].frames[0], peers[1].frames[0]];
  let maxFrameGap = 0;
  for (;;) {
    // next display frame across both peers
    const t0 = idx[0] < peers[0].frames.length ? peers[0].frames[idx[0]] : Infinity;
    const t1 = idx[1] < peers[1].frames.length ? peers[1].frames[idx[1]] : Infinity;
    if (t0 === Infinity || t1 === Infinity) break;
    const p = t0 <= t1 ? 0 : 1;
    now = p === 0 ? t0 : t1;
    idx[p]++;
    // deliver everything that has arrived by now, in arrival order
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) { const q = queue.shift()!; ses[q.to].receive(q.m, q.at); }
    const dt = Math.min(0.1, (now - last[p]) / 1000);
    last[p] = now;
    acc[p] = Math.min(acc[p] + dt * ses[p].rate, DT * 4);
    while (acc[p] >= DT) { acc[p] -= DT; ses[p].tick(peers[p].inputAt(now), now); }
    if (now > 1000) maxFrameGap = Math.max(maxFrameGap, Math.abs(ses[0].frame - ses[1].frame));
  }
  let compared = 0, mismatched = 0;
  for (const [f, sum] of ses[0].sums) {
    const other = ses[1].sums.get(f);
    if (other === undefined) continue;
    compared++;
    if (other !== sum) mismatched++;
  }
  return {
    stats: ses.map((s) => s.stats), desync: ses[0].desync || ses[1].desync, compared, mismatched,
    frames: ses.map((s) => s.frame), confirmed: ses.map((s) => s.confirmedFrame), maxFrameGap, phase: ses[0].confirmed.phase,
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
