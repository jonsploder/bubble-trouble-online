import { H, PH, PW, RADII, W, hasSpikes, stopY } from './sim';
import type { GameEvent, Level, PickupKind, State } from './sim';

export const VIEW_W = W;
export const VIEW_H = H + 60;

const BALL_COL = ['#ffe066', '#ff9f43', '#ff5e7e', '#c56cf0', '#4dabf7', '#38d9a9'];
const PLAYER_COL = ['#5ee6ff', '#ff7ad9', '#b6ff6e', '#ffd166'];
const PICK: Record<PickupKind, { c: string; label: string; name: string }> = {
  harpoon: { c: '#e9ecef', label: 'H', name: 'Harpoon' },
  twin: { c: '#74c0fc', label: '2', name: 'Twin harpoon' },
  anchor: { c: '#8ce99a', label: 'V', name: 'Sticky vine' },
  pulse: { c: '#ffa94d', label: 'P', name: 'Pulse gun' },
  beam: { c: '#ff6b6b', label: 'B', name: 'Beam' },
  shield: { c: '#66d9e8', label: 'S', name: 'Shield' },
  slow: { c: '#b197fc', label: '~', name: 'Slow' },
  time: { c: '#ffd43b', label: '+', name: 'Time' },
  life: { c: '#ff8787', label: '♥', name: 'Life' },
};

interface Particle { x: number; y: number; vx: number; vy: number; life: number; c: string }
const particles: Particle[] = [];

/** Touch devices get tap-flavoured prompts and a close button. */
let touch = false;
export function setTouch(v: boolean) { touch = v; }
/** Top-right close/back button (touch only), in view coordinates. */
export const CLOSE_BTN = { x: W - 56, y: 8, w: 48, h: 48 };

function closeButton(ctx: CanvasRenderingContext2D) {
  if (!touch) return;
  const b = CLOSE_BTN;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(b.x + 16, b.y + 16); ctx.lineTo(b.x + 32, b.y + 32);
  ctx.moveTo(b.x + 32, b.y + 16); ctx.lineTo(b.x + 16, b.y + 32);
  ctx.stroke();
}

export function drawRotate(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#07080f';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  text(ctx, 'TURN YOUR PHONE SIDEWAYS', W / 2, VIEW_H / 2, 54, '#ffd43b');
}
let shake = 0;
let otherX = 0; // smoothed draw position of the remote player

