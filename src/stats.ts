import { FLOORS, FLOOR_START } from './levels';
import { MODES } from './sim';
import type { State } from './sim';

// Lifetime stats, kept in this browser alongside the tower progress.
const KEY = 'splitstorm.stats.v1';

export interface Lifetime {
  /** Seconds spent in games (not paused, not in menus). */
  playSecs: number;
  games: number;
  onlineGames: number;
  pops: number;
  deaths: number;
  shots: number;
  /** Drops (weapons, shields, extra time...) picked up. */
  picks: number;
  levelsCleared: number;
  floorsCleared: number;
  /** Fastest clear of each floor in one run, in seconds (start of its first level to the end of its last), or 0. */
  bestFloor: number[];
  /** How many players and which mode that fastest clear was in. */
  bestFloorBy: string[];
}

const blank = (): Lifetime => ({ playSecs: 0, games: 0, onlineGames: 0, pops: 0, deaths: 0, shots: 0, picks: 0, levelsCleared: 0, floorsCleared: 0, bestFloor: FLOORS.map(() => 0), bestFloorBy: FLOORS.map(() => '') });

export const life: Lifetime = blank();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  for (const k of Object.keys(life) as (keyof Lifetime)[]) if (typeof saved[k] === typeof life[k]) (life as unknown as Record<string, unknown>)[k] = saved[k];
  while (life.bestFloor.length < FLOORS.length) { life.bestFloor.push(0); life.bestFloorBy.push(''); }
} catch { /* private window: stats last for this visit */ }

export function saveLife() {
  try { localStorage.setItem(KEY, JSON.stringify(life)); } catch { /* ignore */ }
}

let unsaved = 0;
/** Count game time; saves every 10 s or so. */
export function addPlayTime(dt: number) {
  life.playSecs += dt;
  unsaved += dt;
  if (unsaved > 10) { unsaved = 0; saveLife(); }
}

export function gameStarted(online: boolean) {
  life.games++;
  if (online) life.onlineGames++;
  saveLife();
}

/**
 * A game ended. `mine` lists the players at this screen: everyone in a local game, just
 * you online. Levels are counted once per game, not per player.
 */
export function gameEnded(s: State, mine: number[]) {
  for (const i of mine) {
    const p = s.players[i];
    if (!p) continue;
    life.pops += p.st.pops;
    life.deaths += p.st.deaths;
    life.shots += p.st.shots;
    life.picks += p.st.picks;
  }
  if (s.mode !== 'versus') life.levelsCleared += s.hist.filter((h) => h[2] === 1).length;
  saveLife();
}

/** The last level of tower floor `f` was just cleared in `s` (a tower game). */
export function floorCleared(s: State, f: number) {
  life.floorsCleared++;
  const lo = FLOOR_START[f], hi = lo + FLOORS[f].levels.length;
  // only a run that started on the floor's first level counts towards a best time
  if (!s.hist.some((h) => h[0] === lo)) { saveLife(); return; }
  let ticks = 0;
  for (const h of s.hist) if (h[0] >= lo && h[0] < hi) ticks += h[1];
  const secs = Math.round((ticks / 60) * 10) / 10;
  if (secs > 0 && (!life.bestFloor[f] || secs < life.bestFloor[f])) {
    life.bestFloor[f] = secs;
    life.bestFloorBy[f] = `${s.players.length === 1 ? 'solo' : `${s.players.length} players`}${s.mode === 'classic' ? '' : `, ${MODES.find((m) => m.id === s.mode)?.name ?? s.mode}`}`;
  }
  saveLife();
}

export const clock = (secs: number) => {
  const s = Math.floor(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const longTime = (secs: number) => {
  const m = Math.floor(secs / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};
