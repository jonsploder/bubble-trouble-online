// Level balance report. The smoke-test bot has perfect reflexes, so "it cleared it" says
// nothing about difficulty. This plays each level with a deliberately human-like bot:
// it reacts late, misjudges where balls are, and re-plans only a few times a second.
//
//   npm run balance                  every set
//   npm run balance -- twists        one set (by id)
//   npm run balance -- twists 30     more attempts per level (default 16)
//
// Calibrated against real play data (see README): the three portal intro levels were
// cleared first try, the original Triplets / Quadruplets / Butterfingers almost never.
// Read the clear rate as "a decent player, per attempt (one life)".
import { SETS } from '../src/levels';
import { H, IN_FIRE, IN_LEFT, IN_RIGHT, RADII, levelAt, newGame, step } from '../src/sim';
import type { GameEvent, Level, State } from '../src/sim';

/** The human model. */
const HUMAN = {
  react: 8, // ticks between deciding and the hands doing it
  every: 6, // ticks between decisions
  horizon: 60, // how far ahead it imagines (ticks)
  jitter: 4, // px error in where it thinks each ball is
  slip: 0.02, // chance a decision is just a random move
  caution: 120, // how much it dislikes a ball passing within 16 px, per tick
  eager: 900, // how much it wants each pop
  sloppy: 2, // key presses and releases land up to this many ticks late
};
declare const process: { argv: string[]; exit(code: number): never; env: Record<string, string | undefined> };
for (const kv of (process.env.HUMAN ?? '').split(',')) { const [k, v] = kv.split('='); if (k && v) (HUMAN as Record<string, number>)[k] = +v; }

type Plan = (t: number) => number;
const ACTIONS = [IN_FIRE, IN_FIRE | IN_LEFT, IN_FIRE | IN_RIGHT, 0, IN_LEFT, IN_RIGHT];
const PLANS: Plan[] = [
  ...ACTIONS.map((a) => () => a),
  ...[IN_LEFT, IN_RIGHT].flatMap((d) => [2, 4, 6].map((k) => (t: number) => (t < k ? d : IN_FIRE))),
];
const scratch: GameEvent[] = [];

function attempt(levels: Level[], level: number, seed: number) {
  let r = seed * 2654435761 >>> 0;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  const s = newGame(levels, 1, level, seed);
  let plan: Plan = () => 0, planAt = 0;
  let next: { plan: Plan; at: number } | null = null;
  let portals = 0, shave = 0, hands = 0, lateUntil = -1;
  const ev: GameEvent[] = [];
  while (s.phase === 'ready' || s.phase === 'play') {
    if (next && s.tick >= next.at) { plan = next.plan; planAt = next.at; next = null; }
    if (s.phase === 'play' && s.tick % HUMAN.every === 0 && !next) {
      let best = -Infinity, pick: Plan = plan;
      if (rnd() < HUMAN.slip) pick = PLANS[Math.floor(rnd() * PLANS.length)];
      else {
        // what it believes the world looks like
        const view: State = JSON.parse(JSON.stringify(s));
        for (const b of view.balls) { b.x += (rnd() - 0.5) * 2 * HUMAN.jitter; b.y += (rnd() - 0.5) * 2 * HUMAN.jitter; }
        const snapshot = JSON.stringify(view);
        for (const p of PLANS) {
          const c: State = JSON.parse(snapshot);
          let score = 0;
          for (let t = 0; t < HUMAN.horizon; t++) {
            // hands keep doing the old thing until the new decision lands
            step(c, [t < HUMAN.react ? plan(c.tick - planAt) : p(t - HUMAN.react)], levels, scratch);
            scratch.length = 0;
            if (c.phase === 'dead' || c.phase === 'over') { score = -1e6 + t * 1000; break; }
            if (c.phase !== 'play') { score += 1e5; break; }
          }
          // points, plus a real pull toward making progress (so it will risk stepping under a ball), minus fear of near misses
          score += c.score - view.score + HUMAN.eager * (c.players[0].st.pops - view.players[0].st.pops) - HUMAN.caution * (c.players[0].st.danger - view.players[0].st.danger);
          // a person knows the beam, the pulse gun and haste are bad news and steers round them
          const me = c.players[0], was = view.players[0];
          if ((me.weapon === 'beam' || me.weapon === 'pulse') && me.weapon !== was.weapon) score -= 400;
          if (me.haste > was.haste) score -= 400;
          let near = 1e9;
          for (const b of c.balls) near = Math.min(near, Math.abs(b.x - c.players[0].x) + (H - b.y) * 0.1 - RADII[b.size]);
          if (c.balls.length) score -= near * 0.05;
          if (score > best) { best = score; pick = p; }
        }
      }
      next = { plan: pick, at: s.tick + HUMAN.react };
    }
    // sloppy hands: a change of keys lands a few ticks late
    const want = s.phase === 'play' ? plan(s.tick - planAt) : 0;
    if (want !== hands && lateUntil < 0) lateUntil = s.tick + Math.floor(rnd() * (HUMAN.sloppy + 1));
    if (lateUntil >= 0 && s.tick >= lateUntil) { hands = want; lateUntil = -1; }
    step(s, [hands], levels, ev);
    for (const e of ev) if (e.t === 'portal') portals++;
    ev.length = 0;
  }
  shave = s.players[0].st.danger;
  const timedOut = s.phase === 'dead' && s.timeLeft <= 0;
  return { cleared: s.phase === 'clear', secs: s.lt / 60, timedOut, portals, danger: shave / 60, pops: s.players[0].st.pops };
}

