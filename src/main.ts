import { playEvents, unlockAudio } from './audio';
import { SETS } from './levels';
import { hostRoom, joinRoom } from './net';
import type { Link, Room } from './net';
import { CLOSE_BTN, LOBBY_Y, VIEW_H, VIEW_W, drawGame, drawLobby, drawMenu, drawRotate, fxEvents, setTouch } from './render';
import { INPUT_DELAY, RollbackSession } from './rollback';
import type { InputMsg, PeerLog } from './rollback';
import { DT, IN_FIRE, IN_LEFT, IN_PAUSE, IN_RIGHT, newGame, step } from './sim';
import type { GameEvent, Level, State } from './sim';

/** Both players must run the same build: the sim and level data have to match exactly. */
const VERSION = 6;
/** Trace collector (see worker/). Empty = don't upload; the host can still save logs by hand. */
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

type StartMsg = { t: 'start'; v: number; gid: number; set: number; level: number; seed: number };
type LobbyStatus = 'opening' | 'waiting' | 'enter' | 'connecting' | 'connected' | 'error';

/** One recorded online game: enough to replay it offline (see scripts/replay.ts). */
interface TraceSession {
  meta: { version: number; gid: number; set: number; level: number; seed: number; date: string; inputDelay: number };
  peers: (PeerLog | null)[]; // [host, guest]
}

const net = {
  role: 'host' as 'host' | 'guest',
  room: null as Room | null,
  link: null as Link | null,
  code: '',
  typed: '',
  status: 'opening' as LobbyStatus,
  msg: '',
  rtt: -1,
  copied: false,
  me: 0,
  row: 0, // host's selected settings row in the lobby
  hostSet: 0, // guest's view of what the host has picked
  hostLevel: 0,
  gid: 0,
  lastGid: -1,
  pendingGid: -1,
  startMsg: null as StartMsg | null, // host: being offered until the guest says 'go'
  heard: false, // received at least one input packet in the current game
  meta: null as TraceSession['meta'] | null,
  logs: [] as TraceSession[],
  logsSaved: 0,
  outLog: null as { gid: number; chunks: string[]; acked: boolean[] } | null,
  inLog: new Map<number, { n: number; parts: string[]; got: number }>(),
};

// ---------------------------------------------------------------- online
function inviteLink(): string {
  return `${location.origin}${location.pathname}#${net.code}`;
}

function closeRoom() {
  net.room?.close();
  net.room = null;
  net.link = null;
  session = null;
  net.startMsg = null;
  net.outLog = null;
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
    onReady: (code: string) => { if (live()) { net.code = code; net.status = 'waiting'; } },
    onOpen: (link: Link) => { if (live()) { net.link = link; net.status = 'connected'; net.rtt = -1; } },
    onData: (m: unknown) => { if (live()) onMessage(m as { t: string } & Record<string, unknown>); },
    onClose: (reason: string) => { if (live()) fail(reason); },
  };
}

/** Pass `keepCode` to reopen the room under its existing code, so invite links already sent still work. */
function openHost(keepCode = '') {
  closeRoom();
  Object.assign(net, { role: 'host', status: 'opening', code: keepCode, msg: '', copied: false, me: 0, row: 0 });
  screen = 'lobby';
  net.room = hostRoom(handlers(), keepCode);
}

function openJoin(code = '') {
  closeRoom();
  Object.assign(net, { role: 'guest', status: 'enter', typed: code.toUpperCase(), msg: '', me: 1 });
  screen = 'lobby';
  if (code.length === 4) connectJoin();
}

function connectJoin() {
  net.status = 'connecting';
  net.code = net.typed;
  net.room = joinRoom(net.typed, handlers());
}

function beginSession(m: StartMsg) {
  if (!net.link) return;
  levels = SETS[m.set].levels;
  net.lastGid = m.gid;
  net.heard = false;
  net.meta = { version: VERSION, gid: m.gid, set: m.set, level: m.level, seed: m.seed, date: new Date().toISOString(), inputDelay: INPUT_DELAY };
  const link = net.link;
  session = new RollbackSession(levels, net.me, newGame(levels, 2, m.level, m.seed), (msg) => link.send({ ...msg, gid: m.gid }));
  sessionT0 = performance.now();
  acc = 0;
  pausePulse = false;
  screen = 'game';
  keys.clear();
}

// Start handshake, so both players begin at (nearly) the same moment:
//   host  -> 'start' (repeated until answered)
//   guest -> 'go', then waits half a round trip and begins
//   host  begins when 'go' arrives, i.e. one round trip after sending
function hostStart() {
  if (!net.link || net.startMsg) return;
  net.startMsg = { t: 'start', v: VERSION, gid: ++net.gid, set: menu.set, level: menu.level, seed: (Date.now() & 0x7fffffff) | 1 };
  net.link.send(net.startMsg);
}

/** Leave the current online game (both players end up back in the lobby) and keep its log. */
function endSession() {
  if (session && net.meta) {
    const log = session.finish();
    uploadHalf(net.meta, net.role, log);
    if (net.role === 'host') {
      net.logs.push({ meta: net.meta, peers: [log, null] });
      if (net.logs.length > 30) { net.logs.shift(); net.logsSaved = Math.max(0, net.logsSaved - 1); }
    } else {
      // ship our half of the log to the host in small pieces
      const text = JSON.stringify(log), chunks: string[] = [];
      for (let i = 0; i < text.length; i += 8000) chunks.push(text.slice(i, i + 8000));
      net.outLog = { gid: net.meta.gid, chunks, acked: chunks.map(() => false) };
    }
  }
  session = null;
  net.startMsg = null;
  screen = 'lobby';
  net.status = 'connected';
}

