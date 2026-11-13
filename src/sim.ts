// Deterministic game simulation.
//
// Rules for this file (they are what make online play possible later):
//  - step() is a pure function of (state, inputs). No Math.random, no Date, no DOM.
//  - All state lives in the plain-JSON `State` object, so it can be snapshotted,
//    restored (rollback) and hashed (desync detection).
//  - Runs at a fixed 60 ticks per second.

export const W = 960;
export const H = 480; // floor y
export const DT = 1 / 60;

const G = 900;
const VX = 105;
export const RADII = [8, 13, 20, 29, 40, 52];
// Height the bottom of the ball reaches above the surface it bounced on.
// Size 0 clears the player's head (44px) by a little: you can stand under it, just.
const BOUNCE_H = [62, 108, 150, 190, 226, 258];
const BOUNCE_V = BOUNCE_H.map((h) => Math.sqrt(2 * G * h));
const FAST = 1.6;

export const PW = 26;
export const PH = 44;
const PSPEED = 250;
const WIRE_SPEED = 620;
const BULLET_SPEED = 900;
const ANCHOR_TICKS = 200;
const SPIKE = 8;

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_FIRE = 4;

export type Weapon = 'harpoon' | 'twin' | 'anchor' | 'pulse' | 'beam';
export type PickupKind = Weapon | 'shield' | 'slow' | 'time' | 'life';

export interface BallDef { x: number; y: number; size: number; dir: 1 | -1; fast?: boolean; group?: number; /** Hits needed before it will pop; each hit punts it upward instead. */ armor?: number }
export interface RectDef {
  x: number; y: number; w: number; h: number; gate?: number;
  /** Slides back and forth by (dx, dy) over `period` seconds. Keep moving blocks above head height. */
  move?: { dx: number; dy: number; period: number };
}
export interface Block extends RectDef { bx: number; by: number }

export interface Level {
  name: string;
  hint?: string;
  time: number; // seconds
  balls: BallDef[];
  rects?: RectDef[];
  /** Roof descends at `speed` px/s; each pop shoves it back up by `lift` px. */
  ceiling?: { speed: number; lift: number };
  /** Spiked roof destroys balls outright instead of bouncing them. Default: on for fixed roofs. */
  spikes?: boolean;
  /** Weapon everyone starts the level with. */
  weapon?: Weapon;
  drops?: PickupKind[];
  dropRate?: number;
  /** Ball speed multiplier gained per second. */
  ramp?: number;
  /** Gravity for balls flips every `flip` seconds. */
  flip?: number;
  /** Sideways push on every ball, px/s (positive = rightwards). */
  wind?: number;
  /** The view turns upside down (and back) every `spin` seconds. Purely visual. */
  spin?: number;
  /** The view is upside down for the whole level. Purely visual. */
  upsideDown?: boolean;
  /** Player start x positions. */
  start?: number[];
}

export interface Ball { x: number; y: number; vx: number; vy: number; size: number; fast: boolean; group: number; immune: number; armor: number }
export interface Shot { kind: 'wire' | 'bullet' | 'beam'; x: number; y: number; owner: number; sticky: boolean; t: number }
export interface Pickup { x: number; y: number; kind: PickupKind; t: number }
export interface Player { x: number; face: number; weapon: Weapon; cd: number; shield: boolean; invuln: number }

export type Phase = 'ready' | 'play' | 'dead' | 'clear' | 'over' | 'won';

export interface State {
  tick: number;
  rng: number;
  level: number;
  phase: Phase;
  phaseT: number;
  lives: number;
  score: number;
  timeLeft: number; // ticks
  ceilY: number;
  speed: number;
  slowT: number;
  /** Ticks of play on the current level. */
  lt: number;
  /** 1 = normal gravity, -1 = flipped. */
  grav: number;
  balls: Ball[];
  rects: Block[];
  shots: Shot[];
  pickups: Pickup[];
  players: Player[];
}

