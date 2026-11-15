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

// The game in progress is counted as it goes (every few seconds, when the tab is hidden or
// closed, and when it ends), so quitting halfway or closing the tab loses nothing. `base`
// holds what has already been counted, so nothing is counted twice.
type Live = { s: State; mine: number[] } | null;
let live: () => Live = () => null;
let base = { players: [] as { pops: number; deaths: number; shots: number; picks: number }[], hist: 0 };
/** Tell the stats where to find the game being played (its confirmed state, online) and whose numbers are ours. */
export function watchGame(get: () => Live) { live = get; }

function commit() {
  const g = live();
  if (!g) return;
  const { s, mine } = g;
  for (const i of mine) {
    const p = s.players[i];
    if (!p) continue;
    const b = (base.players[i] ??= { pops: 0, deaths: 0, shots: 0, picks: 0 });
    life.pops += p.st.pops - b.pops;
    life.deaths += p.st.deaths - b.deaths;
    life.shots += p.st.shots - b.shots;
    life.picks += p.st.picks - b.picks;
    base.players[i] = { pops: p.st.pops, deaths: p.st.deaths, shots: p.st.shots, picks: p.st.picks };
  }
  if (s.mode !== 'versus') life.levelsCleared += s.hist.slice(base.hist).filter((h) => h[2] === 1).length;
  base.hist = s.hist.length;
}

/** Count what's happened so far and write it all to storage. */
export function saveNow() {
  commit();
  saveLife();
}

let unsaved = 0;
/** Count game time; saves every 10 s or so. */
export function addPlayTime(dt: number) {
  life.playSecs += dt;
  unsaved += dt;
  if (unsaved > 10) { unsaved = 0; saveNow(); }
}

export function gameStarted(online: boolean) {
  base = { players: [], hist: 0 };
  life.games++;
  if (online) life.onlineGames++;
  saveLife();
}

/** A game ended: count the rest of it. Call before the game is let go. */
export function gameEnded() {
  saveNow();
  base = { players: [], hist: 0 };
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
