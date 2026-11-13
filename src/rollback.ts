// Two-player rollback netcode. Transport-agnostic: give it a `send` function and feed it
// incoming messages. Only inputs cross the wire.
//
// - Your own inputs apply after INPUT_DELAY frames; the other player's inputs are predicted
//   (assumed unchanged) until the real ones arrive.
// - `confirmed` is the state at the last frame where both players' real inputs are known.
//   When a prediction turns out wrong, we rebuild `predicted` from `confirmed`.
// - Every packet resends all inputs the peer has not acknowledged, so lost packets are harmless.
// - Clock sync is done by gently running faster/slower (`rate`), never by dropping frames.
// - If the peer goes quiet we slow down progressively, and only freeze as a last resort.
//
// The session also records a compact log (timings, inputs, packet arrivals). Logs from both
// players are enough to replay the session against any future version of this file: see
// scripts/replay.ts.

import { IN_PAUSE, step } from './sim';
import type { GameEvent, Level, State } from './sim';

export const INPUT_DELAY = 2;
/** Frames ahead of confirmed at which we start slowing down / stop entirely. */
const SOFT_AHEAD = 18;
const HARD_AHEAD = 60;
const CHECK_EVERY = 120;

export interface InputMsg {
  t: 'in';
  n: number; // packet number = sender's tick count
  f: number; // sender's current frame
  base: number; // frame of inputs[0]
  inputs: number[];
  ack: number; // how many of the receiver's inputs the sender holds
  adv: number; // sender's frame lead as it sees it
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
  /** Frames compared: what we showed for the other player vs. what really happened. */
  confirmed: number;
  /** Sum / max of the other player's position error in px, and frames where it was > 8px. */
  errSum: number;
  errMax: number;
  errFrames: number;
}

/** Times are tenths of a millisecond since session start. Flat arrays keep it small. */
export interface PeerLog {
  me: number;
  /** Delta time of every tick. Packet n is sent on tick n. */
  tick: number[];
  /** Pairs: tick index, input bits (on change). */
  in: number[];
  /** Pairs: delta time, packet number received. */
  rx: number[];
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
  predicted: State;
  /** Events from the newest frame only; the caller drains this. */
  events: GameEvent[] = [];
  desync = false;
  stalled = false;
  /** Multiply real elapsed time by this before ticking. */
  rate = 1;
  /** Ticks since we last heard from the peer. */
  silence = 0;
  readonly sums = new Map<number, number>();
  readonly stats: NetStats = { ticks: 0, stalled: 0, slowed: 0, rollbacks: 0, rollbackFrames: 0, maxRollback: 0, confirmed: 0, errSum: 0, errMax: 0, errFrames: 0 };
  readonly log: PeerLog;

  private local: number[] = [];
  private remote: number[] = [];
  private shown: number[] = []; // other player's x as displayed, per frame
  private peerAck = 0;
  private remoteFrame = 0;
  private offset = 0; // smoothed estimate of how many frames we are ahead of the peer
  private heard = false;
  private dirty = false;
  private peerSums = new Map<number, number>();
  private lastCf = 0;
  private scratch: GameEvent[] = [];
  private lastT = 0;
  private lastRx = 0;
  private lastIn = -1;
  private lastRate = 100;

  constructor(private levels: Level[], private me: number, initial: State, private send: (m: InputMsg) => void) {
    this.confirmed = initial;
    this.predicted = JSON.parse(JSON.stringify(initial));
    for (let i = 0; i < INPUT_DELAY; i++) this.local.push(0);
    this.log = { me, tick: [], in: [], rx: [], stall: [], rb: [], rate: [] };
  }

