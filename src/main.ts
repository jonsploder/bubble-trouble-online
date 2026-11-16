import { applyVolume, playEvents, setMusic, unlockAudio, volumeBlip } from './audio';
import { TRACKS } from './music';
import { ACTIONS, RESERVED, VOL_MAX, bind, controlsLine, isBound, keyName, resetKeys, saveSettings, settings } from './settings';
import { FLOORS, FLOOR_START, SETS, TOWER, TOWER_SET } from './levels';
import { addPlayTime, floorCleared, gameEnded, gameStarted, life, saveNow, watchGame } from './stats';
import { MAX_PLAYERS, hostRoom, joinRoom } from './net';
import type { Room, RosterEntry } from './net';
import { AWARD_UI, RESULTS_BTN_Y, CLOSE_BTN, LOBBY_Y, MENU_Y, VIEW_H, VIEW_W, TOWER_UI, drawGame, drawLobby, drawMenu, drawResults, drawRotate, drawSettings, drawStats, drawTower, SET_UI, STATS_UI, fxEvents, setTouch } from './render';
import { INPUT_DELAY, RollbackSession } from './rollback';
import type { InputMsg, PeerLog } from './rollback';
import { DT, IN_FIRE, IN_LEFT, IN_PAUSE, IN_RIGHT, MODES, levelAt, newGame, step } from './sim';
import type { GameEvent, Level, Mode, State } from './sim';

/** All players must run the same build: the sim and level data have to match exactly. */
const VERSION = 19;
/** Trace collector (see worker/). Empty = don't upload. The dev server never uploads, so test games stay out of the data. */
const TRACE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_TRACE_URL ?? '').replace(/\/$/, '');
const PLAY_MODES = ['1 player', '2 players (same keyboard)', 'Host online game', 'Join online game'];

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize() {
  const scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${VIEW_W * scale}px`;
  canvas.style.height = `${VIEW_H * scale}px`;
  canvas.width = Math.round(VIEW_W * scale * dpr);
  canvas.height = Math.round(VIEW_H * scale * dpr);
  ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// ---------------------------------------------------------------- state
type Screen = 'menu' | 'tower' | 'lobby' | 'game' | 'results' | 'stats' | 'settings';
let screen: Screen = 'menu';
let levels: Level[] = TOWER;
let game: State | null = null; // local play
let session: RollbackSession | null = null; // online play
let sessionT0 = 0;
let gameSet = TOWER_SET; // level set of the local game
let practice = false; // the local game started mid-floor: it saves no progress
/** End-of-game stats being shown, and where to go after. */
let results: { s: State; set: number; you: number; online: boolean } | null = null;
let pausePulse = false; // send IN_PAUSE on the next tick
const keys = new Set<string>();
// One of these shows under the title, a different one each time the menu comes back.
const SLOGANS = [
  'Pop responsibly', 'Divide and be conquered', 'Split happens', 'Pop culture', 'Breaking up is easy', 'Have a ball',
  'Ballpark estimate: too many', "You'll bounce back from this", 'Burst your bubble', 'Enter the ball of fame', "Pop 'til you drop",
];
// PROVISIONAL music plan until the tracks are chosen: floors take turns with the level
// tracks, the last level of a floor gets a boss track, menus are silent. On the settings
// screen the music slider plays a track so the volume can be heard.
const LEVEL_TRACKS = ['skyline', 'nightshift2', 'hopskip', 'neontide', 'glass', 'backalley', 'circuit', 'updraft', 'sugarrush2', 'paperplanes', 'lowtide', 'sunday', 'nightbus', 'confetti'];
const BOSS_TRACKS = ['showdown', 'curtain', 'undertow', 'redalert2', 'slowburn', 'meltdown2', 'nowayout'];
/** Each game starts the rotation somewhere else (from its seed, so online players hear the same), so every track gets heard. */
let musicShift = 0;
/** The corner line naming the track, while music is on. */
const nowPlaying = () => { const t = settings.music ? TRACKS.find((x) => x.id === musicFor()) : null; return t ? [`♪ ${t.name}`] : []; };
function musicFor(): string | null {
  if (screen === 'settings') return set.row === 1 ? LEVEL_TRACKS[0] : null;
  const s = screen === 'game' ? (session ? session.predicted : game) : null;
  if (!s || s.phase === 'over' || s.phase === 'won') return null;
  if (s.mode === 'versus') return 'sugarrush';
  const L = levelAt(s, levels), f = (L.floor ?? 1) - 1;
  const last = !!L.floor && levels[s.level + 1]?.floor !== L.floor;
  if (last && s.phase === 'clear') return null; // the floor fanfare plays alone
  return last ? BOSS_TRACKS[(f + musicShift) % BOSS_TRACKS.length] : LEVEL_TRACKS[(f + musicShift) % LEVEL_TRACKS.length];
}
let overT = 0;
const OVER_SECS = 2.5;
let slogan = Math.floor(Math.random() * SLOGANS.length), lastScreen = '';
const nextSlogan = () => { slogan = (slogan + 1 + Math.floor(Math.random() * (SLOGANS.length - 1))) % SLOGANS.length; };
const menu = { floor: 0, level: 0, gmode: 0, mode: 0, row: 0, t: 0 }; // floor/level: the tower pick; gmode: game mode (MODES), mode: how to play (PLAY_MODES)

// ---------------------------------------------------------------- progress
// One number, kept in this browser: the highest tower level ever reached. A floor is unlocked
// once its first level has been reached; a level's name shows once the level has been seen.
// Saved as the level's name, so adding levels to the tower doesn't move anyone's place.
const SAVE_KEY = 'splitstorm.tower.v2';
/** Before v2 the save was a position in the tower as it was before Photo Finish was added. */
const OLD_SAVE_KEY = 'splitstorm.tower.v1', V1_TOWER = TOWER.filter((L) => L.name !== 'Photo Finish');
let reach = 0;
try {
  const name = localStorage.getItem(SAVE_KEY) ?? V1_TOWER[Math.floor(+(localStorage.getItem(OLD_SAVE_KEY) ?? 0)) || 0]?.name;
  reach = Math.max(0, TOWER.findIndex((L) => L.name === name));
} catch { /* private window: progress lasts for this visit */ }
const floorOf = (level: number) => (TOWER[level]?.floor ?? 1) - 1;
function reached(s: State) {
  if (s.mode === 'versus' || s.level <= reach || s.level >= TOWER.length) return;
  reach = s.level;
  try { localStorage.setItem(SAVE_KEY, TOWER[reach].name); } catch { /* ignore */ }
}
/** HUD label: floor, and how far up it. */
function where(s: State): string {
  const f = floorOf(s.level);
  return levels === TOWER ? `${f + 1} · ${s.level - FLOOR_START[f] + 1}/${FLOORS[f].levels.length}` : `${s.level + 1}/${levels.length}`;
}

/** `seats` lists who is playing, in player order; `wait` is how long the recipient should hold off before starting. */
type StartMsg = { t: 'start'; v: number; gid: number; set: number; level: number; gm: Mode; seed: number; seats: number[]; wait: number };
type LobbyStatus = 'opening' | 'waiting' | 'enter' | 'connecting' | 'connected' | 'error';
type Msg = { t: string } & Record<string, unknown>;
interface TraceMeta { version: number; gid: number; set: number; level: number; seed: number; date: string; inputDelay: number; players: number; mode: Mode }

const net = {
  role: 'host' as 'host' | 'guest',
  room: null as Room | null,
  code: '',
  typed: '',
  status: 'opening' as LobbyStatus,
  msg: '',
  copied: false,
  seat: 0, // our seat in the room; the host is always seat 0
  roster: [] as RosterEntry[], // the guests in the room
  rtt: {} as Record<number, number>, // host: round trip to each guest seat; guest: to the host (seat 0)
  row: 0, // host's selected settings row in the lobby
  hostFloor: 0, // guest's view of what the host has picked
  floors: {} as Record<number, number>, // floor each seat has reached; the party can start no higher than the lowest
  hostMode: 0,
  gid: 0,
  lastGid: -1,
  pendingGid: -1,
  aborted: -1, // host: a start that was called off before it began
  /** Host: a start being offered. Repeated to each guest until they answer. */
  start: null as { msg: StartMsg; at: number; waiting: Set<number> } | null,
  seats: [] as number[], // seats in the current game; position = player number
  me: 0, // our player number in the current game
  meta: null as TraceMeta | null,
};

// ---------------------------------------------------------------- online
function inviteLink(): string {
  return `${location.origin}${location.pathname}#${net.code}`;
}