export type GameEvent =
  | { t: 'pop'; x: number; y: number; size: number }
  | { t: 'spike'; x: number; y: number; size: number }
  | { t: 'knock'; x: number; y: number }
  | { t: 'flip' }
  | { t: 'shoot'; weapon: Weapon }
  | { t: 'pickup'; kind: PickupKind }
  | { t: 'shield' }
  | { t: 'die'; x: number }
  | { t: 'gate' }
  | { t: 'clear' }
  | { t: 'start' };

/** Fixed roofs are spiked unless the level says otherwise; descending roofs are smooth by default. */
export function hasSpikes(L: Level): boolean {
  return L.spikes ?? !(L.ceiling || L.flip);
}

const DEFAULT_DROPS: PickupKind[] = ['twin', 'anchor', 'harpoon', 'shield', 'slow', 'time'];

function rand(s: State): number {
  // mulberry32
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newGame(levels: Level[], numPlayers: number, startLevel = 0, seed = 1234567): State {
  const s: State = {
    tick: 0, rng: seed | 0, level: startLevel, phase: 'ready', phaseT: 0, lives: 3, score: 0,
    timeLeft: 0, ceilY: 0, speed: 1, slowT: 0, lt: 0, grav: 1, balls: [], rects: [], shots: [], pickups: [],
    players: [],
  };
  for (let i = 0; i < numPlayers; i++) s.players.push({ x: W / 2, face: 1, weapon: 'harpoon', cd: 0, shield: false, invuln: 0 });
  loadLevel(s, levels);
  return s;
}

function loadLevel(s: State, levels: Level[]) {
  const L = levels[s.level];
  s.balls = L.balls.map((b) => ({ x: b.x, y: b.y, vx: b.dir * VX, vy: 0, size: b.size, fast: !!b.fast, group: b.group ?? 0, immune: 0, armor: b.armor ?? 0 }));
  s.rects = (L.rects ?? []).map((r) => ({ ...r, bx: r.x, by: r.y }));
  s.lt = 0;
  s.grav = 1;
  s.shots = [];
  s.pickups = [];
  s.ceilY = 0;
  s.speed = 1;
  s.slowT = 0;
  s.timeLeft = L.time * 60;
  s.phase = 'ready';
  s.phaseT = 100;
  const n = s.players.length;
  s.players.forEach((p, i) => {
    p.x = L.start?.[i] ?? W / 2 + (i - (n - 1) / 2) * 70;
    p.face = 1;
    p.weapon = L.weapon ?? 'harpoon';
    p.cd = 0;
    p.shield = false;
    p.invuln = 0;
  });
}

/** Lowest y a shot fired straight up at x can reach (roof or underside of a block). */
export function stopY(s: State, x: number, spikes: boolean): number {
  let y = s.ceilY + (spikes ? SPIKE : 0);
  for (const r of s.rects) if (x >= r.x && x <= r.x + r.w && r.y + r.h > y) y = r.y + r.h;
  return y;
}

function segHit(b: Ball, x: number, y0: number, y1: number, pad: number): boolean {
  const cy = b.y < y0 ? y0 : b.y > y1 ? y1 : b.y;
  const dx = b.x - x, dy = b.y - cy, r = RADII[b.size] + pad;
  return dx * dx + dy * dy < r * r;
}

function pop(s: State, i: number, L: Level, ev: GameEvent[]) {
  const b = s.balls[i];
  s.balls.splice(i, 1);
  s.score += (b.size + 1) * 10;
  ev.push({ t: 'pop', x: b.x, y: b.y, size: b.size });
  if (L.ceiling) s.ceilY = Math.max(0, s.ceilY - L.ceiling.lift);
  if (b.size > 0) {
    // Halves kick upward out of the pop. Hit a big ball at the top of its arc and the
    // halves fly high enough to burst on a spiked roof.
    const cs = b.size - 1, off = RADII[cs] * 0.6, kick = -(330 + 40 * cs);
    for (const d of [-1, 1]) {
      s.balls.push({ x: b.x + d * off, y: b.y, vx: d * VX, vy: s.grav > 0 ? Math.min(b.vy, kick) : Math.max(b.vy, -kick), size: cs, fast: b.fast, group: b.group, immune: 8, armor: 0 });
    }
  }
  if (rand(s) < (L.dropRate ?? 0.14)) {
    const pool = L.drops ?? DEFAULT_DROPS;
    if (pool.length) s.pickups.push({ x: b.x, y: b.y, kind: pool[Math.floor(rand(s) * pool.length)], t: 420 });
  }
}

function stepPlayers(s: State, inputs: number[], L: Level, ev: GameEvent[], canFire: boolean) {
  s.players.forEach((p, i) => {
    const inp = inputs[i] | 0;
    const dx = (inp & IN_RIGHT ? 1 : 0) - (inp & IN_LEFT ? 1 : 0);
    if (dx) {
      const ox = p.x;
      p.face = dx;
      p.x += dx * PSPEED * DT;
      if (p.x < PW / 2) p.x = PW / 2;
      if (p.x > W - PW / 2) p.x = W - PW / 2;
      for (const r of s.rects) {
        if (r.y + r.h > H - PH && r.y < H && p.x + PW / 2 > r.x && p.x - PW / 2 < r.x + r.w) {
          p.x = ox < r.x + r.w / 2 ? r.x - PW / 2 : r.x + r.w + PW / 2;
        }
      }
    }
    if (p.cd > 0) p.cd--;
    if (p.invuln > 0) p.invuln--;
    if (!canFire || !(inp & IN_FIRE) || p.cd > 0) return;
    const w = p.weapon;
    if (w === 'pulse') {
      s.shots.push({ kind: 'bullet', x: p.x, y: H - PH, owner: i, sticky: false, t: 0 });
      p.cd = 8;
    } else if (w === 'beam') {
      s.shots.push({ kind: 'beam', x: p.x, y: 0, owner: i, sticky: false, t: 10 });
      p.cd = 60;
    } else {
      let active = 0;
      for (const sh of s.shots) if (sh.owner === i && sh.kind === 'wire') active++;
      if (active >= (w === 'twin' ? 2 : 1)) return;
      s.shots.push({ kind: 'wire', x: p.x, y: H, owner: i, sticky: w === 'anchor', t: 0 });
      p.cd = 8;
    }
    ev.push({ t: 'shoot', weapon: w });
  });
}

function stepShots(s: State, L: Level, ev: GameEvent[]) {
  const spikes = hasSpikes(L);
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const sh = s.shots[i];
    const stop = stopY(s, sh.x, spikes);
    let dead = false;
    let y0 = sh.y, y1 = H, pad = 0, pierce = false;
    if (sh.kind === 'wire') {
      if (sh.t > 0) {
        if (--sh.t === 0) dead = true;
        if (sh.y < stop) sh.y = stop;
      } else {
        sh.y -= WIRE_SPEED * DT;
        if (sh.y <= stop) {
          sh.y = stop;
          if (sh.sticky) sh.t = ANCHOR_TICKS; else dead = true;
        }
      }
      y0 = sh.y;
    } else if (sh.kind === 'bullet') {
      sh.y -= BULLET_SPEED * DT;
      if (sh.y <= stop) dead = true;
      y0 = sh.y; y1 = sh.y + 16; pad = 2;
    } else {
      if (--sh.t <= 0) dead = true;
      y0 = stop; pad = 3; pierce = true;
    }
    if (!dead) {
      for (let j = s.balls.length - 1; j >= 0; j--) {
        const b = s.balls[j];
        if (b.immune > 0 || !segHit(b, sh.x, y0, y1, pad)) continue;
        if (b.armor > 0) {
          // armoured: the hit punts it away from the floor instead of popping it
          b.armor--;
          b.immune = 12;
          const punt = 0.9 * BOUNCE_V[b.size];
          b.vy = s.grav > 0 ? Math.min(b.vy, 0) - punt : Math.max(b.vy, 0) + punt;
          s.score += 5;
          ev.push({ t: 'knock', x: b.x, y: b.y });
        } else pop(s, j, L, ev);
        if (!pierce) { dead = true; break; }
      }
    }
    if (dead) s.shots.splice(i, 1);
  }
}

