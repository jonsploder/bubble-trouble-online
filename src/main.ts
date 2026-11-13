import { playEvents, unlockAudio } from './audio';
import { SETS } from './levels';
import { MAX_PLAYERS, hostRoom, joinRoom } from './net';
import type { Room, RosterEntry } from './net';
import { CLOSE_BTN, LOBBY_Y, VIEW_H, VIEW_W, drawGame, drawLobby, drawMenu, drawRotate, fxEvents, setTouch } from './render';
import { INPUT_DELAY, RollbackSession } from './rollback';
import type { InputMsg, PeerLog } from './rollback';
import { DT, IN_FIRE, IN_LEFT, IN_PAUSE, IN_RIGHT, newGame, step } from './sim';
import type { GameEvent, Level, State } from './sim';

/** All players must run the same build: the sim and level data have to match exactly. */
const VERSION = 8;
/** Trace collector (see worker/). Empty = don't upload. */
const TRACE_URL = (import.meta.env.VITE_TRACE_URL ?? '').replace(/\/$/, '');
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
type Screen = 'menu' | 'lobby' | 'game';
let screen: Screen = 'menu';
let levels: Level[] = SETS[0].levels;
let game: State | null = null; // local play
let session: RollbackSession | null = null; // online play
let sessionT0 = 0;
let pausePulse = false; // send IN_PAUSE on the next tick
const keys = new Set<string>();
const menu = { set: 0, level: 0, mode: 0, row: 0, t: 0 };

/** `seats` lists who is playing, in player order; `wait` is how long the recipient should hold off before starting. */
type StartMsg = { t: 'start'; v: number; gid: number; set: number; level: number; seed: number; seats: number[]; wait: number };
type LobbyStatus = 'opening' | 'waiting' | 'enter' | 'connecting' | 'connected' | 'error';
type Msg = { t: string } & Record<string, unknown>;
interface TraceMeta { version: number; gid: number; set: number; level: number; seed: number; date: string; inputDelay: number; players: number }

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
  hostSet: 0, // guest's view of what the host has picked
  hostLevel: 0,
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
    if (!up) delete net.rtt[seat];
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
  net.lastGid = m.gid;
  net.seats = m.seats;
  net.me = me;
  net.meta = { version: VERSION, gid: m.gid, set: m.set, level: m.level, seed: m.seed, date: new Date().toISOString(), inputDelay: INPUT_DELAY, players: m.seats.length };
  session = new RollbackSession(levels, me, newGame(levels, m.seats.length, m.level, m.seed), (to, msg) => room.send(m.seats[to], { ...msg, gid: m.gid }));
  sessionT0 = performance.now();
  acc = 0;
  pausePulse = false;
  screen = 'game';
  keys.clear();
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
  const msg: StartMsg = { t: 'start', v: VERSION, gid: ++net.gid, set: menu.set, level: menu.level, seed: (Date.now() & 0x7fffffff) | 1, seats: [0, ...guests], wait: 0 };
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

/** Leave the current online game; everyone ends up back in the lobby. */
function endSession() {
  if (session && net.meta) uploadLog(net.meta, net.me, session.finish());
  session = null;
  net.start = null;
  net.room?.setOpen(true);
  screen = 'lobby';
  if (net.role === 'host') net.status = net.room?.seats().length ? 'connected' : 'waiting';
  else net.status = 'connected';
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
      net.hostSet = m.set as number;
      net.hostLevel = m.level as number;
      net.seat = m.you as number;
      net.roster = m.players as RosterEntry[];
      room.setRoster(net.seat, net.roster);
      // The host is back in the lobby but we are still in its latest game: that game is over.
      if (session && m.gid === net.lastGid) endSession();
      break;
    case 'gping': // guest -> host, while the guest is in the lobby
      if (net.role !== 'host') break;
      room.send(seat, { t: 'pong', ts: m.ts });
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
  if (screen !== 'lobby' || beat % 4 || net.start) return;
  if (net.role === 'host') {
    const players = room.roster();
    for (const g of room.seats()) room.send(g, { t: 'ping', ts: performance.now(), set: menu.set, level: menu.level, you: g, players, gid: net.gid });
  } else {
    room.send(0, { t: 'gping', ts: performance.now(), left: net.lastGid });
  }
}, 100);

