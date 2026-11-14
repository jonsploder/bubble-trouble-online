import { H, PH, PW, RADII, W, hasSpikes, levelAt, stopY } from './sim';
import type { GameEvent, Level, PickupKind, State, Mode } from './sim';
import { LANCE_LEN, MODES, REVIVE_NEED, REVIVE_R, REVIVE_TICKS, SWORD_REACH, TETHER, VERSUS_WINS, roped } from './sim';

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
  haste: { c: '#fcc419', label: '!', name: 'Haste' },
  stub: { c: '#ced4da', label: 'h', name: 'Short harpoon' },
  sword: { c: '#ffd8a8', label: '/', name: 'Sword' },
  side: { c: '#63e6be', label: '>', name: 'Floor bolt' },
  rocket: { c: '#ffa8a8', label: '^', name: 'Rocket' },
  lance: { c: '#91a7ff', label: '|', name: 'Lance' },
  master: { c: '#e0b56e', label: '@', name: 'Rope master' },
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
const otherX = [0, 0, 0, 0]; // smoothed draw positions of the remote players
const COLOR_NAMES = ['blue', 'pink', 'green', 'yellow'];

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

export function drawGame(ctx: CanvasRenderingContext2D, s: State, L: Level, where: string, dt: number, waiting = false, net?: { you: number; status: string }) {
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
    } else if (sh.kind === 'slash') {
      // a quick arc in front of the body
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.globalAlpha = Math.min(1, sh.t / 5);
      ctx.beginPath(); ctx.arc(sh.x, H - 16, SWORD_REACH - 2, sh.v > 0 ? -1.25 : Math.PI - 0.35, sh.v > 0 ? 0.35 : Math.PI + 1.25); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (sh.kind === 'dartx') {
      const d = Math.sign(sh.v), tail = Math.min(60, Math.abs(sh.v) * 0.05);
      ctx.fillStyle = col; ctx.globalAlpha = 0.4;
      ctx.fillRect(Math.min(sh.x, sh.x - d * tail), sh.y - 1.5, tail, 3);
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(sh.x + d * 8, sh.y); ctx.lineTo(sh.x - d * 5, sh.y - 5); ctx.lineTo(sh.x - d * 5, sh.y + 5); ctx.fill();
    } else if (sh.kind === 'darty') {
      const tail = Math.min(60, Math.abs(sh.v) * 0.05);
      ctx.fillStyle = col; ctx.globalAlpha = 0.4;
      ctx.fillRect(sh.x - 1.5, sh.y + 10, 3, tail);
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x - 5, sh.y + 13); ctx.lineTo(sh.x + 5, sh.y + 13); ctx.fill();
    } else if (sh.kind === 'lance') {
      const y1 = Math.min(H, sh.y + LANCE_LEN);
      ctx.fillStyle = col; ctx.globalAlpha = 0.35;
      ctx.fillRect(sh.x - 3, sh.y, 6, y1 - sh.y);
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff';
      ctx.fillRect(sh.x - 1, sh.y, 2, y1 - sh.y);
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

  // portals: pairs are orange and blue (both work both ways); a chain is numbered 1 -> 2 -> 3 -> 1
  const CHAIN_COL = ['#ff922b', '#cc5de8', '#4dabf7', '#51cf66', '#ffd43b'];
  const portalList: [number, number, string, string][] = [];
  (L.portals ?? []).forEach(([ax, ay, bx, by]) => { portalList.push([ax, ay, '#ff922b', ''], [bx, by, '#4dabf7', '']); });
  (L.chain ?? []).forEach(([x, y], k) => portalList.push([x, y, CHAIN_COL[k % CHAIN_COL.length], String(k + 1)]));
  if (portalList.length) {
    portalList.forEach(([px, py, pc, label]) => {
      for (const [x, y, c] of [[px, py, pc]] as [number, number, string][]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = c;
        ctx.shadowColor = c;
        ctx.shadowBlur = 14;
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = 0.9 - k * 0.25;
          ctx.lineWidth = 3 - k;
          ctx.beginPath(); ctx.ellipse(0, 0, 22 - k * 5, 34 - k * 8, 0, s.tick * 0.08 + k, s.tick * 0.08 + k + Math.PI * 1.5); ctx.stroke();
        }
        ctx.restore();
        if (label) text(ctx, label, x, y + 1, 15, c);
      }
    });
  }

  // Tethered: a rope between neighbouring players, sagging when slack and taut when stretched
  if (roped(s.mode)) {
    for (let i = 0; i + 1 < s.players.length; i++) {
      const a = s.players[i], b = s.players[i + 1];
      if (a.down || b.down) continue;
      const span = Math.abs(b.x - a.x), sag = Math.max(0, 1 - span / TETHER) * 40, y = H - PH / 2;
      ctx.strokeStyle = span > TETHER - 12 ? '#ff8787' : '#c9a66b';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, y); ctx.quadraticCurveTo((a.x + b.x) / 2, y + sag, b.x, y); ctx.stroke();
      // whoever holds the rope has it wound round a fist
      for (const m of [a, b]) if (m.master) { ctx.fillStyle = '#e0b56e'; ctx.beginPath(); ctx.arc(m.x, y, 7, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // Revive: a circle to stand in, a countdown bar, and progress
  if (s.mode === 'revive') {
    s.players.forEach((p, i) => {
      if (!p.down || p.rt <= 0) return;
      const col = PLAYER_COL[i % PLAYER_COL.length], left = p.rt / REVIVE_TICKS;
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.ellipse(p.x, H - 4, REVIVE_R, 9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(p.x - 30, H - PH - 30, 60, 8);
      ctx.fillStyle = left < 0.33 && s.tick % 20 < 10 ? '#ff6b6b' : left < 0.33 ? '#ffa8a8' : '#ffd43b';
      ctx.fillRect(p.x - 30, H - PH - 30, 60 * left, 8);
      if (p.rp > 0) {
        ctx.strokeStyle = '#8ce99a';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(p.x, H - PH / 2, 26, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * p.rp) / REVIVE_NEED); ctx.stroke();
      }
      text(ctx, `${Math.ceil(p.rt / 60)}`, p.x, H - PH - 44, 14, '#fff');
      ctx.restore();
    });
  }

  // balls
  const splitsVary = s.balls.some((b) => b.split !== 2) || !!L.split || L.balls.some((b) => b.split !== undefined);
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
    // how many pieces it splits into, when that isn't the usual two (or when the level mixes them)
    if (b.size > 0 && splitsVary) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 4;
      text(ctx, String(b.split), b.x, b.y + 1, Math.max(10, Math.min(26, r * 0.9)), b.split === 2 ? 'rgba(255,255,255,0.75)' : '#ffffff');
      ctx.restore();
    }
  }

  // players
  s.players.forEach((pl, i) => {
    if (pl.lives <= 0 && pl.down) return; // out of the game
    if (pl.ride >= 0) return; // rides in someone else's body
    if (pl.invuln > 0 && pl.invuln % 8 < 4) return;
    if (s.mode === 'revive' && pl.down && pl.rt <= 0) return;
    if (pl.haste > 0 && !pl.down) {
      // speed lines behind a hasted player
      ctx.fillStyle = PLAYER_COL[i % PLAYER_COL.length];
      for (let k = 1; k <= 3; k++) {
        ctx.globalAlpha = 0.25 - k * 0.06;
        ctx.fillRect(pl.x - PW / 2 - pl.face * k * 9, H - PH + 8, PW, PH - 8);
      }
    }
    ctx.globalAlpha = pl.down ? 0.22 : 1; // hit on this attempt: a ghost where they fell
    // Online, the other player's position is a prediction that gets corrected. Ease toward
    // it instead of snapping, so corrections read as a quick slide rather than a teleport.
    let px = pl.x;
    if (net && i !== net.you) {
      if (s.phase !== 'play' || Math.abs(px - otherX[i]) > 160) otherX[i] = px;
      else { otherX[i] += (px - otherX[i]) * 0.4; px = otherX[i]; }
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
    const rider = s.players.findIndex((q) => q.ride === i);
    if (rider >= 0) {
      // two heads: the gunner's colour on the lower half, and a second antenna
      ctx.fillStyle = PLAYER_COL[rider % PLAYER_COL.length];
      ctx.beginPath(); ctx.roundRect(x, y + 28, PW, PH - 28, [0, 0, 4, 4]); ctx.fill();
      ctx.fillRect(p.x + 4.5, y, 3, 8);
      ctx.fillStyle = col;
      ctx.fillRect(p.x - 7.5, y, 3, 8);
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(p.x - 1.5, y, 3, 8); // antenna
    }
    if (s.mode === 'onegun' || s.mode === 'vip') drawRole(ctx, pl.vip ? 'vip' : pl.armed && s.mode === 'onegun' ? 'gun' : '', p.x, y, s.tick);
    if (net && net.you === i && s.phase === 'ready') {
      ctx.beginPath(); ctx.moveTo(p.x - 8, y - 22); ctx.lineTo(p.x + 8, y - 22); ctx.lineTo(p.x, y - 10); ctx.fill();
    }
    if (p.shield) {
      ctx.strokeStyle = '#66d9e8';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, H - PH / 2, 32, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
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
  text(ctx, s.mode === 'versus' ? `${L.name}  -  first to ${VERSUS_WINS}` : `${where}  ${L.name}`, 20, H + 42, 16, '#cfd4ff', 'left');
  if (s.mode === 'revive') text(ctx, `team ${'♥'.repeat(Math.max(0, s.team))}`, W - 110, H + 42, 16, '#ff8787', 'right');
  text(ctx, String(s.score).padStart(6, '0'), W - 20, H + 42, 18, '#fff', 'right');
  s.players.forEach((p, i) => {
    // one block per player: weapon icon, then their own lives in their own colour
    const hx = 300 + (i * 500) / s.players.length;
    ctx.globalAlpha = p.lives > 0 ? 1 : 0.3;
    if (p.vip) drawRole(ctx, 'vip', hx, H + 46, 0, 0.8);
    else {
      if (!p.armed) ctx.globalAlpha *= 0.3; // can't shoot in this mode
      drawToken(ctx, p.weapon, hx, H + 42, 11);
      ctx.globalAlpha = p.lives > 0 ? 1 : 0.3;
    }
    const label = s.mode === 'revive' ? '' : p.lives > 0 ? '♥'.repeat(p.lives) : 'out';
    text(ctx, label, hx + 18, H + 43, p.lives > 0 ? 17 : 13, PLAYER_COL[i % PLAYER_COL.length], 'left');
    const after = hx + 18 + (label.length ? label.length * 11 + 8 : 0);
    if (s.mode === 'versus') text(ctx, '★'.repeat(p.wins) + '☆'.repeat(Math.max(0, VERSUS_WINS - p.wins)), after, H + 43, 14, '#ffd43b', 'left');
    else if (p.haste > 0) text(ctx, 'HASTE', after, H + 43, 11, '#fcc419', 'left');
    ctx.globalAlpha = 1;
  });

  if (net) text(ctx, net.status, W / 2, H + 22, 11, net.status.startsWith('OUT') ? '#ff6b6b' : '#8a90c7', 'center', 400);

  // overlays
  if (s.phase === 'ready') {
    if (net) text(ctx, `You are ${COLOR_NAMES[net.you]}`, W / 2, 275, 16, PLAYER_COL[net.you]);
    if (s.mode !== 'classic' && s.mode !== 'versus') {
      const me = net ? s.players[net.you] : undefined;
      const roles = s.mode === 'onegun' || s.mode === 'vip';
      const duo = s.mode === 'duo' && me ? (me.ride >= 0 ? 'You shoot' : s.players.some((q) => q.ride === net!.you) ? 'You move' : '') : '';
      const role = duo ? duo : me && roles ? (me.vip ? 'You are the VIP. Stay alive!' : me.armed ? (s.mode === 'onegun' ? 'You have the gun!' : 'Protect the VIP!') : 'No gun. Dodge!') : '';
      text(ctx, role || MODES.find((x) => x.id === s.mode)!.hint, W / 2, 302, 16, '#ffd43b', 'center', role ? 700 : 400);
    }
    if (s.mode !== 'versus' && L.floor && / 1\//.test(where)) text(ctx, `FLOOR ${L.floor}`, W / 2, 140, 18, '#ffd43b');
    text(ctx, L.name, W / 2, 190, 40);
    if (touch) text(ctx, 'Left thumb: slide to move      Right thumb: hold to fire', W / 2, 320, 15, '#8a90c7', 'center', 400);
  } else if (s.phase === 'clear') text(ctx, 'CLEAR!', W / 2, 200, 48, '#8ce99a');
  else if (s.phase === 'over') overlay(ctx, 'GAME OVER', '#ff6b6b', `Score ${s.score}  -  ${touch ? 'tap to continue' : `Enter: ${net ? 'lobby' : 'menu'}`}`);
  else if (s.phase === 'won') overlay(ctx, 'YOU WIN', '#ffd43b', `Score ${s.score}  -  ${touch ? 'tap to continue' : `Enter: ${net ? 'lobby' : 'menu'}`}`);
  if (s.paused) {
    const quit = net ? 'quit to lobby' : 'quit to menu';
    ctx.fillStyle = 'rgba(7,8,15,0.88)';
    ctx.fillRect(0, 0, W, H);
    text(ctx, 'PAUSED', W / 2, 46, 40, '#fff');
    text(ctx, net ? 'Paused for everyone' : L.hint ?? '', W / 2, 82, 14, '#8a90c7', 'center', 400);
    // every mode's rules, the one being played picked out
    MODES.forEach((m, k) => {
      const y = 122 + k * 46, on = m.id === s.mode;
      if (on) { ctx.fillStyle = 'rgba(255,212,59,0.08)'; ctx.fillRect(40, y - 20, W - 80, 42); }
      text(ctx, m.name, 60, y - 6, 15, on ? '#ffd43b' : '#cfd4ff', 'left');
      text(ctx, m.hint, 60, y + 11, 12, on ? '#fff' : '#8a90c7', 'left', 400);
    });
    if (touch) {
      text(ctx, 'RESUME', W * 0.3, 418, 28, '#8ce99a');
      text(ctx, 'QUIT', W * 0.7, 418, 28, '#ff8787');
    } else text(ctx, `Enter: resume      Q: ${quit}`, W / 2, 418, 16, '#cfd4ff', 'center', 400);
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
    case 'haste': // lightning bolt
      ctx.beginPath(); ctx.moveTo(2, -10); ctx.lineTo(-6, 1); ctx.lineTo(-1, 1); ctx.lineTo(-3, 10); ctx.lineTo(6, -2); ctx.lineTo(1, -2); ctx.closePath(); ctx.fill();
      break;
    case 'stub': // a short arrow under a bar
      ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(6, -8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3.5, 1); ctx.lineTo(0, -5); ctx.lineTo(3.5, 1); ctx.closePath(); ctx.fill();
      break;
    case 'sword':
      ctx.beginPath(); ctx.moveTo(-6, 7); ctx.lineTo(6, -8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, 1); ctx.lineTo(-1, 6); ctx.stroke();
      break;
    case 'side':
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(3, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -4); ctx.lineTo(9, 0); ctx.lineTo(2, 4); ctx.closePath(); ctx.fill();
      break;
    case 'rocket':
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-4.5, 2); ctx.lineTo(4.5, 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-3, 5); ctx.lineTo(0, 9); ctx.lineTo(3, 5); ctx.stroke();
      break;
    case 'lance':
      ctx.fillRect(-1, -9, 2, 18);
      ctx.globalAlpha = 0.35; ctx.fillRect(-3, -9, 6, 18); ctx.globalAlpha = 1;
      break;
    case 'master': // a loop of rope
      ctx.beginPath(); ctx.arc(0, -2, 5.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(-6, 9); ctx.moveTo(3, 3); ctx.lineTo(6, 9); ctx.stroke();
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

/** Vertical positions of the menu's rows and play button (view coordinates). */
export const MENU_Y = { rows: 250, gap: 44, go: 420 };

export interface MenuView {
  /** The chosen mode needs more players than the chosen way of playing gives. */
  blocked: boolean;
  row: number; t: number; gameMode: { id: Mode; name: string; hint: string }; playName: string }

export function drawMenu(ctx: CanvasRenderingContext2D, m: MenuView) {
  backdrop(ctx, m.t);
  text(ctx, 'SPLITSTORM', W / 2, 110, 72, '#fff');
  text(ctx, 'pop them all. mind the little ones.', W / 2, 162, 16, '#cfd4ff', 'center', 400);
  const rows = [`Mode:     <  ${m.gameMode.name}  >`, `Play:     <  ${m.playName}  >`];
  rows.forEach((r, i) => text(ctx, r, W / 2, MENU_Y.rows + i * MENU_Y.gap, 22, m.row === i ? '#ffd43b' : '#8a90c7'));
  const hint = m.gameMode.id === 'classic' ? '' : m.gameMode.hint;
  if (hint) text(ctx, hint, W / 2, MENU_Y.rows + 2 * MENU_Y.gap, 13, '#8a90c7', 'center', 400);
  if (m.blocked) text(ctx, `${m.gameMode.name} needs 2+ players`, W / 2, MENU_Y.go, 18, '#ff8787');
  else text(ctx, touch ? 'TAP HERE TO PLAY' : 'Enter: go', W / 2, MENU_Y.go, touch ? 26 : 22, '#8ce99a');
  text(ctx, touch ? 'Tap a row to change it' : 'P1: arrows + Space      P2: A / D + W      P: pause   Esc: menu', W / 2, H + 30, 14, '#8a90c7', 'center', 400);
}

/** Layout of the tower screen (view coordinates), shared with the touch handling. */
export const TOWER_UI = { top: 76, slabH: 40, gap: 5, cx: 236, w: 400, listX: 520, listY: 176, listGap: 31, goY: 470 };

export interface TowerView {
  t: number;
  /** Top floor last. `levels` holds names, or '' for a level not seen yet. */
  floors: { name: string; locked: boolean; levels: string[] }[];
  floor: number; // selected floor
  level: number; // selected level on it; 0 = climb from the checkpoint, anything else is practice
}

export function drawTower(ctx: CanvasRenderingContext2D, v: TowerView) {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = '#07080f';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const U = TOWER_UI, n = v.floors.length;
  text(ctx, 'THE TOWER', U.cx - U.w / 2, 50, 30, '#fff', 'left');
  v.floors.forEach((f, i) => {
    const w = U.w * (1 - i * 0.04), x = U.cx - w / 2, y = U.top + (n - 1 - i) * (U.slabH + U.gap);
    const on = i === v.floor;
    ctx.fillStyle = f.locked ? '#0b0c18' : '#1b1e3d';
    ctx.fillRect(x, y, w, U.slabH);
    ctx.lineWidth = 2;
    ctx.strokeStyle = on ? '#ffa94d' : f.locked ? '#1e2140' : '#7d86d6';
    ctx.strokeRect(x, y, w, U.slabH);
    const col = f.locked ? '#5b6090' : '#e8eaf6';
    text(ctx, String(i + 1), x + 16, y + U.slabH / 2 + 1, 20, col, 'left');
    text(ctx, f.locked ? '? ? ?' : f.name, x + 48, y + U.slabH / 2 + 1, 15, col, 'left', 600);
    if (f.locked) {
      // padlock
      const lx = x + w - 24, ly = y + U.slabH / 2;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(lx - 5, ly - 1, 10, 7);
      ctx.beginPath(); ctx.arc(lx, ly - 1, 3, Math.PI, 0); ctx.stroke();
    } else {
      f.levels.forEach((name, k) => {
        const px = x + w - 16 - (f.levels.length - 1 - k) * 11;
        ctx.beginPath(); ctx.arc(px, y + U.slabH / 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd43b'; ctx.strokeStyle = '#7d86d6'; ctx.lineWidth = 1;
        if (name) ctx.fill(); else ctx.stroke();
      });
    }
  });
  ctx.fillStyle = '#2b2f55';
  ctx.fillRect(U.cx - U.w / 2 - 12, U.top + n * (U.slabH + U.gap), U.w + 24, 4);

  const f = v.floors[v.floor];
  text(ctx, `FLOOR ${v.floor + 1}`, U.listX, 100, 13, '#ffa94d', 'left');
  text(ctx, f.name, U.listX, 132, 30, '#fff', 'left');
  f.levels.forEach((name, k) => {
    const y = U.listY + k * U.listGap, on = k === v.level;
    text(ctx, String(k + 1), U.listX, y, 15, '#8a90c7', 'left', 400);
    text(ctx, name || '? ? ?', U.listX + 28, y, 17, on ? '#ffd43b' : name ? '#e8eaf6' : '#5b6090', 'left', on ? 700 : 400);
  });
  const go = v.level ? 'practice' : 'climb';
  text(ctx, touch ? `TAP HERE TO ${go.toUpperCase()}` : `Enter: ${go}`, U.listX, U.goY, 22, '#8ce99a', 'left');
  if (touch) closeButton(ctx);
  else text(ctx, 'Up/Down: floor   Left/Right: level   Esc: back', W / 2, H + 44, 13, '#8a90c7', 'center', 400);
}

export interface LobbyView {
  role: 'host' | 'guest'; status: string; code: string; typed: string; msg: string;
  /** Who is in the room, e.g. "3 of 4 players in the room". */
  room: string;
  modeName: string;
  modeHint: string;
  link: string; copied: boolean; t: number;
  /** The floor the host has picked, and the floor each player in the room has reached. */
  floor: number; reached: number[];
  /** Host: which settings row is selected. */
  row: number;
  starting: boolean;
}

/** Vertical positions of the lobby's tappable lines (view coordinates). */
export const LOBBY_Y = { link: 222, floor: 322, mode: 366, start: 446 };

export function drawLobby(ctx: CanvasRenderingContext2D, v: LobbyView) {
  backdrop(ctx, v.t);
  const dots = '.'.repeat(1 + (Math.floor(v.t * 2) % 3));
  const sub = (s: string, y: number, c = '#cfd4ff') => text(ctx, s, W / 2, y, 16, c, 'center', 400);
  const host = v.role === 'host';
  const settings = (editable: boolean) => {
    const row = (label: string, value: string, y: number, on: boolean) =>
      text(ctx, editable ? `${label} <  ${value}  >` : `${label} ${value}`, W / 2, y, 20, on ? '#ffd43b' : '#8a90c7');
    row('Floor:', String(v.floor + 1), LOBBY_Y.floor, editable && v.row === 0);
    if (v.reached.length > 1) text(ctx, v.reached.map((r) => r + 1).join('  ·  '), W / 2, LOBBY_Y.floor + 20, 12, '#8a90c7', 'center', 400);
    row('Mode: ', v.modeName, LOBBY_Y.mode, editable && v.row === 1);
    if (v.modeHint && v.modeName !== 'Classic') text(ctx, v.modeHint, W / 2, LOBBY_Y.mode + 26, 13, '#8a90c7', 'center', 400);
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
        text(ctx, v.starting ? `Starting${dots}` : v.room, W / 2, 278, 20, '#8ce99a');
        foot = 'Arrows: change   Enter: start   Esc: close room';
        action = 'TAP HERE TO START';
      } else sub(`Waiting for friends to join${dots}  (up to 4 players)`, 278);
      settings(true);
    }
  } else if (v.status === 'enter') {
    sub('Type the room code', 150);
    text(ctx, (v.typed + '____').slice(0, 4).split('').join(' '), W / 2, 215, 64, '#ffd43b');
    foot = v.typed.length === 4 ? 'Enter: connect   Esc: back' : 'Esc: back';
    action = 'Tap to type the code';
  } else if (v.status === 'connecting') sub(`Connecting to room ${v.code}${dots}`, 220);
  else {
    text(ctx, v.room || 'Connected', W / 2, 190, 24, '#8ce99a');
    sub(`Waiting for the host to start${dots}`, 235);
    settings(false);
  }
  if (touch) {
    text(ctx, action, W / 2, LOBBY_Y.start, 24, '#8ce99a');
    closeButton(ctx);
  } else text(ctx, foot, W / 2, H + 30, 14, '#8a90c7', 'center', 400);
}

/** Gun bearer (a harpoon held up, gold) or VIP (a crown) marker drawn over a player. */
function drawRole(ctx: CanvasRenderingContext2D, role: 'gun' | 'vip' | '', x: number, y: number, tick: number, scale = 1) {
  if (!role) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const bob = Math.sin(tick * 0.15) * 1.5;
  if (role === 'vip') {
    ctx.fillStyle = '#ffd43b';
    ctx.strokeStyle = '#7a5a00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-11, -6 + bob); ctx.lineTo(-11, -17 + bob); ctx.lineTo(-5, -11 + bob); ctx.lineTo(0, -20 + bob);
    ctx.lineTo(5, -11 + bob); ctx.lineTo(11, -17 + bob); ctx.lineTo(11, -6 + bob); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath(); ctx.arc(0, -10 + bob, 2, 0, Math.PI * 2); ctx.fill();
  } else {
    // a gold harpoon held over the shoulder, with a glow so it reads at a glance
    ctx.shadowColor = '#ffd43b';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#ffd43b';
    ctx.fillStyle = '#ffd43b';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(12, 30); ctx.lineTo(12, -12 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -8 + bob); ctx.lineTo(12, -20 + bob); ctx.lineTo(18, -8 + bob); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

export interface ResultsView { s: State; you: number; levels: Level[]; online: boolean; t: number }

/** End-of-game stats: one row per player, best in each column picked out. */
export function drawResults(ctx: CanvasRenderingContext2D, v: ResultsView) {
  backdrop(ctx, v.t);
  ctx.fillStyle = 'rgba(7,8,15,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const s = v.s, L = levelAt(s, v.levels);
  let [title, col] = s.phase === 'won' ? ['YOU WIN', '#ffd43b'] : s.phase === 'over' ? ['GAME OVER', '#ff6b6b'] : ['GAME ENDED', '#fff'];
  if (s.mode === 'versus') {
    const top = Math.max(...s.players.map((p) => (p.lives > 0 ? p.wins : -1)));
    const best = s.players.map((p, i) => (p.lives > 0 && p.wins === top ? i : -1)).filter((i) => i >= 0);
    if (s.phase === 'won' && best.length === 1) [title, col] = [`${COLOR_NAMES[best[0]].toUpperCase()} WINS`, PLAYER_COL[best[0]]];
  }
  text(ctx, title, W / 2, 56, 44, col);
  const mode = MODES.find((m) => m.id === s.mode)!.name;
  text(ctx, s.mode === 'versus' ? `${mode}  -  ${s.level + 1} rounds played` : `${mode}  -  reached level ${s.level + 1}/${v.levels.length} (${L?.name ?? ''})  -  team score ${s.score}`, W / 2, 98, 15, '#cfd4ff', 'center', 400);

  const time = (ticks: number) => { const sec = Math.round(ticks / 60); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const cols: { h: string; get: (i: number) => number; show: (n: number) => string; low?: boolean }[] = [
    { h: 'Popped', get: (i) => s.players[i].st.pops, show: String },
    { h: 'Points', get: (i) => s.players[i].st.score, show: String },
    { h: 'Time alive', get: (i) => s.players[i].st.alive, show: time },
    { h: 'Lives lost', get: (i) => s.players[i].st.deaths, show: String, low: true },
    { h: 'Shots', get: (i) => s.players[i].st.shots, show: String },
    { h: 'Pickups', get: (i) => s.players[i].st.picks, show: String },
    ...(s.mode === 'versus' ? [{ h: 'Rounds won', get: (i: number) => s.players[i].wins, show: String }] : []),
    ...(s.mode === 'revive' ? [{ h: 'Revives', get: (i: number) => s.players[i].st.revives, show: String }] : []),
  ];
  const x0 = 170, dx = (W - x0 - 40) / cols.length, top = 150;
  cols.forEach((c, k) => text(ctx, c.h, x0 + dx * (k + 0.5), top, 14, '#8a90c7', 'center', 400));
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(40, top + 16, W - 80, 1);
  const n = s.players.length;
  for (let i = 0; i < n; i++) {
    const y = top + 48 + i * 46;
    if (i === v.you) { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(40, y - 20, W - 80, 40); }
    const name = n === 1 ? 'You' : COLOR_NAMES[i][0].toUpperCase() + COLOR_NAMES[i].slice(1) + (i === v.you ? ' (you)' : '');
    text(ctx, name, 56, y, 18, PLAYER_COL[i % PLAYER_COL.length], 'left');
    cols.forEach((c, k) => {
      const vals = s.players.map((_, j) => c.get(j));
      const best = c.low ? Math.min(...vals) : Math.max(...vals);
      const top1 = n > 1 && vals[i] === best && vals.filter((x) => x === best).length < n;
      text(ctx, c.show(vals[i]), x0 + dx * (k + 0.5), y, 18, top1 ? '#ffd43b' : '#fff', 'center', top1 ? 700 : 400);
    });
  }
  // awards: every player's figure, best first
  const P = s.players, short = (i: number) => (n === 1 ? 'You' : COLOR_NAMES[i][0].toUpperCase() + COLOR_NAMES[i].slice(1));
  const acc = (i: number) => (P[i].st.shots >= 10 ? P[i].st.pops / P[i].st.shots : -1);
  const awards: { h: string; get: (i: number) => number; show: (x: number) => string; low?: boolean }[] = [
    { h: 'Most reckless', get: (i) => P[i].st.danger, show: (x) => `${(x / 60).toFixed(1)} s` },
    { h: 'Closest shave', get: (i) => P[i].st.shave, show: (x) => (x < 16 ? `${x.toFixed(1)} px` : '-'), low: true },
    { h: 'Sharpshooter', get: (i) => acc(i), show: (x) => (x < 0 ? '-' : `${Math.round(x * 100)}%`) },
  ];
  awards.forEach((a, k) => {
    const x = W / 2 + (k - 1) * 280;
    text(ctx, a.h.toUpperCase(), x, 372, 12, '#8a90c7');
    const order = P.map((_, i) => i).sort((i, j) => (a.low ? a.get(i) - a.get(j) : a.get(j) - a.get(i)) || i - j);
    order.forEach((i, r) => {
      const y = 394 + r * 20;
      text(ctx, short(i), x - 8, y, r === 0 ? 16 : 14, PLAYER_COL[i % PLAYER_COL.length], 'right', r === 0 ? 700 : 400);
      text(ctx, a.show(a.get(i)), x + 8, y, r === 0 ? 16 : 14, r === 0 ? '#fff' : '#cfd4ff', 'left', r === 0 ? 700 : 400);
    });
  });
  text(ctx, touch ? 'TAP TO CONTINUE' : `Enter: back to the ${v.online ? 'lobby' : 'menu'}`, W / 2, H + 20, touch ? 22 : 16, '#8ce99a');
}