/** Send our half of a finished game's log to the trace collector. Best effort, never blocks play. */
function uploadHalf(meta: TraceSession['meta'], role: 'host' | 'guest', log: PeerLog) {
  if (!TRACE_URL || log.tick.length < 300) return; // skip games under ~5 seconds
  const sid = `${net.code}-${meta.seed}-${meta.gid}`; // same on both sides
  fetch(`${TRACE_URL}/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'splitstorm-half', v: 1, sid, role, meta, log }),
  }).catch(() => {});
}

function saveLogs() {
  if (!net.logs.length) return;
  const body = JSON.stringify({ format: 'splitstorm-trace', v: 1, sessions: net.logs });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  a.download = `splitstorm-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  net.logsSaved = net.logs.length;
}

function onMessage(m: { t: string } & Record<string, unknown>) {
  switch (m.t) {
    case 'ping':
      net.link?.send({ t: 'pong', ts: m.ts });
      if (net.role === 'guest') { net.hostSet = m.set as number; net.hostLevel = m.level as number; }
      // The peer is sitting in the lobby. If we were mid-game with them, they left it.
      if (session && net.heard) endSession();
      break;
    case 'pong':
      net.rtt = Math.round(performance.now() - (m.ts as number));
      break;
    case 'start': {
      const s = m as unknown as StartMsg;
      if (net.role !== 'guest') break;
      if (s.v !== VERSION) { fail('You and the host are on different versions. Both refresh the page.'); break; }
      net.link?.send({ t: 'go', gid: s.gid });
      if (s.gid === net.lastGid || s.gid === net.pendingGid) break; // a repeat
      net.pendingGid = s.gid;
      setTimeout(() => { if (net.pendingGid === s.gid && net.link) beginSession(s); }, Math.max(0, net.rtt) / 2);
      break;
    }
    case 'go':
      if (net.startMsg && m.gid === net.startMsg.gid) {
        const s = net.startMsg;
        net.startMsg = null;
        beginSession(s);
      }
      break;
    case 'in':
      if (session && m.gid === net.lastGid) {
        net.heard = true;
        session.receive(m as unknown as InputMsg, performance.now() - sessionT0);
      }
      break;
    case 'log': { // guest's session log arriving in pieces
      const gid = m.gid as number, i = m.i as number;
      net.link?.send({ t: 'logack', gid, i });
      const entry = net.logs.find((l) => l.meta.gid === gid);
      if (!entry || entry.peers[1]) break;
      let buf = net.inLog.get(gid);
      if (!buf) { buf = { n: m.n as number, parts: [], got: 0 }; net.inLog.set(gid, buf); }
      if (buf.parts[i] === undefined) { buf.parts[i] = m.d as string; buf.got++; }
      if (buf.got === buf.n) {
        try { entry.peers[1] = JSON.parse(buf.parts.join('')) as PeerLog; } catch { /* corrupt: leave it out */ }
        net.inLog.delete(gid);
      }
      break;
    }
    case 'logack':
      if (net.outLog && m.gid === net.outLog.gid) {
        net.outLog.acked[m.i as number] = true;
        if (net.outLog.acked.every(Boolean)) net.outLog = null;
      }
      break;
  }
}

// Unreliable channel: keep repeating the things that must arrive.
let beat = 0;
setInterval(() => {
  const link = net.link;
  if (!link) return;
  beat++;
  if (screen === 'lobby') {
    if (net.startMsg) link.send(net.startMsg);
    else if (beat % 4 === 0) link.send({ t: 'ping', ts: performance.now(), set: menu.set, level: menu.level });
  }
  const out = net.outLog;
  if (out) {
    let sent = 0;
    for (let i = 0; i < out.chunks.length && sent < 4; i++) {
      if (out.acked[i]) continue;
      link.send({ t: 'log', gid: out.gid, i, n: out.chunks.length, d: out.chunks[i] });
      sent++;
    }
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
    if (d && !net.startMsg) changeSetting(net.row, d);
    if (code === 'Enter' && net.status === 'connected') hostStart();
    if (code === 'KeyC' && net.code) navigator.clipboard?.writeText(inviteLink()).then(() => { net.copied = true; }, () => {});
    if (code === 'KeyL') saveLogs();
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
    if (code === 'Escape') quitGame(); // frozen waiting for the peer: pausing can't get through
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
      else if (near(LOBBY_Y.log, 14)) saveLogs();
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

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (screen !== 'game') pointers.clear();
  if (screen === 'game' && session) {
    // `rate` nudges our clock toward the other player's, and eases off if they go quiet
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
    if (session.silence > 600) fail('Connection lost.');
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
    const full = net.logs.filter((l) => l.peers[1]).length;
    drawLobby(ctx, {
      role: net.role, status: net.status, code: net.code, typed: net.typed, msg: net.msg, rtt: net.rtt,
      link: net.code ? inviteLink() : '', copied: net.copied, t: menu.t, row: net.row, starting: !!net.startMsg,
      setName: set.name, levelName: `${lvl + 1}. ${set.levels[lvl]?.name ?? ''}`,
      logInfo: !host || !net.logs.length ? ''
        : `${net.logs.length} game log${net.logs.length > 1 ? 's' : ''} (${full} complete)${net.logsSaved === net.logs.length ? ' - saved' : ''}`,
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
