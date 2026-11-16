// Rollback netcode for 2-4 players. Transport-agnostic: give it a `send(to, msg)` function
// and feed it incoming messages. Only inputs cross the wire.
//
// - Your own inputs apply after `inputDelay` frames; other players' inputs are predicted
//   (assumed unchanged) until the real ones arrive.
// - `confirmed` is the state at the last frame where everyone's real inputs are known.
//   When a prediction turns out wrong, we rebuild `predicted` from `confirmed`.
// - Every packet resends whatever the recipient has not acknowledged, so loss is harmless.
// - Players also pass on each other's inputs. If two players cannot reach each other
//   directly, their inputs still arrive by way of a third.
// - Clock sync is done by gently running faster/slower (`rate`), never by dropping frames.
// - If someone goes quiet we slow down progressively, and only freeze as a last resort.
//
// The session also records a compact log (timings, inputs, packet arrivals). The logs from
// all players are enough to replay the session against any future version of this file:
// see scripts/replay.ts.

import type { Highlights } from './highlights';
import { IN_PAUSE, step } from './sim';
import type { GameEvent, Level, State } from './sim';

/** Tunable netcode parameters. scripts/replay.ts --sweep tries alternatives against recorded sessions. */
export const tuning = {
  /** Frames between pressing a key and it taking effect (hides that much network latency). */
  // 3 chosen from 58 recorded Sydney-Japan sessions: halves visible corrections vs 2.
  inputDelay: 3,
  /** Frames ahead of confirmed at which we start slowing down / stop entirely. */
  softAhead: 18,
  hardAhead: 60,
  /** Clock sync: speed change per frame of offset, the offset we tolerate, and estimate smoothing. */
  rateGain: 0.012,
  deadband: 0.5,
  offsetSmooth: 0.08,
};
export const INPUT_DELAY = tuning.inputDelay;
const CHECK_EVERY = 120;
/** Frames a sound waits for confirmation before playing the prediction instead (~170 ms). */
const SOUND_WAIT = 10;
const soundKey = (e: GameEvent) => e.t + ':' + ('p' in e ? e.p : '') + ':' + ('weapon' in e ? e.weapon : 'kind' in e ? e.kind : '');

export interface InputMsg {
  t: 'in';
  n: number; // packet number = sender's tick count
  f: number; // sender's current frame
  adv: number; // sender's frame lead over the recipient, as the sender sees it
  have: number[]; // how many inputs the sender holds, per player
  inp: [number, number, number[]][]; // [player, first frame, inputs] the recipient is missing
  ts?: number; // sender's clock (ms), for measuring ping
  ets?: number; // the last `ts` the sender got from the recipient...
  eh?: number; // ...and how long (ms) the sender held it before this packet
  cf: number; // frame of checksum
  ch: number; // checksum of confirmed state at cf
}

export interface NetStats {
  ticks: number;
  /** Ticks where the game did not advance (hard freeze). */
  stalled: number;
  /** Ticks run noticeably below full speed. */
  slowed: number;
  rollbacks: number;
  rollbackFrames: number;
  maxRollback: number;
  /** Frames compared: where we drew the other players vs. where they really were. */
  confirmed: number;
  /** Sum / max of the worst other-player position error in px, and frames where it was > 8px. */
  errSum: number;
  errMax: number;
  errFrames: number;
}

/** Times are tenths of a millisecond since session start. Flat arrays keep it small. */
export interface PeerLog {
  me: number;
  /** Number of players (absent in old two-player logs). */
  players?: number;
  /** Delta time of every tick. Packet n is sent on tick n. */
  tick: number[];
  /** Pairs: tick index, input bits (on change). */
  in: number[];
  /** Per sender: pairs of (delta time, packet number). Old two-player logs: one flat list. */
  rx: number[][] | number[];
  /** Tick indexes that froze. */
  stall: number[];
  /** Pairs: tick index, rollback depth. */
  rb: number[];
  /** Pairs: tick index, rate in percent (on change). */
  rate: number[];
  end?: { frame: number; confirmedFrame: number; desync: boolean; stats: NetStats };
}

