// Headless sanity check: a crude bot plays every level. Reports how many attempts it
// needed, checks the sim never produces NaN, and checks determinism (same seed, same result).
import { SETS } from '../src/levels';
import type { Level } from '../src/sim';
let LV: Level[] = SETS[0].levels;
import { H, IN_FIRE, IN_LEFT, IN_RIGHT, RADII, newGame, step } from '../src/sim';
import type { GameEvent, State } from '../src/sim';

declare const process: { exit(code: number): never };

// Lookahead bot: the sim is deterministic and its state is plain JSON, so we can clone it,
// try each action for a short horizon, and keep the one that survives and scores best.
// (The same snapshot/replay property is what rollback netcode will rely on.)
const ACTIONS = [IN_FIRE, IN_FIRE | IN_LEFT, IN_FIRE | IN_RIGHT, 0, IN_LEFT, IN_RIGHT];
// A plan maps ticks-from-now to an action. Besides "hold one action", the bot can
// "step k ticks one way, then stand and fire", which precise timing levels need.
type Plan = (t: number) => number;
const PLANS: Plan[] = [
  ...ACTIONS.map((a) => () => a),
  ...[IN_LEFT, IN_RIGHT].flatMap((d) => [1, 2, 3, 4, 5, 6].map((k) => (t: number) => (t < k ? d : IN_FIRE))),
];
const scratch: GameEvent[] = [];
let plan: Plan = () => IN_FIRE, planAt = 0;
function bot(s: State): number {
  if (s.phase !== 'play') return IN_FIRE;
  if (s.tick % 4 === 0) {
    let bestScore = -Infinity;
    for (const p of PLANS) {
      const c: State = JSON.parse(JSON.stringify(s));
      let score = 0;
      for (let t = 0; t < 50; t++) {
        step(c, [p(t)], LV, scratch);
        scratch.length = 0;
        if (c.phase === 'dead' || c.phase === 'over') { score = -1e6 + t * 1000; break; }
        if (c.phase !== 'play') { score += 1e5; break; }
      }
      score += c.score - s.score;
      // prefer standing roughly under the nearest ball
      let near = 1e9;
      for (const b of c.balls) near = Math.min(near, Math.abs(b.x - c.players[0].x) + (H - b.y) * 0.1 - RADII[b.size]);
      if (c.balls.length) score -= near * 0.05;
      if (score > bestScore) { bestScore = score; plan = p; planAt = s.tick; }
    }
  }
  return plan(s.tick - planAt);
}

function run(level: number, seed: number) {
  plan = () => IN_FIRE; planAt = 0; // the bot's own memory must not leak between runs
  const s = newGame(LV, 1, level, seed);
  const ev: GameEvent[] = [];
  let attempts = 1, ticks = 0;
  while (ticks++ < 60 * 60 * 30) {
    s.players[0].lives = 3;
    const before = s.phase;
    step(s, [bot(s)], LV, ev);
    ev.length = 0;
    if (before === 'play' && s.phase === 'dead') attempts++;
    if (s.level !== level || s.phase === 'won') return { cleared: true, attempts, ticks, score: s.score };
    for (const b of s.balls) if (!isFinite(b.x) || !isFinite(b.y)) throw new Error(`NaN ball on level ${level + 1}`);
    if (attempts > 60) break;
  }
  return { cleared: false, attempts, ticks, score: s.score };
}

let ok = true;
for (const set of SETS) {
  LV = set.levels;
  console.log(`--- ${set.name}`);
  LV.forEach((L, i) => {
    const a = run(i, 42), b = run(i, 42);
    const det = a.ticks === b.ticks && a.score === b.score && a.attempts === b.attempts;
    if (!det || !a.cleared) ok = false;
    console.log(`${String(i + 1).padStart(2)} ${L.name.padEnd(24)} ${a.cleared ? 'cleared' : 'NOT CLEARED'} attempts=${String(a.attempts).padStart(2)} deterministic=${det}`);
  });
}
process.exit(ok ? 0 : 1);