function stepBalls(s: State, L: Level, ev: GameEvent[]) {
  const spikes = hasSpikes(L);
  const top = s.ceilY + (spikes ? SPIKE : 0);
  const base = s.speed * (s.slowT > 0 ? 0.35 : 1);
  const up = s.grav > 0, g = G * s.grav, wind = L.wind ?? 0;
  for (let i = s.balls.length - 1; i >= 0; i--) {
    const b = s.balls[i];
    if (b.immune > 0) b.immune--;
    const scale = base * (b.fast ? FAST : 1);
    const n = Math.max(1, Math.ceil(scale * 2));
    const dt = (DT * scale) / n;
    const r = RADII[b.size], bv = BOUNCE_V[b.size];
    let gone = false;
    for (let k = 0; k < n && !gone; k++) {
      b.vy += g * dt;
      b.x += (b.vx + wind) * dt;
      b.y += b.vy * dt;
      if (b.x - r < 0) { b.x = r; b.vx = Math.abs(b.vx); }
      if (b.x + r > W) { b.x = W - r; b.vx = -Math.abs(b.vx); }
      // the surface gravity pulls toward relaunches the ball; the opposite one just reflects it
      if (b.y + r > H) { b.y = H - r; b.vy = up ? -bv : -Math.abs(b.vy); }
      for (const q of s.rects) {
        const cx = b.x < q.x ? q.x : b.x > q.x + q.w ? q.x + q.w : b.x;
        const cy = b.y < q.y ? q.y : b.y > q.y + q.h ? q.y + q.h : b.y;
        const dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy >= r * r) continue;
        if (dx === 0 && dy === 0) {
          // centre inside the block: shove out through the nearest face
          const l = b.x - q.x, rr = q.x + q.w - b.x, t = b.y - q.y, bt = q.y + q.h - b.y;
          const m = Math.min(l, rr, t, bt);
          if (m === t) { b.y = q.y - r; b.vy = up ? -bv : -Math.abs(b.vy); }
          else if (m === bt) { b.y = q.y + q.h + r; b.vy = up ? Math.abs(b.vy) : bv; }
          else if (m === l) { b.x = q.x - r; b.vx = -Math.abs(b.vx); }
          else { b.x = q.x + q.w + r; b.vx = Math.abs(b.vx); }
        } else if (Math.abs(dx) > Math.abs(dy)) {
          b.vx = dx > 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
          b.x = cx + (dx > 0 ? r : -r);
        } else if (dy < 0) {
          b.y = cy - r; b.vy = up ? -bv : -Math.abs(b.vy);
        } else {
          b.y = cy + r; b.vy = up ? Math.abs(b.vy) : bv;
        }
      }
      if (b.y - r < top) {
        if (spikes) gone = true;
        else { b.y = top + r; b.vy = up ? Math.abs(b.vy) : bv; }
      }
    }
    if (gone) {
      s.balls.splice(i, 1);
      s.score += (b.size + 1) * 25;
      ev.push({ t: 'spike', x: b.x, y: b.y, size: b.size });
    }
  }
}

