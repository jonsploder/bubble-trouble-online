import { H, PH, PW, RADII } from './sim';
import type { State } from './sim';

// Top moments: the stretches of a game where balls came closest to the players, kept so the
// results screen can replay them. The sim is deterministic, so a moment is just a snapshot
// of the state plus the inputs that followed it; replaying them reproduces it exactly.

/** One replayable moment: the state it starts from, then each tick's inputs. */
export interface Clip {
  snap: string;
  inputs: number[][];
  /** How tense it was: summed closeness of balls to players over the moment. */
  score: number;
}

const SNAP_EVERY = 30; // ticks between snapshots
const KEEP = 40 * 60; // ticks of history kept (snapshots and inputs)
const ON = 0.3; // stress above this starts (or continues) a moment
const CALM = 60; // ticks below it end one
const LEAD = 3 * 60; // lead-in shown before it starts
const AFTER_HIT = 90; // a moment where someone goes down ends this long after the hit
const MAX_LEN = 12 * 60;
const MIN_LEN = 7 * 60;
const MIN_ALIVE = 5 * 60; // everyone stays up for at least this long from the start of the clip...
const MIN_TENSE = 90; // ...and the tense part before anyone goes down lasts at least this long: no clips of a quick death
const MIN_SCORE = 12;
const TOP = 3;
const NEAR = 60; // px: a ball this far from a player starts to count

/** How close the balls are to the players right now: each ball near a standing player adds up to 1. */
function stress(s: State): number {
  if (s.paused || s.phase !== 'play') return 0;
  let sum = 0;
  for (const p of s.players) {
    if (p.down || p.ride >= 0) continue;
    const x0 = p.x - PW / 2, x1 = p.x + PW / 2, y0 = H - PH;
    for (const b of s.balls) {
      const cx = b.x < x0 ? x0 : b.x > x1 ? x1 : b.x, cy = b.y < y0 ? y0 : b.y > H ? H : b.y;
      const gap = Math.hypot(b.x - cx, b.y - cy) - RADII[b.size];
      if (gap < NEAR) { const w = 1 - Math.max(0, gap) / NEAR; sum += w * w; }
    }
  }
  return sum;
}

export class Highlights {
  private n = 0;
  private snaps: { n: number; json: string }[] = [];
  private inputs = new Map<number, number[]>();
  private downs: boolean[] = [];
  /** The moment in progress: when it started, its score, its tensest tick, ticks of calm since, and the tick someone first went down (-1: no one yet). */
  private ep: { start: number; score: number; peak: number; peakV: number; calm: number; down: number } | null = null;
  private top: Clip[] = [];

  /** Call just before each step of the real (confirmed) game. */
  before(s: State) {
    if (this.n % SNAP_EVERY === 0) {
      this.snaps.push({ n: this.n, json: JSON.stringify(s) });
      while (this.snaps.length > 1 && this.snaps[1].n <= this.n - KEEP) this.snaps.shift();
    }
    this.downs = s.players.map((p) => p.down);
  }

  /** Call just after that step, with the inputs it used. */
  after(s: State, inputs: number[]) {
    this.inputs.set(this.n, inputs.slice());
    this.inputs.delete(this.n - KEEP - SNAP_EVERY);
    const v = stress(s), now = this.n++;
    if (this.ep && this.ep.down < 0 && s.players.some((p, i) => p.down && !this.downs[i])) this.ep.down = now;
    if (v > ON) {
      if (!this.ep) this.ep = { start: now, score: 0, peak: now, peakV: 0, calm: 0, down: -1 };
      this.ep.score += v;
      this.ep.calm = 0;
      if (v > this.ep.peakV) { this.ep.peakV = v; this.ep.peak = now; }
    } else if (this.ep && ++this.ep.calm >= CALM) this.close();
    if (this.ep && this.ep.down >= 0 && now >= this.ep.down + AFTER_HIT) this.close();
  }

  private close() {
    const ep = this.ep!;
    this.ep = null;
    if (ep.score < MIN_SCORE) return;
    if (ep.down >= 0 && ep.down - ep.start < MIN_TENSE) return; // just a hit, not a moment
    if (this.top.length >= TOP && ep.score <= this.top[TOP - 1].score) return;
    let from = ep.start - LEAD, to = ep.down >= 0 ? Math.min(this.n, ep.down + AFTER_HIT) : this.n;
    // too long: keep the stretch around its tensest point, ending soon after any hit
    if (to - from > MAX_LEN) from = Math.max(from, Math.min(ep.peak - MAX_LEN / 2, to - MAX_LEN));
    from = Math.min(from, to - MIN_LEN); // short ones get a longer lead-in
    let snap = this.snaps[0];
    for (const sn of this.snaps) if (sn.n <= from) snap = sn;
    if (!snap) return;
    to = Math.min(to, snap.n + MAX_LEN + SNAP_EVERY);
    if (ep.down >= 0 && ep.down - snap.n < MIN_ALIVE) return;
    const inputs: number[][] = [];
    for (let k = snap.n; k < to; k++) { const i = this.inputs.get(k); if (!i) return; inputs.push(i); }
    this.top.push({ snap: snap.json, inputs, score: ep.score });
    this.top.sort((a, b) => b.score - a.score);
    this.top.length = Math.min(this.top.length, TOP);
  }

  /** The game is over: the best moments, most tense first. */
  finish(): Clip[] {
    if (this.ep) this.close();
    return this.top;
  }
}