export function fxEvents(ev: GameEvent[]) {
  for (const e of ev) {
    if (e.t === 'pop' || e.t === 'spike') {
      const n = 5 + e.size * 2;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
        particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.3 + Math.random() * 0.3, c: BALL_COL[e.size] });
      }
    } else if (e.t === 'knock') {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.25, c: '#dee2e6' });
      }
    } else if (e.t === 'flip') shake = 0.25;
    else if (e.t === 'die') shake = 0.4;
    else if (e.t === 'gate') shake = 0.2;
  }
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'center', weight = 700) {
  ctx.font = `${weight} ${size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function background(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0d1024');
  g.addColorStop(1, '#1a1236');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 40; y < H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}

export function drawGame(ctx: CanvasRenderingContext2D, s: State, L: Level, total: number, dt: number, waiting = false, net?: { you: number; status: string }) {
  ctx.save();
  if (shake > 0) {
    shake -= dt;
    ctx.translate((Math.random() - 0.5) * 10 * shake * 2.5, (Math.random() - 0.5) * 10 * shake * 2.5);
  }
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  if (L.upsideDown) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI);
    ctx.translate(-W / 2, -H / 2);
  }
  if (L.spin) {
    // half a turn at the end of every period, eased over 45 ticks
    const P = L.spin * 60, n = Math.floor(s.lt / P), into = s.lt - n * P - (P - 45);
    const k = into > 0 ? into / 45 : 0;
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI * (n + k * k * (3 - 2 * k)));
    ctx.translate(-W / 2, -H / 2);
  }
  background(ctx);
  const spiked = hasSpikes(L);

  if (L.wind) {
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const y = 30 + ((i * 97) % (H - 60));
      const x = (((i * 211 + s.tick * L.wind * 0.05 * (1 + (i % 3) * 0.4)) % (W + 80)) + W + 80) % (W + 80) - 40;
      ctx.moveTo(x, y); ctx.lineTo(x - Math.sign(L.wind) * (24 + (i % 4) * 10), y);
    }
    ctx.stroke();
  }
  if (L.flip) {
    // arrows show which way balls fall; they flash in the last second before a flip
    const left = L.flip * 60 - (s.lt % (L.flip * 60));
    if (!(left < 60 && left % 12 < 6)) {
      ctx.fillStyle = left < 60 ? '#ffd43b' : 'rgba(255,255,255,0.16)';
      for (const ax of [30, W - 30]) for (const ay of [150, 240, 330]) {
        ctx.beginPath();
        ctx.moveTo(ax - 10, ay - 8 * s.grav); ctx.lineTo(ax + 10, ay - 8 * s.grav); ctx.lineTo(ax, ay + 10 * s.grav);
        ctx.fill();
      }
    }
  }

  // roof
  {
    ctx.fillStyle = '#2b2f55';
    ctx.fillRect(0, -20, W, s.ceilY + 20);
    ctx.fillStyle = spiked ? '#ff6b6b' : '#5c63a8';
    if (spiked) {
      ctx.beginPath();
      for (let x = 0; x < W; x += 16) { ctx.moveTo(x, s.ceilY); ctx.lineTo(x + 8, s.ceilY + 9); ctx.lineTo(x + 16, s.ceilY); }
      ctx.fill();
    } else ctx.fillRect(0, s.ceilY - 3, W, 3);
  }

  // blocks
  for (const r of s.rects) {
    const gate = r.gate !== undefined;
    ctx.fillStyle = gate ? '#3b2f1a' : '#30355f';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = gate ? '#ffb84d' : '#7d86d6';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  }

  // shots
  for (const sh of s.shots) {
    const col = PLAYER_COL[sh.owner % PLAYER_COL.length];
    if (sh.kind === 'wire') {
      ctx.strokeStyle = sh.sticky ? '#8ce99a' : col;
      ctx.lineWidth = sh.sticky ? 3 : 2;
      ctx.globalAlpha = sh.t > 0 && sh.t < 40 && sh.t % 8 < 4 ? 0.35 : 1;
      ctx.beginPath();
      // wavy line
      ctx.moveTo(sh.x, H);
      for (let y = H; y > sh.y; y -= 8) ctx.lineTo(sh.x + ((y / 8) & 1 ? 2 : -2), y);
      ctx.lineTo(sh.x, sh.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(sh.x - 5, sh.y + 8); ctx.lineTo(sh.x, sh.y); ctx.lineTo(sh.x + 5, sh.y + 8); ctx.fill();
    } else if (sh.kind === 'bullet') {
      ctx.fillStyle = '#ffa94d';
      ctx.fillRect(sh.x - 2, sh.y, 4, 14);
    } else {
      const top = stopY(s, sh.x, spiked);
      ctx.fillStyle = `rgba(255,107,107,${0.25 + sh.t / 14})`;
      ctx.fillRect(sh.x - 5, top, 10, H - top);
      ctx.fillStyle = '#fff';
      ctx.fillRect(sh.x - 1.5, top, 3, H - top);
    }
  }

  // pickups
  for (const pk of s.pickups) {
    if (pk.t < 90 && pk.t % 12 < 6) continue;
    drawToken(ctx, pk.kind, pk.x, pk.y - 3 + Math.sin(s.tick * 0.12 + pk.x) * 2, 14);
  }

  // balls
  for (const b of s.balls) {
    const r = RADII[b.size];
    const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.25, BALL_COL[b.size]);
    g.addColorStop(1, shade(BALL_COL[b.size]));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
    if (b.fast) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(b.x, b.y, r + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (let a = 0; a < b.armor; a++) {
      ctx.strokeStyle = a % 2 ? '#868e96' : '#dee2e6';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, r - 2 - a * 4, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // players
  s.players.forEach((pl, i) => {
    if (s.phase === 'dead' && s.phaseT % 10 < 5) return;
    if (pl.invuln > 0 && pl.invuln % 8 < 4) return;
    // Online, the other player's position is a prediction that gets corrected. Ease toward
    // it instead of snapping, so corrections read as a quick slide rather than a teleport.
    let px = pl.x;
    if (net && i !== net.you) {
      if (s.phase !== 'play' || Math.abs(px - otherX) > 160) otherX = px;
      else { otherX += (px - otherX) * 0.4; px = otherX; }
    }
    const p = { x: px, face: pl.face, shield: pl.shield };
    const col = PLAYER_COL[i % PLAYER_COL.length];
    const x = p.x - PW / 2, y = H - PH;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.roundRect(x, y + 6, PW, PH - 6, [10, 10, 4, 4]); ctx.fill();
    ctx.fillStyle = '#10122a';
    ctx.beginPath(); ctx.roundRect(x + 4, y + 13, PW - 8, 12, 5); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x - 5 + p.face * 2, y + 16, 3, 6);
    ctx.fillRect(p.x + 2 + p.face * 2, y + 16, 3, 6);
    ctx.fillStyle = col;
    ctx.fillRect(p.x - 1.5, y, 3, 8); // antenna
    if (net && net.you === i && s.phase === 'ready') {
      ctx.beginPath(); ctx.moveTo(p.x - 8, y - 22); ctx.lineTo(p.x + 8, y - 22); ctx.lineTo(p.x, y - 10); ctx.fill();
    }
    if (p.shield) {
      ctx.strokeStyle = '#66d9e8';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, H - PH / 2, 32, 0, Math.PI * 2); ctx.stroke();
    }
  });

  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    ctx.globalAlpha = Math.min(1, p.life * 3);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  if (s.slowT > 0) { ctx.fillStyle = 'rgba(177,151,252,0.08)'; ctx.fillRect(0, 0, W, H); }
  ctx.restore();

  // HUD
  ctx.fillStyle = '#0a0b18';
  ctx.fillRect(0, H, W, 60);
  ctx.fillStyle = '#7d86d6';
  ctx.fillRect(0, H, W, 2);
  const frac = s.timeLeft / (L.time * 60);
  ctx.fillStyle = '#1c1f3d';
  ctx.fillRect(20, H + 12, W - 40, 10);
  ctx.fillStyle = frac < 0.25 ? '#ff6b6b' : '#ffd43b';
  ctx.fillRect(20, H + 12, (W - 40) * frac, 10);
  text(ctx, `${s.level + 1}/${total}  ${L.name}`, 20, H + 42, 16, '#cfd4ff', 'left');
  text(ctx, '♥'.repeat(Math.max(0, s.lives)), W / 2, H + 42, 18, '#ff8787');
  text(ctx, String(s.score).padStart(6, '0'), W - 20, H + 42, 18, '#fff', 'right');
  s.players.forEach((p, i) => {
    const hx = i === 0 ? 300 : 600;
    drawToken(ctx, p.weapon, hx, H + 42, 11);
    text(ctx, PICK[p.weapon].name, hx + 18, H + 42, 13, PLAYER_COL[i % PLAYER_COL.length], 'left');
  });

  if (net) text(ctx, net.status, W / 2, H + 22, 11, net.status.startsWith('OUT') ? '#ff6b6b' : '#8a90c7', 'center', 400);

  // overlays
  if (s.phase === 'ready') {
    if (net) text(ctx, `You are ${net.you === 0 ? 'blue' : 'pink'}`, W / 2, 275, 16, PLAYER_COL[net.you]);
    text(ctx, L.name, W / 2, 190, 40);
    if (L.hint) text(ctx, L.hint, W / 2, 235, 16, '#cfd4ff', 'center', 400);
    if (touch) text(ctx, 'Left thumb: slide to move      Right thumb: hold to fire', W / 2, 320, 15, '#8a90c7', 'center', 400);
  } else if (s.phase === 'clear') text(ctx, 'CLEAR!', W / 2, 200, 48, '#8ce99a');
  else if (s.phase === 'over') overlay(ctx, 'GAME OVER', '#ff6b6b', `Score ${s.score}  -  ${touch ? 'tap to continue' : `Enter: ${net ? 'lobby' : 'menu'}`}`);
  else if (s.phase === 'won') overlay(ctx, 'YOU WIN', '#ffd43b', `Score ${s.score}  -  ${touch ? 'tap to continue' : `Enter: ${net ? 'lobby' : 'menu'}`}`);
  if (s.paused) {
    const quit = net ? 'quit to lobby' : 'quit to menu';
    overlay(ctx, 'PAUSED', '#fff', touch ? '' : `Enter: resume      Q: ${quit}`);
    if (touch) {
      text(ctx, 'RESUME', W * 0.3, 280, 30, '#8ce99a');
      text(ctx, 'QUIT', W * 0.7, 280, 30, '#ff8787');
    } else if (net) text(ctx, 'Paused for both players', W / 2, 295, 14, '#8a90c7', 'center', 400);
  }
  if (waiting) overlay(ctx, 'WAITING', '#fff', touch ? 'for the other player...' : 'for the other player...   Esc: lobby');
  closeButton(ctx);
}

/** Round pickup token with a drawn icon. `r` is the token radius. */
function drawToken(ctx: CanvasRenderingContext2D, kind: PickupKind, x: number, y: number, r: number) {
  const c = PICK[kind].c;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#12142e';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.scale(r / 14, r / 14);
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const arrow = (ax: number) => {
    ctx.beginPath(); ctx.moveTo(ax, 8); ctx.lineTo(ax, -4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax - 3.5, -3); ctx.lineTo(ax, -9); ctx.lineTo(ax + 3.5, -3); ctx.closePath(); ctx.fill();
  };
  switch (kind) {
    case 'harpoon': arrow(0); break;
    case 'twin': arrow(-4); arrow(4); break;
    case 'anchor': { // vine: wavy stem, two leaves, grapple at the top
      ctx.beginPath(); ctx.moveTo(0, 9);
      ctx.bezierCurveTo(-5, 5, 5, 1, 0, -3); ctx.lineTo(0, -6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(-5, -8); ctx.lineTo(5, -8); ctx.lineTo(5, -5); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-4, 3, 3, 1.6, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4, 0, 3, 1.6, 0.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'pulse':
      for (const [bx, by] of [[-5, 3], [0, -4], [5, 3]]) { ctx.beginPath(); ctx.roundRect(bx - 1.5, by - 4, 3, 8, 1.5); ctx.fill(); }
      break;
    case 'beam':
      ctx.globalAlpha = 0.35; ctx.fillRect(-4, -9, 8, 18);
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillRect(-1.5, -9, 3, 18);
      break;
    case 'shield':
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, -5); ctx.lineTo(7, 0);
      ctx.quadraticCurveTo(6, 6, 0, 9); ctx.quadraticCurveTo(-6, 6, -7, 0); ctx.lineTo(-7, -5); ctx.closePath();
      ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      break;
    case 'slow': // hourglass
      ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(5, -8); ctx.lineTo(-5, 8); ctx.lineTo(5, 8); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, 7); ctx.lineTo(3, 7); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
      break;
    case 'time': // clock
      ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 0); ctx.lineTo(4, 2); ctx.stroke();
      break;
    case 'life': // heart
      ctx.beginPath(); ctx.moveTo(0, 8);
      ctx.bezierCurveTo(-12, 0, -7, -9, 0, -3);
      ctx.bezierCurveTo(7, -9, 12, 0, 0, 8); ctx.fill();
      break;
  }
  ctx.restore();
}

function overlay(ctx: CanvasRenderingContext2D, title: string, col: string, sub: string) {
  ctx.fillStyle = 'rgba(7,8,15,0.7)';
  ctx.fillRect(0, 0, W, H);
  text(ctx, title, W / 2, 200, 56, col);
  text(ctx, sub, W / 2, 260, 16, '#cfd4ff', 'center', 400);
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.floor(v * 0.45);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function backdrop(ctx: CanvasRenderingContext2D, t: number) {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  background(ctx);
  ctx.fillStyle = '#1a1236';
  ctx.fillRect(0, H, W, 60);
  for (let i = 0; i < 6; i++) {
    const r = RADII[i], x = ((t * (20 + i * 9) + i * 170) % (W + 200)) - 100;
    const y = 400 - Math.abs(Math.sin(t * (1.6 - i * 0.15) + i)) * (90 + i * 30) - r;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = BALL_COL[i];
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export interface MenuView { row: number; t: number; setName: string; levelName: string; modeName: string }

export function drawMenu(ctx: CanvasRenderingContext2D, m: MenuView) {
  backdrop(ctx, m.t);
  text(ctx, 'SPLITSTORM', W / 2, 110, 72, '#fff');
  text(ctx, 'pop them all. mind the little ones.', W / 2, 162, 16, '#cfd4ff', 'center', 400);
  const rows = [`Levels:   <  ${m.setName}  >`, `Start at: <  ${m.levelName}  >`, `Play:     <  ${m.modeName}  >`];
  rows.forEach((r, i) => text(ctx, r, W / 2, 250 + i * 44, 22, m.row === i ? '#ffd43b' : '#8a90c7'));
  text(ctx, touch ? 'TAP HERE TO PLAY' : 'Enter: go', W / 2, 400, touch ? 26 : 22, '#8ce99a');
  text(ctx, touch ? 'Tap a row to change it' : 'P1: arrows + Space      P2: A / D + W      P: pause   Esc: menu', W / 2, H + 30, 14, '#8a90c7', 'center', 400);
}

export interface LobbyView {
  role: 'host' | 'guest'; status: string; code: string; typed: string; msg: string; rtt: number;
  link: string; copied: boolean; t: number; setName: string; levelName: string;
  /** Host: which settings row is selected. */
  row: number;
  starting: boolean;
  /** Host: description of recorded session logs, or '' if there are none. */
  logInfo: string;
}

/** Vertical positions of the lobby's tappable lines (view coordinates). */
export const LOBBY_Y = { link: 222, set: 322, level: 356, log: 398, start: 446 };

export function drawLobby(ctx: CanvasRenderingContext2D, v: LobbyView) {
  backdrop(ctx, v.t);
  const dots = '.'.repeat(1 + (Math.floor(v.t * 2) % 3));
  const sub = (s: string, y: number, c = '#cfd4ff') => text(ctx, s, W / 2, y, 16, c, 'center', 400);
  const host = v.role === 'host';
  const settings = (editable: boolean) => {
    const row = (label: string, value: string, y: number, on: boolean) =>
      text(ctx, editable ? `${label} <  ${value}  >` : `${label} ${value}`, W / 2, y, 20, on ? '#ffd43b' : '#8a90c7');
    row('Levels:  ', v.setName, LOBBY_Y.set, editable && v.row === 0);
    row('Start at:', v.levelName, LOBBY_Y.level, editable && v.row === 1);
  };
  text(ctx, host ? 'HOST A GAME' : 'JOIN A GAME', W / 2, 62, 36);
  let foot = 'Esc: back', action = '';
  if (v.status === 'error') {
    text(ctx, v.msg, W / 2, 220, 20, '#ff6b6b');
    foot = 'Enter: try again   Esc: back';
    action = 'Tap to try again';
  } else if (host) {
    if (v.status === 'opening') sub(`Opening a room${dots}`, 220);
    else {
      sub('Room code', 104);
      text(ctx, v.code.split('').join(' '), W / 2, 150, 56, '#ffd43b');
      sub(v.link, LOBBY_Y.link - 14, '#8a90c7');
      sub(v.copied ? 'Invite link copied.' : touch ? 'Tap here to share the invite link' : 'C: copy invite link', LOBBY_Y.link + 10, v.copied ? '#8ce99a' : '#cfd4ff');
      if (v.status === 'connected') {
        text(ctx, v.starting ? `Starting${dots}` : `Friend connected${v.rtt >= 0 ? `  (${v.rtt} ms)` : ''}`, W / 2, 278, 20, '#8ce99a');
        foot = 'Up/Down, Left/Right: change level   Enter: start   Esc: close room';
        action = 'TAP HERE TO START';
      } else sub(`Waiting for your friend${dots}`, 278);
      settings(true);
      if (v.logInfo) sub(`${touch ? 'Tap' : 'L'}: save ${v.logInfo}`, LOBBY_Y.log, '#8a90c7');
    }
  } else if (v.status === 'enter') {
    sub('Type the room code', 150);
    text(ctx, (v.typed + '____').slice(0, 4).split('').join(' '), W / 2, 215, 64, '#ffd43b');
    foot = v.typed.length === 4 ? 'Enter: connect   Esc: back' : 'Esc: back';
    action = 'Tap to type the code';
  } else if (v.status === 'connecting') sub(`Connecting to room ${v.code}${dots}`, 220);
  else {
    text(ctx, `Connected${v.rtt >= 0 ? `  (${v.rtt} ms)` : ''}`, W / 2, 190, 24, '#8ce99a');
    sub(`Waiting for the host to start${dots}`, 235);
    sub('The host has picked:', 286, '#8a90c7');
    settings(false);
  }
  if (touch) {
    text(ctx, action, W / 2, LOBBY_Y.start, 24, '#8ce99a');
    closeButton(ctx);
  } else text(ctx, foot, W / 2, H + 30, 14, '#8a90c7', 'center', 400);
}