function closeRoom() {
  net.room?.close();
  net.room = null;
  session = null;
  net.start = null;
  net.roster = [];
  net.rtt = {};
  net.floors = {};
}

function fail(reason: string) {
  closeRoom();
  screen = 'lobby';
  net.status = 'error';
  net.msg = reason;
}

function handlers() {
  let mine: Room | null = null;
  queueMicrotask(() => { mine = net.room; });
  const live = () => mine !== null && mine === net.room;
  return {
    onReady: (code: string) => { if (live()) { net.code = code; net.status = net.room!.seats().length ? 'connected' : 'waiting'; } },
    onLink: (seat: number, up: boolean) => { if (live()) onLink(seat, up); },
    onData: (seat: number, m: unknown) => { if (live()) onMessage(seat, m as Msg); },
    onClose: (reason: string) => { if (live()) fail(reason); },
  };
}

function onLink(seat: number, up: boolean) {
  const room = net.room!;
  if (net.role === 'host') {
    net.roster = room.roster();
    if (!up) { delete net.rtt[seat]; delete net.floors[seat]; }
    if (net.code) net.status = room.seats().length ? 'connected' : 'waiting';
    // someone in the current game dropped out: it can't continue without their inputs
    if (!up && session && net.seats.includes(seat)) endSession();
    if (!up && net.start && !session) { net.aborted = net.start.msg.gid; net.start = null; room.setOpen(true); } // start was pending: call it off
  } else if (seat === 0 && up) {
    net.status = 'connected';
  }
}

/** Pass `keepCode` to reopen the room under its existing code, so invite links already sent still work. */
function openHost(keepCode = '') {
  closeRoom();
  Object.assign(net, { role: 'host', status: 'opening', code: keepCode, msg: '', copied: false, seat: 0, row: 0 });
  screen = 'lobby';
  net.room = hostRoom(handlers(), keepCode);
}

function openJoin(code = '') {
  closeRoom();
  Object.assign(net, { role: 'guest', status: 'enter', typed: code.toUpperCase(), msg: '', seat: 0 });
  screen = 'lobby';
  if (code.length === 4) connectJoin();
}

function connectJoin() {
  net.status = 'connecting';
  net.code = net.typed;
  net.room = joinRoom(net.typed, handlers());
}

function beginSession(m: StartMsg) {
  const room = net.room;
  const me = m.seats.indexOf(net.seat);
  if (!room || me < 0 || session) return;
  levels = SETS[m.set].levels;
  musicShift = m.seed % 97;
  net.lastGid = m.gid;
  net.seats = m.seats;
  net.me = me;
  net.meta = { version: VERSION, gid: m.gid, set: m.set, level: m.level, seed: m.seed, date: new Date().toISOString(), inputDelay: INPUT_DELAY, players: m.seats.length, mode: m.gm };
  session = new RollbackSession(levels, me, newGame(levels, m.seats.length, m.level, m.seed, m.gm), (to, msg) => room.send(m.seats[to], { ...msg, gid: m.gid }));
  sessionT0 = performance.now();
  gameStarted(true);
  acc = 0;
  pausePulse = false;
  screen = 'game';
  keys.clear();
}