function applyPickup(s: State, p: Player, kind: PickupKind, L: Level) {
  switch (kind) {
    case 'shield': p.shield = true; break;
    case 'slow': s.slowT = 300; break;
    case 'time': s.timeLeft = Math.min(L.time * 60, s.timeLeft + 600); break;
    case 'life': s.lives = Math.min(5, s.lives + 1); break;
    default: p.weapon = kind;
  }
}

export function step(s: State, inputs: number[], levels: Level[], ev: GameEvent[]) {
  s.tick++;
  const L = levels[s.level];
  switch (s.phase) {
    case 'ready':
      stepPlayers(s, inputs, L, ev, false);
      if (--s.phaseT <= 0) { s.phase = 'play'; ev.push({ t: 'start' }); }
      return;
    case 'dead':
      if (--s.phaseT <= 0) {
        s.lives--;
        if (s.lives <= 0) s.phase = 'over'; else loadLevel(s, levels);
      }
      return;
    case 'clear':
      if (--s.phaseT <= 0) {
        if (s.level + 1 >= levels.length) s.phase = 'won';
        else { s.level++; loadLevel(s, levels); }
      }
      return;
    case 'over':
    case 'won':
      return;
  }

  // --- play ---
  stepPlayers(s, inputs, L, ev, true);
  if (s.slowT > 0) s.slowT--;
  if (L.ramp) s.speed = Math.min(2.2, s.speed + L.ramp * DT);
  if (L.ceiling) s.ceilY += L.ceiling.speed * DT;
  s.lt++;
  if (L.flip && s.lt % (L.flip * 60) === 0) { s.grav = -s.grav; ev.push({ t: 'flip' }); }
  for (const r of s.rects) {
    if (!r.move) continue;
    const T = r.move.period * 60, ph = (s.lt % T) / T, k = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    r.x = r.bx + r.move.dx * k;
    r.y = r.by + r.move.dy * k;
  }
  stepShots(s, L, ev);
  stepBalls(s, L, ev);

  // gates open once every ball of their group is gone
  for (let i = s.rects.length - 1; i >= 0; i--) {
    const g = s.rects[i].gate;
    if (g === undefined) continue;
    let alive = false;
    for (const b of s.balls) if (b.group === g) { alive = true; break; }
    if (!alive) { s.rects.splice(i, 1); ev.push({ t: 'gate' }); }
  }

  // pickups
  for (let i = s.pickups.length - 1; i >= 0; i--) {
    const pk = s.pickups[i];
    if (pk.y < H - 12) pk.y = Math.min(H - 12, pk.y + 160 * DT);
    else if (--pk.t <= 0) { s.pickups.splice(i, 1); continue; }
    if (pk.y > H - PH - 10) {
      for (const p of s.players) {
        if (Math.abs(p.x - pk.x) < PW / 2 + 12) {
          applyPickup(s, p, pk.kind, L);
          ev.push({ t: 'pickup', kind: pk.kind });
          s.pickups.splice(i, 1);
          break;
        }
      }
    }
  }

  // death checks
  let dead = false, deadX = 0;
  for (const p of s.players) {
    if (p.invuln > 0) continue;
    const x0 = p.x - PW / 2 + 3, x1 = p.x + PW / 2 - 3, y0 = H - PH + 4;
    for (const b of s.balls) {
      const cx = b.x < x0 ? x0 : b.x > x1 ? x1 : b.x;
      const cy = b.y < y0 ? y0 : b.y > H ? H : b.y;
      const dx = b.x - cx, dy = b.y - cy, r = RADII[b.size] - 1;
      if (dx * dx + dy * dy < r * r) {
        if (p.shield) { p.shield = false; p.invuln = 100; ev.push({ t: 'shield' }); }
        else { dead = true; deadX = p.x; }
        break;
      }
    }
  }
  if (s.ceilY + (hasSpikes(L) ? SPIKE : 0) >= H - PH) { dead = true; deadX = s.players[0].x; }
  if (--s.timeLeft <= 0) { s.timeLeft = 0; dead = true; deadX = s.players[0].x; }

  if (s.balls.length === 0) {
    s.phase = 'clear';
    s.phaseT = 120;
    s.score += Math.floor(s.timeLeft / 60) * 10;
    ev.push({ t: 'clear' });
  } else if (dead) {
    s.phase = 'dead';
    s.phaseT = 90;
    ev.push({ t: 'die', x: deadX });
  }
}
