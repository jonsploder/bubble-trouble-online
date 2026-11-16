// Replays the local (same-computer) games recorded in stats/levels/ and checks they reproduce.
// A local game's record holds its seed and every key change, so today's game code should play
// it out to exactly the attempts that were recorded. Records from other game versions will
// usually differ (the levels or rules changed): replay those with that version's code.
//
//   npm run solo            every record in stats/levels/
//   npm run solo -- <dir>   records in another folder
import { SETS } from '../src/levels';
import { newGame, step } from '../src/sim';
import type { GameEvent, Mode } from '../src/sim';

declare function require(name: string): any;
declare const process: { argv: string[] };
const fs = require('fs'), path = require('path');

export interface SoloRec { id: string; version: number; set: string; players: number; mode: string; online: boolean; hist: number[][]; seed?: number; start?: number; steps?: number; inp?: string[] }

/** Unpack one player's keys: the bits held at every step. */
export function unpack(text: string, steps: number): number[] {
  const out = new Array<number>(steps).fill(0);
  let at = 0, last = 0, bits = 0;
  for (const m of text.matchAll(/([0-9a-z]+)([A-P])/g)) {
    at += parseInt(m[1], 36);
    for (let k = last; k < Math.min(at, steps); k++) out[k] = bits;
    last = at;
    bits = m[2].charCodeAt(0) - 65;
  }
  for (let k = last; k < steps; k++) out[k] = bits;
  return out;
}

/** Play a recorded local game through the current game code. `each` sees every step. */
export function replay(r: SoloRec, each?: (s: ReturnType<typeof newGame>, inp: number[], ev: GameEvent[]) => void) {
  const levels = SETS.find((x) => x.id === r.set)!.levels;
  const s = newGame(levels, r.players, r.start!, r.seed!, r.mode as Mode);
  const keys = r.inp!.map((t) => unpack(t, r.steps!)), ev: GameEvent[] = [];
  for (let k = 0; k < r.steps!; k++) {
    const inp = keys.map((a) => a[k]);
    step(s, inp, levels, ev);
    each?.(s, inp, ev);
    ev.length = 0;
  }
  return s;
}

const dir = process.argv[2] ?? path.join('stats', 'levels');
const byVersion = new Map<number, { n: number; same: number; mins: number }>();
let without = 0;
for (const f of fs.readdirSync(dir).sort()) {
  let r: SoloRec;
  try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!r.inp || r.seed === undefined) { without++; continue; }
  const s = replay(r);
  // the record's last entry may be a "gave up" marker (result 2) that the game itself never logs
  const want = JSON.stringify(r.hist.filter((h) => h[2] !== 2)), got = JSON.stringify(s.hist);
  const v = byVersion.get(r.version) ?? { n: 0, same: 0, mins: 0 };
  v.n++; v.mins += r.steps! / 3600; if (want === got) v.same++;
  byVersion.set(r.version, v);
}
console.log(`${without} records without keys (online games, or from before solo games were recorded).`);
if (!byVersion.size) console.log('No recorded local games yet.');
for (const [v, x] of [...byVersion].sort((a, b) => a[0] - b[0])) console.log(`version ${v}: ${x.n} local games, ${x.mins.toFixed(0)} minutes; ${x.same} replay exactly with today's code`);