/** Host: the highest floor everyone in the room has reached. A guest we haven't heard from yet counts as floor 1. */
function partyFloor(): number {
  return Math.min(floorOf(reach), ...(net.room?.seats() ?? []).map((g) => net.floors[g] ?? 0));
}
/** The floor each player has reached, in seat order. */
function partyFloors(): number[] {
  return [floorOf(reach), ...(net.room?.seats() ?? []).sort((a, b) => a - b).map((g) => net.floors[g] ?? 0)];
}

// Start handshake, so everyone begins at (nearly) the same moment. The host picks a moment
// a little in the future and tells each guest how long to wait, allowing for how long the
// message takes to reach them. The message is repeated until the guest answers 'go'.
function hostStart() {
  const room = net.room;
  if (!room || net.start || session) return;
  const guests = room.seats().sort((a, b) => a - b);
  if (!guests.length) return;
  const lead = Math.max(...guests.map((g) => (net.rtt[g] ?? 150) / 2)) + 60;
  const msg: StartMsg = { t: 'start', v: VERSION, gid: ++net.gid, set: TOWER_SET, level: FLOOR_START[Math.min(menu.floor, partyFloor())], gm: MODES[menu.gmode].id, seed: (Date.now() & 0x7fffffff) | 1, seats: [0, ...guests], wait: 0 };
  net.start = { msg, at: performance.now() + lead, waiting: new Set(guests) };
  room.setOpen(false);
  offerStart();
  setTimeout(() => { if (net.aborted !== msg.gid) beginSession(msg); }, lead);
}

function offerStart() {
  const st = net.start;
  if (!st || !net.room) return;
  for (const g of st.waiting) {
    net.room.send(g, { ...st.msg, wait: Math.max(0, st.at - performance.now() - (net.rtt[g] ?? 150) / 2) });
  }
}

/** Leave the current online game; everyone sees their stats, then ends up back in the lobby. */
function endSession() {
  if (session && net.meta) {
    uploadLog(net.meta, net.me, session.finish());
    reached(session.confirmed);
    uploadLevels(session.confirmed, net.meta.set, true);
    showResults(session.confirmed, net.meta.set, net.me, true);
  } else screen = 'lobby';
  session = null;
  net.start = null;
  net.room?.setOpen(true);
  if (net.role === 'host') net.status = net.room?.seats().length ? 'connected' : 'waiting';
  else net.status = 'connected';
}

function showResults(s: State, set: number, you: number, online: boolean) {
  results = { s: JSON.parse(JSON.stringify(s)), set, you, online };
  gameEnded();
  awardHelp = -1;
  screen = 'results';
  keys.clear();
}

/** Where Esc on the results screen goes: the lobby online, the floor picker after a tower run, else the menu. */
function resultsBack(): Screen {
  if (results?.online && net.room) return 'lobby';
  return results && results.set === TOWER_SET && results.s.mode !== 'versus' ? 'tower' : 'menu';
}

function closeResults() {
  screen = resultsBack();
  if (!results?.online) { menu.floor = startFloor(); menu.level = 0; } // online, the host's lobby pick stays
  results = null;
}

/** Play the same thing again: same start level, players and mode. Local games only. */
function playAgain() {
  results = null;
  startLocal(lastStart);
}

// The floor this player picked to start from, remembered until the page is closed or reloaded
// (never saved: a fresh visit starts at the highest floor reached). -1 = follow the highest.
let chosenFloor = -1;
const startFloor = () => (chosenFloor >= 0 ? Math.min(chosenFloor, floorOf(reach)) : floorOf(reach));

/** Report how each attempt at each level went, for the difficulty report. One upload per game. */
function uploadLevels(s: State, set: number, online: boolean, leaving = false) {
  if (!TRACE_URL || (online && net.me !== 0)) return; // online, player 1 speaks for everyone
  const body = levelRecord(s, set, online);
  // `keepalive` lets the upload finish while the page is closing
  if (body) fetch(`${TRACE_URL}/levels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: leaving }).catch(() => {});
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** The keys held through a local game, so it can be replayed exactly later: per player, [step, bits] at each change. */
let rec: { id: string; seed: number; start: number; n: number; inp: number[][]; last: number[] } | null = null;
/** Changes as text: the gap in steps since the last change (base 36), then a letter A-P for the keys held (A = none). */
const packInputs = (a: number[]) => {
  let out = '', prev = 0;
  for (let i = 0; i < a.length; i += 2) { out += (a[i] - prev).toString(36) + String.fromCharCode(65 + a[i + 1]); prev = a[i]; }
  return out;
};

/** What gets uploaded about one game: every attempt at every level, and for local games the seed and keys to replay it. */
function levelRecord(s: State, set: number, online: boolean): string | null {
  if (s.mode === 'versus') return null; // versus arenas aren't levels
  const hist = s.hist.slice();
  if (s.phase === 'play' && s.lt > 300) hist.push([s.level, s.lt, 2, s.lost]); // gave up mid-attempt
  const base = { format: 'splitstorm-levels', v: 1, id: !online && rec ? rec.id : newId(), version: VERSION, set: SETS[set].id, players: s.players.length, mode: s.mode, online, hist };
  if (online || !rec) return hist.length ? JSON.stringify(base) : null;
  if (rec.n < 300) return null; // under 5 seconds: nothing to learn
  if (!hist.length) hist.push([s.level, s.lt, 2, s.lost]); // the collector wants at least one entry
  const full = JSON.stringify({ ...base, seed: rec.seed, start: rec.start, steps: rec.n, inp: rec.inp.map(packInputs) });
  return full.length < 60000 ? full : JSON.stringify(base); // the collector takes 64 KB: a very long game keeps its results and drops the keys
}

/** Send our part of a finished game's log to the trace collector. Best effort, never blocks play. */
function uploadLog(meta: TraceMeta, me: number, log: PeerLog) {
  if (!TRACE_URL || log.tick.length < 300) return; // skip games under ~5 seconds
  const sid = `${net.code}-${meta.seed}-${meta.gid}`; // same for every player
  fetch(`${TRACE_URL}/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'splitstorm-half', v: 1, sid, role: `p${me}`, meta, log }),
  }).catch(() => {});
}

