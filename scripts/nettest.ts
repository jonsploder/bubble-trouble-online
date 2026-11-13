// Netcode check without a network: 2-4 sessions on synthetic links with latency, jitter,
// loss, clock drift, late starts, outages and missing links. All must stay in sync and keep moving.
import { SETS } from '../src/levels';
import type { Level } from '../src/sim';
import { badness, describe, simulate } from './netsim';
import type { PeerScript } from './netsim';

declare const process: { exit(code: number): never };

let seed = 99;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };

interface Net {
  players?: number;
  oneWay: number; jitter: number; loss: number;
  drift?: number; lateStart?: number; outage?: [number, number]; hz?: number;
  /** Pairs of players with no direct connection (their inputs must be relayed). */
  noLink?: [number, number][];
  /** Extra one-way delay on every link touching this player. */
  slow?: { player: number; extra: number };
}

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
  const n = net.players ?? 2;
  const peers = [player(seconds, 0, 0, 60)];
  for (let i = 1; i < n; i++) peers.push(player(seconds, i === 1 ? net.lateStart ?? 0 : 0, i === 1 ? net.drift ?? 0 : 0, i === 1 ? net.hz ?? 60 : 60));
  const r = simulate(levels, level, 777, peers, {
    delay: (from, to, t) => {
      if (net.noLink?.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) return null;
      if (net.outage && t >= net.outage[0] && t < net.outage[1]) return null;
      if (rnd() < net.loss) return null;
      const extra = net.slow && (net.slow.player === from || net.slow.player === to) ? net.slow.extra : 0;
      return net.oneWay + extra + rnd() * net.jitter;
    },
  });
  const progress = Math.min(...r.confirmed) / (seconds * 60);
  const ok = !r.desync && r.mismatched === 0 && r.compared > 5 && progress > 0.85 && Math.max(...r.frames) - Math.min(...r.frames) < 12;
  const bad = r.stats.reduce((a, s) => a + badness(s), 0) / n;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  [${n} players, sync checks ${r.compared}, mismatched ${r.mismatched}, progress ${(progress * 100).toFixed(0)}%, max frame gap ${r.maxFrameGap}, badness/player ${bad.toFixed(3)}]`);
  r.stats.forEach((s, i) => console.log(`       P${i + 1}: ${describe(s)}`));
  return ok;
}

const C = SETS[0].levels, Hd = SETS[1].levels;
const tokyo = { oneWay: 63, jitter: 25, loss: 0.01 };
const results = [
  scenario('LAN (5ms)', C, 0, { oneWay: 5, jitter: 2, loss: 0 }),
  scenario('Sydney-Tokyo (as measured)', C, 2, { ...tokyo, drift: 0.002 }),
  scenario('Sydney-Tokyo, guest starts 250ms late', C, 2, { ...tokyo, lateStart: 250 }),
  scenario('Sydney-Tokyo, guest on a 120Hz screen', C, 4, { ...tokyo, hz: 120 }),
  scenario('200ms round trip, 5% loss', C, 9, { oneWay: 100, jitter: 30, loss: 0.05, drift: 0.005 }),
  scenario('bad: 300ms rt, 20% loss, drift', Hd, 7, { oneWay: 150, jitter: 60, loss: 0.2, drift: 0.02 }),
  scenario('with a 600ms total outage', C, 2, { ...tokyo, outage: [20000, 20600] }),
  scenario('3 players, Sydney-Tokyo links', C, 2, { ...tokyo, players: 3, drift: 0.002 }),
  scenario('4 players, Sydney-Tokyo links', C, 8, { ...tokyo, players: 4, drift: 0.002, lateStart: 150 }),
  scenario('4 players, hard set', Hd, 11, { ...tokyo, players: 4 }),
  scenario('4 players, two guests cannot connect directly', C, 8, { ...tokyo, players: 4, noLink: [[2, 3]] }),
  scenario('4 players, guests only reach the host (star)', C, 8, { ...tokyo, players: 4, noLink: [[1, 2], [1, 3], [2, 3]] }),
  scenario('4 players, one on a slow link (+120ms)', C, 8, { ...tokyo, players: 4, slow: { player: 3, extra: 120 } }),
  scenario('4 players, bad: 20% loss + outage', C, 8, { oneWay: 100, jitter: 50, loss: 0.2, players: 4, outage: [30000, 30500] }),
];
process.exit(results.every(Boolean) ? 0 : 1);