// ---------------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Backspace'].includes(e.code)) e.preventDefault();
  unlockAudio();
  if (e.repeat) return;
  keys.add(e.code);
  if (screen === 'menu') menuKey(e.code);
  else if (screen === 'lobby') lobbyKey(e.code);
  else gameKey(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

/** Left/right on the "Levels" and "Start at" rows; shared by the menu and the host's lobby. */
function changeSetting(row: number, d: number) {
  if (row === 0) { menu.set = (menu.set + d + SETS.length) % SETS.length; menu.level = 0; }
  if (row === 1) { const n = SETS[menu.set].levels.length; menu.level = (menu.level + d + n) % n; }
}

function menuKey(code: string) {
  if (code === 'ArrowUp') menu.row = (menu.row + 2) % 3;
  if (code === 'ArrowDown') menu.row = (menu.row + 1) % 3;
  const d = code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : 0;
  if (d && menu.row < 2) changeSetting(menu.row, d);
  if (d && menu.row === 2) menu.mode = (menu.mode + d + PLAY_MODES.length) % PLAY_MODES.length;
  if (code === 'Enter' || code === 'Space') {
    if (menu.mode === 2) openHost();
    else if (menu.mode === 3) openJoin();
    else {
      levels = SETS[menu.set].levels;
      game = newGame(levels, menu.mode + 1, menu.level, (Date.now() & 0x7fffffff) | 1);
      acc = 0;
      pausePulse = false;
      screen = 'game';
      keys.clear();
    }
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
    const d = code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : 0;
    if (d && !net.start) changeSetting(net.row, d);
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
  else { game = null; screen = 'menu'; }
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
let touchMode = false;
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
  if (navigator.share) navigator.share({ title: 'Splitstorm', url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => { net.copied = true; }, () => {});
}

/** Handle a tap on menus/buttons. Returns false if the touch should drive the player instead. */
function tapUI(x: number, y: number): boolean {
  if (portrait()) return true;
  const c = CLOSE_BTN;
  const close = x >= c.x - 10 && y <= c.y + c.h + 10;
  const near = (yy: number, r = 18) => Math.abs(y - yy) < r;
  const dir = x > VIEW_W / 2 ? 'ArrowRight' : 'ArrowLeft';
  if (screen === 'menu') {
    for (let i = 0; i < 3; i++) if (near(250 + i * 44, 22)) { menu.row = i; menuKey(dir); }
    if (near(400, 34)) menuKey('Enter');
    return true;
  }
  if (screen === 'lobby') {
    if (close) lobbyKey('Escape');
    else if (net.status === 'error') lobbyKey('Enter');
    else if (net.role === 'host') {
      if (near(LOBBY_Y.link, 30) && net.code) shareInvite();
      else if (near(LOBBY_Y.set)) { net.row = 0; lobbyKey(dir); }
      else if (near(LOBBY_Y.level)) { net.row = 1; lobbyKey(dir); }
      else if (y > LOBBY_Y.start - 24) lobbyKey('Enter');
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

window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  e.preventDefault();
  if (!touchMode) { touchMode = true; setTouch(true); }
  unlockAudio();
  goFullscreen();
  const r = canvas.getBoundingClientRect();
  if (tapUI(((e.clientX - r.left) / r.width) * VIEW_W, ((e.clientY - r.top) / r.height) * VIEW_H)) return;
  pointers.set(e.pointerId, { x: e.clientX, x0: e.clientX, pad: e.clientX < window.innerWidth / 2 });
}, { passive: false });
window.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  // the anchor trails the thumb so reversing direction only takes a short slide
  if (p.x - p.x0 > SLIDE_MAX) p.x0 = p.x - SLIDE_MAX;
  if (p.x0 - p.x > SLIDE_MAX) p.x0 = p.x + SLIDE_MAX;
});
for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, (e) => pointers.delete(e.pointerId));
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
  const arrows = pause | touchBits() | (keys.has('ArrowLeft') ? IN_LEFT : 0) | (keys.has('ArrowRight') ? IN_RIGHT : 0) | (keys.has('Space') || keys.has('ArrowUp') ? IN_FIRE : 0);
  const wasd = (keys.has('KeyA') ? IN_LEFT : 0) | (keys.has('KeyD') ? IN_RIGHT : 0) | (keys.has('KeyW') || keys.has('ShiftLeft') ? IN_FIRE : 0);
  return n === 1 ? [arrows | wasd] : [arrows, wasd];
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
  if (screen === 'game' && session) {
    // `rate` nudges our clock toward the other players', and eases off if someone goes quiet
    acc = Math.min(acc + dt * session.rate, DT * 4);
    while (acc >= DT) {
      acc -= DT;
      session.tick(readInputs(1)[0], now - sessionT0);
    }
    if (session.events.length) { playEvents(session.events); fxEvents(session.events); session.events.length = 0; }
    const s = session.predicted;
    const waiting = session.stalled && session.silence > 20;
    const status = session.desync ? 'OUT OF SYNC - restart the game' : `online  ${session.frame - session.confirmedFrame}f`;
    drawGame(ctx, s, levels[s.level], levels.length, dt, waiting, { you: net.me, status });
    if (session.silence > 600) { if (net.role === 'host') endSession(); else fail('Connection lost.'); }
  } else if (screen === 'game' && game) {
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      step(game, readInputs(game.players.length), levels, events);
    }
    if (events.length) { playEvents(events); fxEvents(events); events.length = 0; }
    drawGame(ctx, game, levels[game.level], levels.length, game.paused ? 0 : dt, false);
  } else if (screen === 'lobby') {
    menu.t += dt;
    const host = net.role === 'host';
    const set = SETS[host ? menu.set : net.hostSet] ?? SETS[0];
    const lvl = host ? menu.level : net.hostLevel;
    drawLobby(ctx, {
      role: net.role, status: net.status, code: net.code, typed: net.typed, msg: net.msg,
      link: net.code ? inviteLink() : '', copied: net.copied, t: menu.t, row: net.row, starting: !!net.start,
      setName: set.name, levelName: `${lvl + 1}. ${set.levels[lvl]?.name ?? ''}`, room: roomLine(),
    });
  } else {
    menu.t += dt;
    const set = SETS[menu.set];
    drawMenu(ctx, { row: menu.row, t: menu.t, setName: set.name, levelName: `${menu.level + 1}. ${set.levels[menu.level].name}`, modeName: PLAY_MODES[menu.mode] });
  }
  if (portrait()) drawRotate(ctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Dev server only: lets e2e-check.html inspect the running game.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__dbg = {
    net, menu,
    get screen() { return screen; },
    get session() { return session; },
  };
}

// Testing shortcut: ?play=hard-8 (or ?play=campaign-3) jumps straight into that level.
const jump = /^(\w+)-(\d+)$/.exec(new URLSearchParams(location.search).get('play') ?? '');
if (jump) {
  const si = SETS.findIndex((x) => x.id === jump[1]);
  if (si >= 0 && SETS[si].levels[+jump[2] - 1]) {
    menu.set = si;
    menu.level = +jump[2] - 1;
    levels = SETS[si].levels;
    game = newGame(levels, 1, menu.level, 12345);
    screen = 'game';
  }
}

// Invite links look like https://your.site/#ABCD
const invited = /^#([A-Za-z]{4})$/.exec(location.hash);
if (invited) {
  history.replaceState(null, '', location.pathname);
  openJoin(invited[1]);
}