function onMessage(seat: number, m: Msg) {
  const room = net.room;
  if (!room) return;
  switch (m.t) {
    case 'ping': // host -> guest, while the host is in the lobby
      if (net.role !== 'guest' || seat !== 0) break;
      room.send(0, { t: 'pong', ts: m.ts });
      net.hostFloor = (m.floor as number) ?? 0;
      net.floors = Object.fromEntries(((m.floors as number[]) ?? []).map((f, i) => [i, f]));
      net.hostMode = (m.gm as number) ?? 0;
      net.seat = m.you as number;
      net.roster = m.players as RosterEntry[];
      room.setRoster(net.seat, net.roster);
      // The host is back in the lobby but we are still in its latest game: that game is over.
      if (session && m.gid === net.lastGid) endSession();
      break;
    case 'gping': // guest -> host, while the guest is in the lobby
      if (net.role !== 'host') break;
      room.send(seat, { t: 'pong', ts: m.ts });
      net.floors[seat] = Math.max(0, Math.min(FLOORS.length - 1, (m.floor as number) | 0));
      menu.floor = Math.min(menu.floor, partyFloor());
      // A player in our current game is sitting in the lobby: they quit, so the game ends.
      if (session && m.left === net.lastGid && net.seats.includes(seat)) endSession();
      break;
    case 'pong':
      net.rtt[seat] = Math.round(performance.now() - (m.ts as number));
      break;
    case 'start': {
      const s = m as unknown as StartMsg;
      if (net.role !== 'guest' || seat !== 0) break;
      if (s.v !== VERSION) { fail('You and the host are on different versions. Everyone refresh the page.'); break; }
      room.send(0, { t: 'go', gid: s.gid });
      if (s.gid === net.lastGid || s.gid === net.pendingGid) break; // a repeat
      net.pendingGid = s.gid;
      setTimeout(() => { if (net.pendingGid === s.gid && net.room === room) beginSession(s); }, s.wait);
      break;
    }
    case 'go':
      if (net.start && m.gid === net.start.msg.gid) {
        net.start.waiting.delete(seat);
        if (!net.start.waiting.size) net.start = null;
      }
      break;
    case 'in':
      if (session && m.gid === net.lastGid) session.receive(net.seats.indexOf(seat), m as unknown as InputMsg, performance.now() - sessionT0);
      break;
  }
}

// Unreliable channels: keep repeating the things that must arrive.
let beat = 0;
setInterval(() => {
  const room = net.room;
  if (!room) return;
  beat++;
  offerStart();
  if ((screen !== 'lobby' && screen !== 'results') || beat % 4 || net.start) return;
  if (net.role === 'host') {
    const players = room.roster();
    for (const g of room.seats()) room.send(g, { t: 'ping', ts: performance.now(), floor: Math.min(menu.floor, partyFloor()), floors: partyFloors(), gm: menu.gmode, you: g, players, gid: net.gid });
  } else {
    room.send(0, { t: 'gping', ts: performance.now(), left: net.lastGid, floor: floorOf(reach) });
  }
}, 100);

