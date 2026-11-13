import { playEvents, unlockAudio } from './audio';
import { SETS } from './levels';
import { hostRoom, joinRoom } from './net';
import type { Link, Room } from './net';
import { VIEW_H, VIEW_W, drawGame, drawLobby, drawMenu, fxEvents } from './render';
import { RollbackSession } from './rollback';
import type { InputMsg } from './rollback';
import { DT, IN_FIRE, IN_LEFT, IN_RIGHT, newGame, step } from './sim';
import type { GameEvent, Level, State } from './sim';

/** Both players must run the same build: the sim and level data have to match exactly. */
const VERSION = 4;
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
resize();

// ---------------------------------------------------------------- state
type Screen = 'menu' | 'lobby' | 'game';
let screen: Screen = 'menu';
let levels: Level[] = SETS[0].levels;
let game: State | null = null; // local play
let session: RollbackSession | null = null; // online play
let paused = false;
const keys = new Set<string>();
const menu = { set: 0, level: 0, mode: 0, row: 0, t: 0 };

type StartMsg = { t: 'start'; v: number; gid: number; set: number; level: number; seed: number };
type LobbyStatus = 'opening' | 'waiting' | 'enter' | 'connecting' | 'connected' | 'error';
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
  gid: 0,
  lastGid: -1,
  startMsg: null as StartMsg | null,
  heard: false, // received at least one input packet in the current game
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
}

function fail(reason: string) {
  closeRoom();
  screen = 'lobby';
  net.status = 'error';
  net.msg = reason;
}

function handlers() {
  const room = () => net.room;
  let mine: Room | null = null;
  queueMicrotask(() => { mine = room(); });
  const live = () => mine !== null && mine === net.room;
  return {
    onReady: (code: string) => { if (live()) { net.code = code; net.status = 'waiting'; } },
    onOpen: (link: Link) => { if (live()) { net.link = link; net.status = 'connected'; net.rtt = -1; } },
    onData: (m: unknown) => { if (live()) onMessage(m as { t: string } & Record<string, unknown>); },
    onClose: (reason: string) => { if (live()) fail(reason); },
  };
}

function openHost() {
  closeRoom();
  Object.assign(net, { role: 'host', status: 'opening', code: '', msg: '', copied: false, me: 0 });
  screen = 'lobby';
  net.room = hostRoom(handlers());
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
  levels = SETS[m.set].levels;
  net.lastGid = m.gid;
  net.heard = false;
  const link = net.link!;
  session = new RollbackSession(levels, net.me, newGame(levels, 2, m.level, m.seed), (msg) => link.send({ ...msg, gid: m.gid }));
  acc = 0;
  screen = 'game';
  keys.clear();
}

function hostStart() {
  if (!net.link) return;
  const m: StartMsg = { t: 'start', v: VERSION, gid: ++net.gid, set: menu.set, level: menu.level, seed: (Date.now() & 0x7fffffff) | 1 };
  net.startMsg = m;
  net.link.send(m);
  beginSession(m);
}

function backToLobby() {
  session = null;
  net.startMsg = null;
  screen = 'lobby';
  net.status = 'connected';
}

function onMessage(m: { t: string } & Record<string, unknown>) {
  switch (m.t) {
    case 'ping':
      net.link?.send({ t: 'pong', ts: m.ts });
      // The peer is sitting in the lobby. If we were mid-game with them, they left it.
      if (session && net.heard) backToLobby();
      break;
    case 'pong':
      net.rtt = Math.round(performance.now() - (m.ts as number));
      break;
    case 'start': {
      const s = m as unknown as StartMsg;
      if (net.role !== 'guest' || s.gid === net.lastGid) break;
      if (s.v !== VERSION) { fail('You and the host are on different versions. Both refresh the page.'); break; }
      beginSession(s);
      break;
    }
    case 'in':
      if (session && m.gid === net.lastGid) {
        net.heard = true;
        net.startMsg = null;
        session.receive(m as unknown as InputMsg);
      }
      break;
  }
}

// Unreliable channel: keep repeating the things that must arrive.
setInterval(() => {
  if (!net.link) return;
  if (screen === 'lobby') net.link.send({ t: 'ping', ts: performance.now() });
  else if (net.startMsg) net.link.send(net.startMsg);
}, 400);