/** Standing still for the first 1.2 seconds of play must be safe, for 1 to 4 players. */
function fairStart(levels: Level[], level: number): string {
  for (let n = 1; n <= 4; n++) {
    const s = newGame(levels, n, level, 7);
    for (let t = 0; t < 100 + 72; t++) step(s, [0, 0, 0, 0], levels, scratch);
    scratch.length = 0;
    const hit = s.players.findIndex((p) => p.down);
    if (hit >= 0) return `UNFAIR START (player ${hit + 1} of ${n})`;
  }
  return '';
}

/** Pops needed to clear a level if nothing is lost to the roof. */
function popsNeeded(L: Level): number {
  const count = (size: number, split: number): number => (size === 0 ? 1 : 1 + split * count(size - 1, split));
  return L.balls.reduce((a, b) => a + count(b.size, b.split ?? L.split ?? 2) + (b.armor ?? 0), 0);
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

const args = process.argv.slice(2);
const only = args.find((a) => /^[a-z]+$/.test(a));
const pickLevels = (args.find((a) => /^[\d,]+$/.test(a) && a.includes(',')) ?? '').split(',').filter(Boolean).map(Number);
const N = +(args.find((a) => /^\d+$/.test(a)) ?? 16);
let bad = 0;
for (const set of SETS) {
  if (only && set.id !== only) continue;
  console.log(`\n=== ${set.name}: ${N} attempts per level, human-like bot, one life each`);
  console.log(' #  level                 pops  limit  cleared  clear time  died at (median)  timeouts  portal trips  notes');
  set.levels.forEach((_, i) => {
    if (pickLevels.length && !pickLevels.includes(i + 1)) return;
    const s0 = newGame(set.levels, 1, i, 1), L = levelAt(s0, set.levels);
    const runs = Array.from({ length: N }, (_, k) => attempt(set.levels, i, 100 + k * 17));
    const won = runs.filter((x) => x.cleared), lost = runs.filter((x) => !x.cleared);
    const quick = lost.filter((x) => x.secs < 4).length;
    const notes = [fairStart(set.levels, i), quick >= Math.max(2, N / 5) ? `${quick} deaths in the first 4 s` : ''].filter(Boolean);
    if (notes.some((n) => n.startsWith('UNFAIR'))) bad++;
    if (L.balls.some((b) => b.still)) notes.push('has on-the-spot bouncers: this bot badly underrates people here');
    const usesPortals = L.portals || L.chain;
    console.log(
      `${String(i + 1).padStart(2)}  ${L.name.padEnd(20)} ${String(popsNeeded(L)).padStart(5)}  ${String(L.time).padStart(4)}s  ${String(Math.round((100 * won.length) / N)).padStart(5)}%  ` +
      `${(won.length ? median(won.map((x) => x.secs)).toFixed(0) + ' s' : '-').padStart(9)}  ${(lost.length ? median(lost.map((x) => x.secs)).toFixed(0) + ' s' : '-').padStart(15)}  ` +
      `${String(lost.filter((x) => x.timedOut).length).padStart(8)}  ${(usesPortals ? (runs.reduce((a, x) => a + x.portals, 0) / N).toFixed(1) : '').padStart(12)}  ${notes.join('; ')}`);
  });
}
process.exit(bad ? 1 : 0);