// ---------------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Backspace'].includes(e.code) || (screen === 'game' && isBound(e.code)) || (screen === 'settings' && set.capture)) e.preventDefault();
  unlockAudio();
  if (screen === 'settings' && e.repeat && set.row <= 1 && !set.capture) { settingsKey(e.code); return; } // hold to slide the volume
  if (e.repeat) return;
  keys.add(e.code);
  if (screen === 'menu') menuKey(e.code);
  else if (screen === 'settings') settingsKey(e.code);
  else if (screen === 'stats') {
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') statsScroll += (e.code === 'ArrowDown' ? 1 : -1) * STATS_UI.rowH;
    else if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'KeyS' || e.code === 'Space') screen = 'menu';
  }
  else if (screen === 'tower') towerKey(e.code);
  else if (screen === 'lobby') lobbyKey(e.code);
  else if (screen === 'results') {
    if (results && !results.online && (e.code === 'Enter' || e.code === 'Space')) playAgain();
    else if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') closeResults();
  }
  else gameKey(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let lastStart = 0;
function startLocal(level: number) {
  lastStart = level;
  levels = TOWER;
  gameSet = TOWER_SET;
  practice = level !== FLOOR_START[floorOf(level)];
  const seed = (Date.now() & 0x7fffffff) | 1, n = menu.mode + 1;
  game = newGame(levels, n, level, seed, MODES[menu.gmode].id);
  musicShift = seed % 97;
  rec = { id: newId(), seed, start: level, n: 0, inp: Array.from({ length: n }, () => []), last: new Array<number>(n).fill(0) };
  gameStarted(false);
  acc = 0;
  pausePulse = false;
  screen = 'game';
  keys.clear();
}

function menuKey(code: string) {
  if (code === 'KeyS') { openStats(); return; }
  if (code === 'ArrowUp') menu.row = (menu.row + 3) % 4;
  if (code === 'ArrowDown') menu.row = (menu.row + 1) % 4;
  if ((code === 'Enter' || code === 'Space') && menu.row >= 2) {
    if (menu.row === 2) { set.row = 0; set.col = 0; set.capture = false; screen = 'settings'; }
    else openStats();
    return;
  }
  const d = code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : 0;
  if (d && menu.row === 0) menu.gmode = (menu.gmode + d + MODES.length) % MODES.length;
  if (d && menu.row === 1) menu.mode = (menu.mode + d + PLAY_MODES.length) % PLAY_MODES.length;
  if (code === 'Enter' || code === 'Space') {
    if (menu.mode === 2) { menu.floor = startFloor(); openHost(); }
    else if (menu.mode === 3) openJoin();
    else if (menu.mode === 0 && MODES[menu.gmode].id !== 'classic') return; // needs 2+ players: the menu says so
    else if (MODES[menu.gmode].id === 'versus') startLocal(0); // versus makes its own arenas
    else { menu.floor = startFloor(); menu.level = 0; screen = 'tower'; }
  }
}

let statsScroll = 0;
function openStats() { statsScroll = 0; screen = 'stats'; }

/** The settings screen's cursor: row 0 sound effects, 1 music, 2-4 left/right/fire, 5 reset; col = player. */
const set = { row: 0, col: 0, capture: false };

function settingsKey(code: string) {
  if (set.capture) {
    if (code === 'Escape') set.capture = false;
    else if (!RESERVED.includes(code)) { bind(set.col, ACTIONS[set.row - 2], code); set.capture = false; }
    return;
  }
  if (code === 'Escape') { screen = 'menu'; return; }
  if (code === 'ArrowUp') set.row = (set.row + 5) % 6;
  if (code === 'ArrowDown') set.row = (set.row + 1) % 6;
  const d = code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : 0;
  if (d && set.row === 0) setVolume(settings.vol + d);
  else if (d && set.row === 1) setMusicVolume(settings.music + d);
  else if (d && set.row <= 4) set.col = d > 0 ? 1 : 0;
  if (code === 'Enter' || code === 'Space') {
    if (set.row >= 2 && set.row <= 4) set.capture = true;
    else if (set.row === 5) resetKeys();
  }
}

function setMusicVolume(v: number) {
  v = Math.max(0, Math.min(VOL_MAX, v));
  if (v === settings.music) return;
  settings.music = v;
  saveSettings();
  applyVolume();
}

function setVolume(v: number) {
  v = Math.max(0, Math.min(VOL_MAX, v));
  if (v === settings.vol) return;
  settings.vol = v;
  saveSettings();
  applyVolume();
  volumeBlip();
}

/** The tower as drawn: floors above `top` locked, and only the level names this player has seen. */
const towerView = (top: number) => FLOORS.map((f, i) => ({ name: f.name, locked: i > top, levels: f.levels.map((L, k) => (seen(i, k) ? L.name : '')) }));

/** Is this level of the selected floor one the player has seen? */
const seen = (floor: number, k: number) => FLOOR_START[floor] + k <= reach;

function towerKey(code: string) {
  if (code === 'Escape') { screen = 'menu'; return; }
  const top = floorOf(reach);
  if (code === 'ArrowUp' && menu.floor < top) { menu.floor++; menu.level = 0; }
  if (code === 'ArrowDown' && menu.floor > 0) { menu.floor--; menu.level = 0; }
  if (code === 'ArrowRight' && seen(menu.floor, menu.level + 1) && menu.level + 1 < FLOORS[menu.floor].levels.length) menu.level++;
  if (code === 'ArrowLeft' && menu.level > 0) menu.level--;
  if (code === 'Enter' || code === 'Space') {
    chosenFloor = menu.floor < top ? menu.floor : -1; // starting from the top floor reached keeps following it as it rises
    startLocal(FLOOR_START[menu.floor] + menu.level);
  }
}

function lobbyKey(code: string) {
  if (code === 'Escape') { closeRoom(); screen = 'menu'; return; }
  if (net.status === 'error') {
    if (code === 'Enter') { if (net.role === 'host') openHost(net.code); else openJoin(net.code); }
    return;
  }
  if (net.role === 'host') {
    if (code === 'ArrowUp' || code === 'ArrowDown') net.row = 1 - net.row;
    if (MODES[menu.gmode].id === 'versus') net.row = 1; // versus has no floor to pick
    const d = code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : 0;
    if (d && !net.start && net.row === 0) menu.floor = Math.max(0, Math.min(partyFloor(), menu.floor + d));
    if (d && !net.start && net.row === 1) menu.gmode = (menu.gmode + d + MODES.length) % MODES.length;
    if (code === 'Enter' && net.status === 'connected') hostStart();
    if (code === 'KeyC' && net.code) navigator.clipboard?.writeText(inviteLink()).then(() => { net.copied = true; }, () => {});
  } else if (net.status === 'enter') {
    if (code === 'Backspace') net.typed = net.typed.slice(0, -1);
    else if (/^Key[A-Z]$/.test(code) && net.typed.length < 4) net.typed += code[3];
    else if (code === 'Enter' && net.typed.length === 4) connectJoin();
  }
}

function quitGame() {
  if (session) endSession();
  else if (game) {
    uploadLevels(game, gameSet, false);
    showResults(game, gameSet, -1, false);
    game = null;
    rec = null;
  }
}

function gameKey(code: string) {
  const s = session ? session.predicted : game;
  if (!s) return;
  if (s.phase === 'over' || s.phase === 'won') {
    if (code === 'Enter' || code === 'Escape') quitGame();
  } else if (session && session.stalled) {
    if (code === 'Escape') quitGame(); // frozen waiting for someone: pausing can't get through
  } else if (s.paused) {
    if (code === 'Escape' || code === 'Enter' || code === 'KeyP') pausePulse = true;
    else if (code === 'KeyQ') quitGame();
  } else if (code === 'Escape' || code === 'KeyP') pausePulse = true;
}

// ---------------------------------------------------------------- touch
// Left half of the screen is a slide pad (drag left/right of where the thumb landed),
// right half is the fire button. Touches map onto the same input bits as the keyboard.
// A phone or tablet shows tap wording from the start, before the first touch.
let touchMode = matchMedia('(pointer: coarse)').matches;
setTouch(touchMode);
const pointers = new Map<number, { x: number; x0: number; pad: boolean }>();
const SLIDE_DEAD = 10, SLIDE_MAX = 26; // CSS px

function portrait(): boolean {
  return touchMode && window.innerHeight > window.innerWidth;
}

function goFullscreen() {
  // Works on Android; iPhones ignore it (there the player just rotates the phone).
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement.requestFullscreen()
    .then(() => (window.screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {});
}

function shareInvite() {
  const url = inviteLink();
  if (navigator.share) navigator.share({ title: 'Overpopped', url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => { net.copied = true; }, () => {});
}

/** A tap or click on the settings screen: a key box starts listening for a key, or Reset. (The slider is dragged: see `dragStart`.) */
function settingsTap(x: number, y: number) {
  const U = SET_UI;
  if (Math.abs(y - U.resetY) < 20 && Math.abs(x - W_MID) < 110) { set.row = 5; resetKeys(); return; }
  for (let a = 0; a < 3; a++) for (let c = 0; c < 2; c++)
    if (Math.abs(y - (U.rowY + a * U.rowGap)) < U.cellH / 2 + 4 && Math.abs(x - U.colX[c]) < U.cellW / 2) { set.row = a + 2; set.col = c; set.capture = true; }
}
const W_MID = VIEW_W / 2;

/** A finger or the mouse held on the volume slider, or dragging the stats list. */
let drag: { id: number; kind: 'vol' | 'music' | 'scroll'; y: number; s: number } | null = null;
const volAt = (x: number) => Math.round(((x - SET_UI.sliderX) / SET_UI.sliderW) * VOL_MAX);

/** Start a drag if this press is on something draggable. Returns true if it is. */
function dragStart(id: number, x: number, y: number): boolean {
  if (portrait()) return false;
  const U = SET_UI, c = CLOSE_BTN;
  if (screen === 'settings' && x > U.sliderX - 30 && x < U.sliderX + U.sliderW + 40 && (Math.abs(y - U.volY) < 22 || Math.abs(y - U.musicY) < 22)) {
    const music = Math.abs(y - U.musicY) < 22;
    drag = { id, kind: music ? 'music' : 'vol', y, s: 0 };
    set.row = music ? 1 : 0;
    set.capture = false;
    if (music) setMusicVolume(volAt(x)); else setVolume(volAt(x));
    return true;
  }
  if (screen === 'stats' && !(touchMode && x >= c.x - 10 && y <= c.y + c.h + 10)) {
    drag = { id, kind: 'scroll', y, s: statsScroll };
    return true;
  }
  return false;
}

/** Pointer position in view coordinates. */
function viewXY(e: PointerEvent | MouseEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H };
}

/** Handle a tap on menus/buttons. Returns false if the touch should drive the player instead. */
function tapUI(x: number, y: number): boolean {
  if (portrait()) return true;
  const c = CLOSE_BTN;
  const close = x >= c.x - 10 && y <= c.y + c.h + 10;
  const near = (yy: number, r = 18) => Math.abs(y - yy) < r;
  const dir = x > VIEW_W / 2 ? 'ArrowRight' : 'ArrowLeft';
  if (screen === 'stats') { if (close) screen = 'menu'; return true; }
  if (screen === 'settings') {
    if (close) { set.capture = false; screen = 'menu'; }
    else settingsTap(x, y);
    return true;
  }
  if (screen === 'menu') {
    const Y = MENU_Y;
    for (let i = 0; i < 4; i++) if (near(Y.rows[i], i < 2 ? 20 : 17)) {
      menu.row = i;
      if (i < 2) menuKey(x > (Y.lt + Y.gt) / 2 ? 'ArrowRight' : 'ArrowLeft');
      else menuKey('Enter');
    }
    if (near(Y.go, 30)) menuKey('Enter');
    return true;
  }
  if (screen === 'tower') {
    const U = TOWER_UI;
    if (close) towerKey('Escape');
    else if (x < U.listX - 30) {
      const f = FLOORS.length - 1 - Math.floor((y - U.top) / (U.slabH + U.gap));
      if (f >= 0 && f <= floorOf(reach)) { menu.floor = f; menu.level = 0; }
    } else if (y > U.goY - 26) towerKey('Enter');
    else {
      const k = Math.round((y - U.listY) / U.listGap);
      if (k >= 0 && k < FLOORS[menu.floor].levels.length && seen(menu.floor, k)) menu.level = k;
    }
    return true;
  }
  if (screen === 'results') {
    // tapping an award heading shows how it's worked out; the buttons along the bottom carry on
    const k = awardAt(x, y);
    if (k >= 0 || awardHelp >= 0) awardHelp = k === awardHelp ? -1 : k;
    else if (results?.online) closeResults();
    else if (y > RESULTS_BTN_Y - 30) { if (x < VIEW_W / 2) playAgain(); else closeResults(); }
    return true;
  }
  if (screen === 'lobby') {
    if (close) lobbyKey('Escape');
    else if (net.status === 'error') lobbyKey('Enter');
    else if (net.role === 'host' && net.code) {
      const U = TOWER_UI;
      if (x < U.listX - 30) { // a floor of the tower
        const f = FLOORS.length - 1 - Math.floor((y - U.top) / (U.slabH + U.gap));
        if (f >= 0 && f <= partyFloor() && !net.start) menu.floor = f;
      } else if (near(LOBBY_Y.link, 24)) shareInvite();
      else if (near(LOBBY_Y.floor)) { net.row = 0; lobbyKey(dir); }
      else if (near(LOBBY_Y.mode)) { net.row = 1; lobbyKey(dir); }
      else if (y > LOBBY_Y.start - 20) lobbyKey('Enter');
    } else if (net.status === 'enter') {
      const typed = (window.prompt('Room code (4 letters)') ?? '').trim();
      if (/^[A-Za-z]{4}$/.test(typed)) { net.typed = typed.toUpperCase(); connectJoin(); }
    }
    return true;
  }
  const s = session ? session.predicted : game;
  if (s && (s.phase === 'over' || s.phase === 'won')) { gameKey('Enter'); return true; }
  if (s && s.paused) { gameKey(x < VIEW_W / 2 ? 'Enter' : 'KeyQ'); return true; }
  if (close) { gameKey('Escape'); return true; }
  return false;
}

// Award headings on the results screen: hovering one (or tapping it) explains it.
let awardHelp = -1;
function awardAt(x: number, y: number): number {
  if (Math.abs(y - AWARD_UI.y) > 14) return -1;
  for (let k = 0; k < 3; k++) if (Math.abs(x - (VIEW_W / 2 + (k - 1) * AWARD_UI.gap)) < AWARD_UI.halfW) return k;
  return -1;
}
canvas.addEventListener('mousemove', (e) => {
  if (touchMode || screen !== 'results') return;
  const r = canvas.getBoundingClientRect();
  awardHelp = awardAt(((e.clientX - r.left) / r.width) * VIEW_W, ((e.clientY - r.top) / r.height) * VIEW_H);
});

// Lifetime stats count the game in progress: online only our own player, from the confirmed game.
watchGame(() => (session ? { s: session.confirmed, mine: [net.me] } : game ? { s: game, mine: game.players.map((_, i) => i) } : null));
window.addEventListener('pagehide', saveNow);
// closing or reloading mid-game still reports it (the collector keeps the first upload of a game, so this can't double up)
window.addEventListener('pagehide', () => { if (game && rec) uploadLevels(game, gameSet, false, true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

window.addEventListener('pointerdown', (e) => {
  const { x, y } = viewXY(e);
  if (e.pointerType === 'mouse') {
    // the mouse only works the settings and stats screens; everything else is keyboard
    if (e.button !== 0) return;
    unlockAudio();
    if (dragStart(e.pointerId, x, y)) { e.preventDefault(); return; }
    if (screen === 'settings') settingsTap(x, y);
    return;
  }
  e.preventDefault();
  if (!touchMode) { touchMode = true; setTouch(true); }
  unlockAudio();
  goFullscreen();
  if (dragStart(e.pointerId, x, y)) return;
  if (tapUI(x, y)) return;
  pointers.set(e.pointerId, { x: e.clientX, x0: e.clientX, pad: e.clientX < window.innerWidth / 2 });
}, { passive: false });
window.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId === drag.id) {
    const { x, y } = viewXY(e);
    if (drag.kind === 'vol') setVolume(volAt(x));
    else if (drag.kind === 'music') setMusicVolume(volAt(x));
    else statsScroll = drag.s - (y - drag.y);
    return;
  }
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  // the anchor trails the thumb so reversing direction only takes a short slide
  if (p.x - p.x0 > SLIDE_MAX) p.x0 = p.x - SLIDE_MAX;
  if (p.x0 - p.x > SLIDE_MAX) p.x0 = p.x + SLIDE_MAX;
});
for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, (e) => {
  pointers.delete(e.pointerId);
  if (drag?.id === e.pointerId) drag = null;
});
canvas.addEventListener('wheel', (e) => {
  if (screen !== 'stats') return;
  e.preventDefault();
  statsScroll += e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (VIEW_H / canvas.getBoundingClientRect().height);
}, { passive: false });
document.addEventListener('contextmenu', (e) => { if (touchMode) e.preventDefault(); });

function touchBits(): number {
  let bits = 0;
  for (const p of pointers.values()) {
    if (!p.pad) bits |= IN_FIRE;
    else if (p.x - p.x0 > SLIDE_DEAD) bits |= IN_RIGHT;
    else if (p.x0 - p.x > SLIDE_DEAD) bits |= IN_LEFT;
  }
  return bits;
}

function readInputs(n: number): number[] {
  const pause = pausePulse ? IN_PAUSE : 0;
  pausePulse = false;
  const held = (p: number) => {
    const k = settings.keys[p], any = (codes: string[]) => codes.some((c) => keys.has(c));
    return (any(k.left) ? IN_LEFT : 0) | (any(k.right) ? IN_RIGHT : 0) | (any(k.fire) ? IN_FIRE : 0);
  };
  const p1 = pause | touchBits() | held(0), p2 = held(1);
  return n === 1 ? [p1 | p2] : [p1, p2];
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let acc = 0;
const events: GameEvent[] = [];

/** Lobby line describing who is in the room. */
function roomLine(): string {
  const seats = [0, ...net.roster.map((r) => r.seat)].sort((a, b) => a - b);
  if (net.role === 'guest') return `You are player ${seats.indexOf(net.seat) + 1} of ${seats.length}${net.rtt[0] >= 0 ? `  (${net.rtt[0]} ms)` : ''}`;
  if (seats.length === 1) return '';
  const pings = seats.slice(1).map((s) => (net.rtt[s] >= 0 ? `${net.rtt[s]} ms` : '...')).join(', ');
  return `${seats.length} of ${MAX_PLAYERS} players in the room  (${pings})`;
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (screen !== 'game') pointers.clear();
  if (screen === 'results' && results) {
    menu.t += dt;
    drawResults(ctx, { s: results.s, you: results.you, levels: SETS[results.set].levels, online: results.online, t: menu.t, help: awardHelp, back: resultsBack() });
  } else
  if (screen === 'game' && session) {
    // `rate` nudges our clock toward the other players', and eases off if someone goes quiet
    acc = Math.min(acc + dt * session.rate, DT * 4);
    while (acc >= DT) {
      acc -= DT;
      session.tick(readInputs(1)[0], now - sessionT0);
    }
    if (session.events.length) { fxEvents(session.events); session.events.length = 0; }
    if (session.sounds.length) {
      if (session.sounds.some((e) => e.t === 'floor')) {
        const fs = session.confirmed.phase === 'clear' ? session.confirmed : session.predicted;
        const f = levelAt(fs, levels).floor;
        if (f) floorCleared(fs, f - 1);
      }
      playEvents(session.sounds); session.sounds.length = 0;
    }
    if (!session.predicted.paused && session.predicted.phase !== 'over' && session.predicted.phase !== 'won') addPlayTime(dt);
    const s = session.predicted;
    reached(session.confirmed);
    const waiting = session.stalled && session.silence > 20;
    const status = session.desync ? 'OUT OF SYNC - restart the game' : `online  ${session.frame - session.confirmedFrame}f`;
    const pings = session.ping.filter((_, i) => i !== net.me).map((p) => (p < 0 ? '...' : String(Math.round(p))));
    drawGame(ctx, s, levelAt(s, levels), where(s), dt, waiting, { you: net.me, status }, [...nowPlaying(), `ping ${pings.join(' / ')} ms`]);
    if (session.silence > 600) { if (net.role === 'host') endSession(); else fail('Connection lost.'); }
  } else if (screen === 'game' && game) {
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      const inp = readInputs(game.players.length);
      if (rec) {
        const r = rec;
        inp.forEach((b, i) => { if (b !== r.last[i]) { r.inp[i].push(r.n, b); r.last[i] = b; } });
        r.n++;
      }
      step(game, inp, levels, events);
    }
    if (events.length) {
      const f = levelAt(game, levels).floor;
      if (f && levels === TOWER && events.some((e) => e.t === 'floor')) floorCleared(game, f - 1);
      playEvents(events); fxEvents(events); events.length = 0;
    }
    if (!game.paused && game.phase !== 'over' && game.phase !== 'won') addPlayTime(dt);
    if (!practice && levels === TOWER) reached(game);
    drawGame(ctx, game, levelAt(game, levels), where(game), game.paused ? 0 : dt, false, undefined, nowPlaying());
  } else if (screen === 'lobby') {
    menu.t += dt;
    const host = net.role === 'host';
    const reached = host ? partyFloors() : Object.keys(net.floors).sort((a, b) => +a - +b).map((k) => net.floors[+k]);
    drawLobby(ctx, {
      role: net.role, status: net.status, code: net.code, typed: net.typed, msg: net.msg,
      link: net.code ? inviteLink() : '', copied: net.copied, t: menu.t, row: net.row, starting: !!net.start,
      floor: host ? Math.min(menu.floor, partyFloor()) : net.hostFloor, room: roomLine(),
      reached, floors: towerView(reached.length ? Math.min(...reached) : floorOf(reach)),
      modeName: MODES[host ? menu.gmode : net.hostMode]?.name ?? '', modeHint: MODES[host ? menu.gmode : net.hostMode]?.hint ?? '',
    });
  } else if (screen === 'settings') {
    menu.t += dt;
    drawSettings(ctx, { t: menu.t, vol: settings.vol, music: settings.music, volMax: VOL_MAX, keys: settings.keys.map((p) => ACTIONS.map((a) => p[a].map(keyName).join(' / '))), row: set.row, col: set.col, capture: set.capture });
  } else if (screen === 'stats') {
    menu.t += dt;
    statsScroll = drawStats(ctx, { life, floors: FLOORS.map((f, i) => (i <= floorOf(reach) ? f.name : '')), scroll: statsScroll });
  } else if (screen === 'tower') {
    menu.t += dt;
    drawTower(ctx, { t: menu.t, floor: menu.floor, level: menu.level, floors: towerView(floorOf(reach)) });
  } else {
    menu.t += dt;
    if (lastScreen && lastScreen !== 'menu') nextSlogan();
    drawMenu(ctx, { blocked: menu.mode === 0 && MODES[menu.gmode].id !== 'classic', row: menu.row, t: menu.t, gameMode: MODES[menu.gmode], playName: PLAY_MODES[menu.mode], playSecs: life.playSecs, controls: [controlsLine(0), controlsLine(1)], slogan: SLOGANS[slogan] });
  }
  setMusic(musicFor());
  // a finished game shows GAME OVER / YOU WIN for a moment, then the results (Enter or a tap skips ahead)
  const done = screen === 'game' ? (session ? session.confirmed : game) : null;
  if (done && (done.phase === 'over' || done.phase === 'won')) {
    overT += dt;
    if (overT > OVER_SECS) { overT = 0; quitGame(); }
  } else overT = 0;
  lastScreen = screen;
  if (portrait()) drawRotate(ctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev server only: lets e2e-check.html inspect the running game.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__dbg = {
    net, menu,
    get reach() { return reach; },
    set reach(v: number) { reach = v; },
    get screen() { return screen; },
    get session() { return session; },
    get game() { return game; },
    levelRecord: () => (game ? levelRecord(game, gameSet, false) : null),
  };
}

// Testing shortcut: ?play=hard-8 (or ?play=campaign-3) jumps straight into that level.
const jump = /^(\w+)-(\d+)$/.exec(new URLSearchParams(location.search).get('play') ?? '');
if (jump) {
  const si = SETS.findIndex((x) => x.id === jump[1]);
  if (si >= 0 && SETS[si].levels[+jump[2] - 1]) {
    levels = SETS[si].levels;
    gameSet = si;
    practice = true;
    game = newGame(levels, 1, +jump[2] - 1, 12345);
    screen = 'game';
  }
}

// Dev server only: ?reach=20 opens the tower as if level 20 had been reached (not saved).
const fake = +(new URLSearchParams(location.search).get('reach') ?? 0);
if (import.meta.env.DEV && fake > 0) {
  reach = Math.min(TOWER.length, fake) - 1;
  menu.floor = floorOf(reach);
  screen = 'tower';
}

// Invite links look like https://your.site/#ABCD
const invited = /^#([A-Za-z]{4})$/.exec(location.hash);
if (invited) {
  history.replaceState(null, '', location.pathname);
  openJoin(invited[1]);
}