// ---------------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Backspace'].includes(e.code)) e.preventDefault();
  unlockAudio();
  if (e.repeat) return;
  keys.add(e.code);
  if (screen === 'menu') menuKey(e.code);
  else if (screen === 'lobby') lobbyKey(e);
  else gameKey(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function menuKey(code: string) {
  if (code === 'ArrowUp') menu.row = (menu.row + 2) % 3;
  if (code === 'ArrowDown') menu.row = (menu.row + 1) % 3;
  const d = code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : 0;
  if (d && menu.row === 0) { menu.set = (menu.set + d + SETS.length) % SETS.length; menu.level = 0; }
  if (d && menu.row === 1) { const n = SETS[menu.set].levels.length; menu.level = (menu.level + d + n) % n; }
  if (d && menu.row === 2) menu.mode = (menu.mode + d + PLAY_MODES.length) % PLAY_MODES.length;
  if (code === 'Enter' || code === 'Space') {
    if (menu.mode === 2) openHost();
    else if (menu.mode === 3) openJoin();
    else {
      levels = SETS[menu.set].levels;
      game = newGame(levels, menu.mode + 1, menu.level, (Date.now() & 0x7fffffff) | 1);
      paused = false;
      acc = 0;
      screen = 'game';
      keys.clear();
    }
  }
}

function lobbyKey(e: KeyboardEvent) {
  if (e.code === 'Escape') { closeRoom(); screen = 'menu'; return; }
  if (net.status === 'error') {
    if (e.code === 'Enter') { if (net.role === 'host') openHost(); else openJoin(); }
    return;
  }
  if (net.role === 'host') {
    if (e.code === 'Enter' && net.status === 'connected') hostStart();
    if (e.code === 'KeyC' && net.code) {
      navigator.clipboard?.writeText(inviteLink()).then(() => { net.copied = true; }, () => {});
    }
  } else if (net.status === 'enter') {
    if (e.code === 'Backspace') net.typed = net.typed.slice(0, -1);
    else if (/^Key[A-Z]$/.test(e.code) && net.typed.length < 4) net.typed += e.code[3];
    else if (e.code === 'Enter' && net.typed.length === 4) connectJoin();
  }
}

function gameKey(code: string) {
  if (session) {
    const done = session.predicted.phase === 'over' || session.predicted.phase === 'won';
    if (code === 'Escape' || (code === 'Enter' && done)) backToLobby();
    return;
  }
  if (!game) return;
  if (code === 'Escape') { game = null; screen = 'menu'; }
  else if (code === 'KeyP') paused = !paused;
  else if (code === 'Enter' && (game.phase === 'over' || game.phase === 'won')) { game = null; screen = 'menu'; }
}

function readInputs(n: number): number[] {
  const arrows = (keys.has('ArrowLeft') ? IN_LEFT : 0) | (keys.has('ArrowRight') ? IN_RIGHT : 0) | (keys.has('Space') || keys.has('ArrowUp') ? IN_FIRE : 0);
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
  if (screen === 'game' && session) {
    acc = Math.min(acc + dt, DT * 4);
    while (acc >= DT) {
      acc -= DT;
      session.tick(readInputs(1)[0]);
    }
    if (session.events.length) { playEvents(session.events); fxEvents(session.events); session.events.length = 0; }
    const s = session.predicted;
    const waiting = session.stalled && session.silence > 20;
    const status = session.desync ? 'OUT OF SYNC - restart the game' : `online  ${session.frame - session.confirmedFrame}f`;
    drawGame(ctx, s, levels[s.level], levels.length, dt, waiting ? 'wait' : '', { you: net.me, status });
    if (session.silence > 600) fail('Connection lost.');
  } else if (screen === 'game' && game) {
    if (!paused) {
      acc += dt;
      while (acc >= DT) {
        acc -= DT;
        step(game, readInputs(game.players.length), levels, events);
      }
      if (events.length) { playEvents(events); fxEvents(events); events.length = 0; }
    }
    drawGame(ctx, game, levels[game.level], levels.length, paused ? 0 : dt, paused ? 'pause' : '');
  } else if (screen === 'lobby') {
    menu.t += dt;
    drawLobby(ctx, {
      role: net.role, status: net.status, code: net.code, typed: net.typed, msg: net.msg, rtt: net.rtt,
      link: net.code ? inviteLink() : '', copied: net.copied, t: menu.t,
      setName: SETS[menu.set].name, levelName: `${menu.level + 1}. ${SETS[menu.set].levels[menu.level].name}`,
    });
  } else {
    menu.t += dt;
    const set = SETS[menu.set];
    drawMenu(ctx, { row: menu.row, t: menu.t, setName: set.name, levelName: `${menu.level + 1}. ${set.levels[menu.level].name}`, modeName: PLAY_MODES[menu.mode] });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

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
