// Netcode check without a network: two sessions on synthetic links with latency, jitter,
// loss, clock drift, late starts and outages. Both must stay in sync and keep moving.
import { SETS } from '../src/levels';
import type { Level } from '../src/sim';
import { badness, describe, simulate } from './netsim';
import type { PeerScript } from './netsim';

declare const process: { exit(code: number): never };

let seed = 99;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };

interface Net { oneWay: number; jitter: number; loss: number; drift?: number; lateStart?: number; outage?: [number, number]; hz?: number }

function player(seconds: number, startAt: number, drift: number, hz: number): PeerScript {
  const frames: number[] = [];
  for (let t = startAt; t < seconds * 1000; t += (1000 / hz) * (1 + drift) + (rnd() - 0.5) * 2) frames.push(t);
  // twitchy random player: changes what they hold a few times a second
  const changes: [number, number][] = [];
  for (let t = 0; t < seconds * 1000; t += 60 + rnd() * 400) changes.push([t, Math.floor(rnd() * 8)]);
  return {
    frames,
    inputAt: (t) => { let v = 0; for (const c of changes) { if (c[0] > t) break; v = c[1]; } return v; },
  };
}

function scenario(name: string, levels: Level[], level: number, net: Net, seconds = 60): boolean {
  const peers = [player(seconds, 0, 0, 60), player(seconds, net.lateStart ?? 0, net.drift ?? 0, net.hz ?? 60)];
  const r = simulate(levels, level, 777, peers, {
    delay: (_from, t) => {
      if (net.outage && t >= net.outage[0] && t < net.outage[1]) return null;
      return rnd() < net.loss ? null : net.oneWay + rnd() * net.jitter;
    },
  });
  const progress = Math.min(...r.confirmed) / (seconds * 60);
  const ok = !r.desync && r.mismatched === 0 && r.compared > 5 && progress > 0.85 && Math.abs(r.frames[0] - r.frames[1]) < 12;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  [sync checks ${r.compared}, mismatched ${r.mismatched}, progress ${(progress * 100).toFixed(0)}%, max frame gap ${r.maxFrameGap}, badness ${(badness(r.stats[0]) + badness(r.stats[1])).toFixed(3)}]`);
  r.stats.forEach((s, i) => console.log(`       P${i + 1}: ${describe(s)}`));
  return ok;
}

const C = SETS[0].levels, Hd = SETS[1].levels;
const results = [
  scenario('LAN (5ms)', C, 0, { oneWay: 5, jitter: 2, loss: 0 }),
  scenario('Sydney-Tokyo (70ms one way)', C, 2, { oneWay: 70, jitter: 15, loss: 0.02, drift: 0.002 }),
  scenario('Sydney-Tokyo, guest starts 250ms late', C, 2, { oneWay: 70, jitter: 15, loss: 0.02, lateStart: 250 }),
  scenario('Sydney-Tokyo, guest on a 120Hz screen', C, 4, { oneWay: 70, jitter: 15, loss: 0.02, hz: 120 }),
  scenario('200ms round trip, 5% loss', C, 9, { oneWay: 100, jitter: 30, loss: 0.05, drift: 0.005 }),
  scenario('bad: 300ms rt, 20% loss, drift', Hd, 7, { oneWay: 150, jitter: 60, loss: 0.2, drift: 0.02 }),
  scenario('70ms with a 600ms total outage', C, 2, { oneWay: 70, jitter: 15, loss: 0.02, outage: [20000, 20600] }),
  scenario('hard set, gravity flip + wind', Hd, 11, { oneWay: 70, jitter: 15, loss: 0.02, drift: 0.002 }),
];
process.exit(results.every(Boolean) ? 0 : 1);
