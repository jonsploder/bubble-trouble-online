// Two-player rollback netcode. Transport-agnostic: give it a `send` function and feed it
// incoming messages. Only inputs cross the wire.
//
// - Your own inputs apply after INPUT_DELAY frames; the other player's inputs are predicted
//   (assumed unchanged) until the real ones arrive.
// - `confirmed` is the state at the last frame where both players' real inputs are known.
//   When a prediction turns out wrong, we rebuild `predicted` from `confirmed`.
// - Every packet resends all inputs the peer has not acknowledged, so lost packets are harmless.

import { step } from './sim';
import type { GameEvent, Level, State } from './sim';

const INPUT_DELAY = 2;
const MAX_PREDICTION = 45; // frames we will run ahead of confirmed before waiting
const CHECK_EVERY = 120;

export interface InputMsg {
  t: 'in';
  f: number; // sender's current frame
  base: number; // frame of inputs[0]
  inputs: number[];
  ack: number; // how many of the receiver's inputs the sender holds
  adv: number; // sender's frame lead as it sees it
  cf: number; // frame of checksum
  ch: number; // checksum of confirmed state at cf
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
  /** Ticks since we last heard from the peer. */
  silence = 0;
  readonly sums = new Map<number, number>();

  private local: number[] = [];
  private remote: number[] = [];
  private peerAck = 0;
  private remoteFrame = 0;
  private remoteAdv = 0;
  private dirty = false;
  private skipCtr = 0;
  private peerSums = new Map<number, number>();
  private lastCf = 0;
  private scratch: GameEvent[] = [];

  constructor(private levels: Level[], private me: number, initial: State, private send: (m: InputMsg) => void) {
    this.confirmed = initial;
    this.predicted = JSON.parse(JSON.stringify(initial));
    for (let i = 0; i < INPUT_DELAY; i++) this.local.push(0);
  }

  /** Call 60 times a second with the local player's input bits. */
  tick(input: number) {
    this.silence++;
    const adv = this.frame - this.remoteFrame;
    this.stalled = this.frame - this.confirmedFrame >= MAX_PREDICTION;
    let skip = this.stalled;
    // If we are running ahead of the peer, drop the odd frame so the two clocks converge.
    if (!skip && (adv - this.remoteAdv) / 2 >= 1 && this.skipCtr++ % 8 === 0) skip = true;
    if (!skip) {
      this.local.push(input); // takes effect at frame + INPUT_DELAY
      this.frame++;
    }
    this.advance(!skip);
    const base = this.peerAck;
    this.send({
      t: 'in', f: this.frame, base, inputs: this.local.slice(base, base + 240), ack: this.remote.length, adv,
      cf: this.lastCf, ch: this.sums.get(this.lastCf) ?? 0,
    });
  }

  receive(m: InputMsg) {
    this.silence = 0;
    const oldLast = this.remote.length ? this.remote[this.remote.length - 1] : 0;
    for (let i = 0; i < m.inputs.length; i++) {
      if (m.base + i !== this.remote.length) continue;
      this.remote.push(m.inputs[i]);
      if (m.inputs[i] !== oldLast) this.dirty = true; // a prediction may have been wrong
    }
    if (m.ack > this.peerAck) this.peerAck = m.ack;
    if (m.f >= this.remoteFrame) { this.remoteFrame = m.f; this.remoteAdv = m.adv; }
    if (m.cf > 0) {
      const mine = this.sums.get(m.cf);
      if (mine === undefined) this.peerSums.set(m.cf, m.ch);
      else if (mine !== m.ch) this.desync = true;
    }
  }

  private pair(f: number): number[] {
    const r = f < this.remote.length ? this.remote[f] : this.remote.length ? this.remote[this.remote.length - 1] : 0;
    return this.me === 0 ? [this.local[f], r] : [r, this.local[f]];
  }

  private advance(stepped: boolean) {
    const ev = this.scratch;
    const known = Math.min(this.frame, this.remote.length);
    while (this.confirmedFrame < known) {
      step(this.confirmed, this.pair(this.confirmedFrame), this.levels, ev);
      ev.length = 0;
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
      this.predicted = JSON.parse(JSON.stringify(this.confirmed));
      for (let f = this.confirmedFrame; f < this.frame; f++) {
        const fresh = stepped && f === this.frame - 1;
        step(this.predicted, this.pair(f), this.levels, fresh ? this.events : ev);
        ev.length = 0;
      }
    } else if (stepped) {
      step(this.predicted, this.pair(this.frame - 1), this.levels, this.events);
    }
  }
}