function checksum(s: State): number {
  const str = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export class RollbackSession {
  frame = 0;
  confirmedFrame = 0;
  confirmed: State;
  /** Keeps the game's top moments, from confirmed frames only. */
  hl?: Highlights;
  predicted: State;
  /** Events from the newest frame only, for visual effects; the caller drains this. */
  events: GameEvent[] = [];
  /**
   * Events to play as sound; the caller drains this. A guess about another player can be
   * wrong (a death that didn't happen) or arrive a frame late and be re-run (a shot), so
   * sounds come from confirmed frames, which usually trail by a frame or two. Your own
   * shots sound at once, and a frame still unconfirmed after SOUND_WAIT frames plays
   * its best guess rather than go quiet.
   */
  sounds: GameEvent[] = [];
  desync = false;
  stalled = false;
  /** Multiply real elapsed time by this before ticking. */
  rate = 1;
  /** Ticks since we last heard from anyone. */
  silence = 0;
  readonly players: number;
  readonly sums = new Map<number, number>();
  readonly stats: NetStats = { ticks: 0, stalled: 0, slowed: 0, rollbacks: 0, rollbackFrames: 0, maxRollback: 0, confirmed: 0, errSum: 0, errMax: 0, errFrames: 0 };
  readonly log: PeerLog;

  private inputs: number[][] = []; // per player, indexed by frame
  private theirHave: number[][] = []; // [peer][player]: what that peer told us it holds
  private remoteFrame: number[];
  private offset: number[]; // smoothed estimate of how many frames we are ahead of each peer
  private heard: boolean[];
  private shown: number[][] = []; // every player's x as displayed, per frame
  private dirty = false;
  private peerSums = new Map<number, number>();
  private lastCf = 0;
  private scratch: GameEvent[] = [];
  /** Latest prediction's events for each unconfirmed frame. */
  private guessed = new Map<number, GameEvent[]>();
  /** Sound keys already played ahead of confirmation, per frame. */
  private early = new Map<number, string[]>();
  private lastT = 0;
  private lastRx: number[];
  private lastIn = -1;
  private peerTs: number[];
  private peerAt: number[];
  /** Round trip to each other player in ms, smoothed, or -1 before it's known. */
  ping: number[];
  private lastRate = 100;

  constructor(private levels: Level[], private me: number, initial: State, private send: (to: number, m: InputMsg) => void) {
    const n = (this.players = initial.players.length);
    this.confirmed = initial;
    this.predicted = JSON.parse(JSON.stringify(initial));
    for (let p = 0; p < n; p++) { this.inputs.push([]); this.theirHave.push(new Array<number>(n).fill(0)); }
    for (let i = 0; i < tuning.inputDelay; i++) this.inputs[me].push(0);
    this.remoteFrame = new Array<number>(n).fill(0);
    this.offset = new Array<number>(n).fill(0);
    this.heard = new Array<boolean>(n).fill(false);
    this.lastRx = new Array<number>(n).fill(0);
    this.peerTs = new Array<number>(n).fill(-1);
    this.peerAt = new Array<number>(n).fill(0);
    this.ping = new Array<number>(n).fill(-1);
    this.log = { me, players: n, tick: [], in: [], rx: Array.from({ length: n }, () => [] as number[]), stall: [], rb: [], rate: [] };
  }

  /** Call 60 * rate times a second with the local player's input bits. `now` is ms since session start. */
  tick(input: number, now = 0) {
    const n = this.stats.ticks++;
    const t = Math.round(now * 10);
    this.log.tick.push(t - this.lastT);
    this.lastT = t;
    if (input !== this.lastIn) { this.log.in.push(n, input); this.lastIn = input; }

    this.silence++;
    this.stalled = this.frame - this.confirmedFrame >= tuning.hardAhead;
    if (this.stalled) {
      this.stats.stalled++;
      this.log.stall.push(n);
    } else {
      this.inputs[this.me].push(input); // takes effect inputDelay frames from now
      this.frame++;
    }
    this.advance(!this.stalled, n);
    this.updateRate(n);

    const have = this.inputs.map((a) => a.length);
    const cf = this.lastCf, ch = this.sums.get(cf) ?? 0;
    for (let r = 0; r < this.players; r++) {
      if (r === this.me) continue;
      // everything this peer is missing: our own inputs, plus anyone else's we can pass on
      const inp: InputMsg['inp'] = [];
      for (let q = 0; q < this.players; q++) {
        const from = this.theirHave[r][q];
        if (q !== r && this.inputs[q].length > from) inp.push([q, from, this.inputs[q].slice(from, from + 240)]);
      }
      this.send(r, { t: 'in', n, f: this.frame, adv: this.frame - this.remoteFrame[r], have, inp, cf, ch, ts: now, ets: this.peerTs[r], eh: now - this.peerAt[r] });
    }
  }

  receive(from: number, m: InputMsg, now = 0) {
    if (from === this.me || from < 0 || from >= this.players) return;
    const t = Math.round(now * 10);
    (this.log.rx as number[][])[from].push(t - this.lastRx[from], m.n);
    this.lastRx[from] = t;
    this.silence = 0;
    if (m.ts !== undefined) { this.peerTs[from] = m.ts; this.peerAt[from] = now; }
    if (m.ets !== undefined && m.ets >= 0 && m.eh !== undefined) {
      const rtt = now - m.ets - m.eh;
      if (rtt >= 0 && rtt < 5000) this.ping[from] = this.ping[from] < 0 ? rtt : this.ping[from] * 0.9 + rtt * 0.1;
    }
    for (const [p, base, arr] of m.inp) {
      if (p === this.me || p < 0 || p >= this.players) continue;
      const guess = this.guess(p);
      for (let i = 0; i < arr.length; i++) {
        if (base + i !== this.inputs[p].length) continue;
        this.inputs[p].push(arr[i]);
        if (arr[i] !== guess) this.dirty = true; // a prediction may have been wrong
      }
    }
    const th = this.theirHave[from];
    for (let q = 0; q < this.players; q++) if (m.have[q] > th[q]) th[q] = m.have[q];
    if (m.f >= this.remoteFrame[from]) {
      this.remoteFrame[from] = m.f;
      // Both sides measure "my frame minus the newest frame I've seen from you". Each is
      // inflated by the same latency, so half the difference is the true clock offset.
      const d = (this.frame - m.f - m.adv) / 2;
      this.offset[from] = this.heard[from] ? this.offset[from] + (d - this.offset[from]) * tuning.offsetSmooth : d;
      this.heard[from] = true;
    }
    if (m.cf > 0) {
      const mine = this.sums.get(m.cf);
      if (mine === undefined) this.peerSums.set(m.cf, m.ch);
      else if (mine !== m.ch) this.desync = true;
    }
  }

  /** Close the log and return it. */
  finish(): PeerLog {
    this.log.end = { frame: this.frame, confirmedFrame: this.confirmedFrame, desync: this.desync, stats: { ...this.stats } };
    return this.log;
  }

  /** Remember a predicted frame's events, and sound our own shots straight away. */
  private guess_(f: number, ev: GameEvent[]) {
    if (f < this.confirmedFrame) return;
    const mine = ev.filter((e) => e.t === 'shoot' && e.p === this.me);
    const done = this.early.get(f) ?? [];
    for (const e of mine) if (!done.includes(soundKey(e))) this.playEarly(f, e);
    this.guessed.set(f, ev.filter((e) => !mine.includes(e)));
  }

  private playEarly(f: number, e: GameEvent) {
    const list = this.early.get(f) ?? [];
    list.push(soundKey(e));
    this.early.set(f, list);
    this.sounds.push(e);
  }

  /** Prediction for an input we don't have yet: same as that player's last, minus one-shot bits. */
  private guess(p: number): number {
    const a = this.inputs[p];
    return a.length ? a[a.length - 1] & ~IN_PAUSE : 0;
  }

  private inputsAt(f: number): number[] {
    const out: number[] = [];
    for (let p = 0; p < this.players; p++) out.push(f < this.inputs[p].length ? this.inputs[p][f] : this.guess(p));
    return out;
  }

  private updateRate(n: number) {
    let r = 1, sum = 0, count = 0;
    for (let p = 0; p < this.players; p++) if (this.heard[p]) { sum += this.offset[p]; count++; }
    if (count) {
      const d = Math.max(-8, Math.min(8, sum / count));
      if (Math.abs(d) > tuning.deadband) r -= d * tuning.rateGain; // ahead of the others: ease off; behind: hurry up
    }
    const ahead = this.frame - this.confirmedFrame;
    if (ahead > tuning.softAhead) r *= Math.max(0.3, 1 - (ahead - tuning.softAhead) / (tuning.hardAhead - tuning.softAhead));
    this.rate = r;
    if (r < 0.97) this.stats.slowed++;
    const pct = Math.round(r * 100);
    if (pct !== this.lastRate) { this.log.rate.push(n, pct); this.lastRate = pct; }
  }

  private advance(stepped: boolean, n: number) {
    const ev = this.scratch;
    let known = this.frame;
    for (let p = 0; p < this.players; p++) if (p !== this.me && this.inputs[p].length < known) known = this.inputs[p].length;
    while (this.confirmedFrame < known) {
      const f = this.confirmedFrame;
      const inp = this.inputsAt(f);
      this.hl?.before(this.confirmed);
      step(this.confirmed, inp, this.levels, ev);
      this.hl?.after(this.confirmed, inp);
      const played = this.early.get(f);
      for (const e of ev) {
        const k = played ? played.indexOf(soundKey(e)) : -1;
        if (k >= 0) played!.splice(k, 1); else this.sounds.push(e);
      }
      this.early.delete(f);
      this.guessed.delete(f);
      ev.length = 0;
      const shown = this.shown[f];
      this.stats.confirmed++;
      if (shown) {
        let err = 0;
        for (let p = 0; p < this.players; p++) if (p !== this.me) err = Math.max(err, Math.abs(this.confirmed.players[p].x - shown[p]));
        this.stats.errSum += err;
        if (err > this.stats.errMax) this.stats.errMax = err;
        if (err > 8) this.stats.errFrames++;
        delete this.shown[f];
      }
      const cf = ++this.confirmedFrame;
      if (cf % CHECK_EVERY === 0) {
        const sum = checksum(this.confirmed);
        this.sums.set(cf, sum);
        this.sums.delete(cf - CHECK_EVERY * 20);
        this.lastCf = cf;
        const theirs = this.peerSums.get(cf);
        if (theirs !== undefined) { if (theirs !== sum) this.desync = true; this.peerSums.delete(cf); }
      }
    }
    if (this.dirty) {
      this.dirty = false;
      const depth = this.frame - this.confirmedFrame;
      if (depth > 0) {
        this.stats.rollbacks++;
        this.stats.rollbackFrames += depth;
        if (depth > this.stats.maxRollback) this.stats.maxRollback = depth;
        this.log.rb.push(n, depth);
      }
      this.predicted = JSON.parse(JSON.stringify(this.confirmed));
      for (let f = this.confirmedFrame; f < this.frame; f++) {
        const fresh = stepped && f === this.frame - 1;
        step(this.predicted, this.inputsAt(f), this.levels, ev);
        if (fresh) this.events.push(...ev);
        this.guess_(f, ev);
        ev.length = 0;
      }
    } else if (stepped) {
      step(this.predicted, this.inputsAt(this.frame - 1), this.levels, ev);
      this.events.push(...ev);
      this.guess_(this.frame - 1, ev);
      ev.length = 0;
    }
    // Waited long enough for this frame: play what we think happened.
    const late = this.frame - 1 - SOUND_WAIT;
    const g = this.guessed.get(late);
    if (late >= this.confirmedFrame && g) {
      for (const e of g) this.playEarly(late, e);
      this.guessed.delete(late);
    }
    if (stepped) this.shown[this.frame - 1] = this.predicted.players.map((p) => p.x);
  }
}