  /** Call 60 * rate times a second with the local player's input bits. `now` is ms since session start. */
  tick(input: number, now = 0) {
    const n = this.stats.ticks++;
    const t = Math.round(now * 10);
    this.log.tick.push(t - this.lastT);
    this.lastT = t;
    if (input !== this.lastIn) { this.log.in.push(n, input); this.lastIn = input; }

    this.silence++;
    this.stalled = this.frame - this.confirmedFrame >= HARD_AHEAD;
    if (this.stalled) {
      this.stats.stalled++;
      this.log.stall.push(n);
    } else {
      this.local.push(input); // takes effect at frame + INPUT_DELAY
      this.frame++;
    }
    this.advance(!this.stalled, n);
    this.updateRate(n);
    const base = this.peerAck;
    this.send({
      t: 'in', n, f: this.frame, base, inputs: this.local.slice(base, base + 240), ack: this.remote.length,
      adv: this.frame - this.remoteFrame, cf: this.lastCf, ch: this.sums.get(this.lastCf) ?? 0,
    });
  }

  receive(m: InputMsg, now = 0) {
    const t = Math.round(now * 10);
    this.log.rx.push(t - this.lastRx, m.n);
    this.lastRx = t;
    this.silence = 0;
    const guess = this.guess();
    for (let i = 0; i < m.inputs.length; i++) {
      if (m.base + i !== this.remote.length) continue;
      this.remote.push(m.inputs[i]);
      if (m.inputs[i] !== guess) this.dirty = true; // a prediction may have been wrong
    }
    if (m.ack > this.peerAck) this.peerAck = m.ack;
    if (m.f >= this.remoteFrame) {
      this.remoteFrame = m.f;
      // Both sides measure "my frame minus the newest frame I've seen from you". Each is
      // inflated by the same latency, so half the difference is the true clock offset.
      const d = (this.frame - m.f - m.adv) / 2;
      this.offset = this.heard ? this.offset + (d - this.offset) * 0.08 : d;
      this.heard = true;
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

  /** Prediction for a remote input we don't have yet: same as their last, minus one-shot bits. */
  private guess(): number {
    return this.remote.length ? this.remote[this.remote.length - 1] & ~IN_PAUSE : 0;
  }

  private pair(f: number): number[] {
    const r = f < this.remote.length ? this.remote[f] : this.guess();
    return this.me === 0 ? [this.local[f], r] : [r, this.local[f]];
  }

  private updateRate(n: number) {
    let r = 1;
    if (this.heard) {
      const d = Math.max(-8, Math.min(8, this.offset));
      if (Math.abs(d) > 0.5) r -= d * 0.012; // ahead of the peer: ease off; behind: hurry up
    }
    const ahead = this.frame - this.confirmedFrame;
    if (ahead > SOFT_AHEAD) r *= Math.max(0.3, 1 - (ahead - SOFT_AHEAD) / (HARD_AHEAD - SOFT_AHEAD));
    this.rate = r;
    if (r < 0.97) this.stats.slowed++;
    const pct = Math.round(r * 100);
    if (pct !== this.lastRate) { this.log.rate.push(n, pct); this.lastRate = pct; }
  }

  private advance(stepped: boolean, n: number) {
    const ev = this.scratch;
    const other = 1 - this.me;
    const known = Math.min(this.frame, this.remote.length);
    while (this.confirmedFrame < known) {
      const f = this.confirmedFrame;
      step(this.confirmed, this.pair(f), this.levels, ev);
      ev.length = 0;
      const shown = this.shown[f];
      this.stats.confirmed++;
      if (shown !== undefined) {
        const err = Math.abs(this.confirmed.players[other].x - shown);
        this.stats.errSum += err;
        if (err > this.stats.errMax) this.stats.errMax = err;
        if (err > 8) this.stats.errFrames++;
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
        step(this.predicted, this.pair(f), this.levels, fresh ? this.events : ev);
        ev.length = 0;
      }
    } else if (stepped) {
      step(this.predicted, this.pair(this.frame - 1), this.levels, this.events);
    }
    if (stepped) this.shown[this.frame - 1] = this.predicted.players[other].x;
  }
}
