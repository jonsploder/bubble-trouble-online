// Netcode check without a network: two RollbackSessions talk through a fake link with
// latency, jitter, packet loss and clock drift. Both must stay in sync (matching
// checksums of confirmed state) and keep making progress.
import { SETS } from '../src/levels';
import { RollbackSession } from '../src/rollback';
import type { InputMsg } from '../src/rollback';
import { newGame } from '../src/sim';

declare const process: { exit(code: number): never };

let seed = 99;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };

function scenario(name: string, levels: (typeof SETS)[0]['levels'], level: number, oneWayMs: number, jitterMs: number, loss: number, drift: number) {
  const queue: { at: number; to: number; m: InputMsg }[] = [];
  let now = 0;
  const mk = (me: number) => new RollbackSession(levels, me, newGame(levels, 2, level, 777), (m) => {
    if (rnd() < loss) return;
    queue.push({ at: now + (oneWayMs + rnd() * jitterMs) / (1000 / 60), to: 1 - me, m: JSON.parse(JSON.stringify(m)) });
  });
  const ses = [mk(0), mk(1)];
  const held = [0, 0];
  let maxAhead = 0, stalls = 0;
  const TICKS = 60 * 90;
  for (now = 0; now < TICKS; now++) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].at <= now) { ses[queue[i].to].receive(queue[i].m); queue.splice(i, 1); }
    }
    for (let p = 0; p < 2; p++) {
      if (rnd() < 0.08) held[p] = Math.floor(rnd() * 8); // twitchy random player
      if (p === 1 && rnd() < drift) continue; // player 2's clock runs slow
      ses[p].tick(held[p]);
      maxAhead = Math.max(maxAhead, ses[p].frame - ses[p].confirmedFrame);
      if (ses[p].stalled) stalls++;
    }
  }
  let compared = 0, mismatched = 0;
  for (const [f, sum] of ses[0].sums) {
    const other = ses[1].sums.get(f);
    if (other === undefined) continue;
    compared++;
    if (other !== sum) mismatched++;
  }
  const progress = Math.min(ses[0].confirmedFrame, ses[1].confirmedFrame) / TICKS;
  const gap = Math.abs(ses[0].frame - ses[1].frame);
  const ok = !ses[0].desync && !ses[1].desync && mismatched === 0 && compared > 5 && progress > 0.9 && gap < 12;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} checks=${compared} mismatched=${mismatched} progress=${(progress * 100).toFixed(0)}% maxRollback=${maxAhead}f frameGap=${gap} stalledTicks=${stalls} phase=${ses[0].confirmed.phase} level=${ses[0].confirmed.level + 1}`);
  return ok;
}

const C = SETS[0].levels, Hd = SETS[1].levels;
const results = [
  scenario('LAN (5ms)', C, 0, 5, 2, 0, 0),
  scenario('Sydney-Tokyo (70ms one way)', C, 2, 70, 15, 0.02, 0.002),
  scenario('200ms round trip, 5% loss', C, 9, 100, 30, 0.05, 0.005),
  scenario('bad: 300ms rt, 20% loss, drift', Hd, 7, 150, 60, 0.2, 0.02),
  scenario('hard set, gravity flip + wind', Hd, 11, 70, 15, 0.02, 0.002),
];
process.exit(results.every(Boolean) ? 0 : 1);
