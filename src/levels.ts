import type { Level } from './sim';

// Play field is 960 wide, floor at y=480. Ball x/y are centres.
// Ball sizes 0..5 (radius 8, 13, 20, 29, 40, 52). A size-n ball pops into two size n-1.
// `group` ties balls to `gate` blocks: a gate vanishes when its group is wiped out.

export const CAMPAIGN: Level[] = [
  {
    name: 'Warm-Up',
    hint: 'Move with the arrows, fire with Space.',
    time: 30,
    start: [480, 560],
    balls: [{ x: 260, y: 220, size: 2, dir: 1 }],
  },
  {
    name: 'Two-Way Street',
    time: 45,
    balls: [
      { x: 200, y: 200, size: 3, dir: 1 },
      { x: 760, y: 200, size: 3, dir: -1 },
    ],
  },
  {
    name: 'The Big One',
    hint: 'Pop it at the top of its arc and the spikes help out.',
    time: 60,
    start: [180, 110],
    balls: [{ x: 600, y: 170, size: 4, dir: -1 }],
  },
  {
    name: 'Open Sesame',
    hint: 'Clear your side and the gate opens.',
    time: 60,
    start: [110, 50],
    rects: [{ x: 472, y: 0, w: 16, h: 480, gate: 1 }],
    balls: [
      { x: 300, y: 180, size: 3, dir: 1, group: 1 },
      { x: 640, y: 220, size: 2, dir: 1 },
      { x: 820, y: 180, size: 2, dir: -1 },
    ],
  },
  {
    name: 'Overhang',
    hint: 'The ledge blocks shots - and shelters you.',
    time: 70,
    rects: [{ x: 250, y: 264, w: 460, h: 18 }],
    balls: [
      { x: 480, y: 150, size: 3, dir: 1 },
      { x: 120, y: 300, size: 2, dir: 1 },
      { x: 840, y: 300, size: 2, dir: -1 },
    ],
  },
  {
    name: 'Squeeze',
    hint: 'The roof is coming down. Every pop shoves it back.',
    time: 70,
    ceiling: { speed: 8, lift: 10 },
    balls: [
      { x: 260, y: 200, size: 3, dir: 1 },
      { x: 700, y: 200, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Trigger Happy',
    hint: 'Rapid fire. Too rapid, maybe.',
    time: 75,
    weapon: 'pulse',
    start: [140, 80],
    drops: ['shield', 'slow'],
    dropRate: 0.1,
    balls: [{ x: 560, y: 200, size: 5, dir: -1 }],
  },
  {
    name: 'Quickstep',
    time: 60,
    start: [340, 620],
    balls: [
      { x: 160, y: 220, size: 2, dir: 1, fast: true },
      { x: 480, y: 160, size: 2, dir: -1, fast: true },
      { x: 800, y: 220, size: 2, dir: -1, fast: true },
    ],
  },
  {
    name: 'Jailbreak',
    hint: 'Clear the room and the cages open.',
    time: 90,
    start: [370, 590],
    rects: [
      { x: 292, y: 0, w: 16, h: 480, gate: 1 },
      { x: 652, y: 0, w: 16, h: 480, gate: 1 },
    ],
    balls: [
      { x: 480, y: 160, size: 3, dir: 1, group: 1 },
      { x: 140, y: 200, size: 3, dir: 1, fast: true },
      { x: 820, y: 200, size: 3, dir: -1, fast: true },
    ],
  },
  {
    name: 'Careful What You Grab',
    hint: 'Not every gift is a favour.',
    time: 90,
    start: [480, 400],
    drops: ['beam', 'pulse', 'beam', 'anchor'],
    dropRate: 0.35,
    balls: [
      { x: 200, y: 170, size: 4, dir: 1 },
      { x: 760, y: 170, size: 4, dir: -1 },
    ],
  },
  {
    name: 'Convoy',
    hint: 'The vine holds for a while. So do you.',
    time: 80,
    weapon: 'anchor',
    start: [840, 900],
    drops: ['shield', 'slow', 'time'],
    balls: [
      { x: 80, y: 200, size: 2, dir: 1 },
      { x: 200, y: 240, size: 2, dir: 1 },
      { x: 320, y: 200, size: 2, dir: 1 },
      { x: 440, y: 240, size: 2, dir: 1 },
      { x: 560, y: 200, size: 2, dir: 1 },
    ],
  },
  {
    name: 'Pressure Cooker',
    hint: 'Lower roof, shorter bounces, faster everything.',
    time: 80,
    ceiling: { speed: 9, lift: 8 },
    ramp: 0.01,
    start: [480, 400],
    balls: [
      { x: 220, y: 200, size: 4, dir: 1 },
      { x: 760, y: 220, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Pinball',
    time: 100,
    rects: [
      { x: 170, y: 272, w: 60, h: 18 },
      { x: 450, y: 260, w: 60, h: 18 },
      { x: 730, y: 272, w: 60, h: 18 },
      { x: 310, y: 360, w: 50, h: 16 },
      { x: 600, y: 360, w: 50, h: 16 },
    ],
    balls: [
      { x: 90, y: 100, size: 3, dir: 1 },
      { x: 480, y: 80, size: 3, dir: -1 },
      { x: 870, y: 100, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Laser Surgery',
    hint: 'The beam cuts through everything. The spikes do the rest.',
    time: 60,
    weapon: 'beam',
    spikes: true,
    ceiling: { speed: 9, lift: 4 },
    drops: ['shield'],
    start: [480, 400],
    balls: [
      { x: 180, y: 240, size: 4, dir: 1 },
      { x: 780, y: 240, size: 4, dir: -1 },
    ],
  },
  {
    name: 'Rush Hour',
    time: 90,
    weapon: 'twin',
    start: [60, 120],
    balls: [
      { x: 480, y: 130, size: 4, dir: 1 },
      { x: 300, y: 330, size: 1, dir: 1, fast: true },
      { x: 420, y: 300, size: 1, dir: -1, fast: true },
      { x: 560, y: 330, size: 1, dir: 1, fast: true },
      { x: 700, y: 300, size: 1, dir: -1, fast: true },
      { x: 840, y: 330, size: 1, dir: -1, fast: true },
    ],
  },
  {
    name: 'Last Stand',
    hint: 'Everything at once.',
    time: 140,
    ceiling: { speed: 4, lift: 6 },
    ramp: 0.006,
    start: [330, 630],
    drops: ['twin', 'anchor', 'shield', 'slow', 'time', 'life', 'beam'],
    rects: [
      { x: 160, y: 0, w: 16, h: 480, gate: 1 },
      { x: 784, y: 0, w: 16, h: 480, gate: 1 },
    ],
    balls: [
      { x: 480, y: 180, size: 5, dir: 1, group: 1 },
      { x: 60, y: 220, size: 2, dir: 1, fast: true },
      { x: 110, y: 300, size: 2, dir: -1, fast: true },
      { x: 850, y: 220, size: 2, dir: 1, fast: true },
      { x: 900, y: 300, size: 2, dir: -1, fast: true },
    ],
  },
];

// Hard mode: extra mechanics.
//  armor: hits punt the ball upward instead of popping it, until the armour is gone
//  flip:  gravity for balls reverses every N seconds (roof is smooth on these levels)
//  wind:  sideways push on every ball
//  upsideDown: the view is upside down for the whole level
//  spin:  the view turns upside down every N seconds
//  move:  sliding blocks
export const HARD: Level[] = [
  {
    name: 'Tin Cans',
    hint: 'Armoured. Knock them about - or up into the spikes.',
    time: 80,
    balls: [
      { x: 240, y: 200, size: 3, dir: 1, armor: 2 },
      { x: 720, y: 200, size: 3, dir: -1, armor: 2 },
    ],
  },
  {
    name: 'Down Under',
    hint: 'Same game. Just the other way up.',
    time: 80,
    upsideDown: true,
    balls: [
      { x: 240, y: 200, size: 3, dir: 1 },
      { x: 720, y: 220, size: 2, dir: -1 },
    ],
  },
  {
    name: 'Upside Down',
    hint: 'Gravity flips every six seconds.',
    time: 90,
    flip: 6,
    balls: [
      { x: 250, y: 200, size: 3, dir: 1 },
      { x: 700, y: 220, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Headwind',
    hint: 'Slow one way. Very quick the other.',
    time: 90,
    wind: 55,
    start: [480, 400],
    balls: [
      { x: 150, y: 170, size: 4, dir: 1 },
      { x: 620, y: 220, size: 2, dir: -1 },
      { x: 820, y: 200, size: 2, dir: -1 },
    ],
  },
  {
    name: 'Carousel',
    hint: 'Left is left. Mostly.',
    time: 100,
    spin: 8,
    start: [320, 640],
    balls: [
      { x: 160, y: 200, size: 3, dir: 1 },
      { x: 480, y: 180, size: 3, dir: -1 },
      { x: 800, y: 200, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Elevator',
    time: 100,
    spikes: false,
    start: [120, 60],
    rects: [{ x: 330, y: 350, w: 300, h: 18, move: { dx: 0, dy: -180, period: 7 } }],
    balls: [
      { x: 480, y: 200, size: 4, dir: 1 },
      { x: 300, y: 220, size: 2, dir: 1, fast: true },
      { x: 820, y: 220, size: 2, dir: -1, fast: true },
    ],
  },
  {
    name: 'Crusher',
    hint: 'Shoot faster than it falls.',
    time: 90,
    weapon: 'pulse',
    ceiling: { speed: 13, lift: 7 },
    drops: ['shield', 'slow'],
    start: [150, 90],
    balls: [{ x: 560, y: 220, size: 5, dir: -1 }],
  },
  {
    name: 'Cannonballs',
    time: 120,
    weapon: 'anchor',
    start: [60, 120],
    balls: [
      { x: 240, y: 180, size: 4, dir: 1, armor: 2 },
      { x: 740, y: 180, size: 4, dir: -1, armor: 2 },
      { x: 400, y: 330, size: 1, dir: 1, fast: true },
      { x: 480, y: 300, size: 1, dir: -1, fast: true },
      { x: 560, y: 330, size: 1, dir: 1, fast: true },
    ],
  },
  {
    name: 'Weathervane',
    hint: 'Wind and gravity, both against you.',
    time: 110,
    wind: 50,
    flip: 7,
    balls: [
      { x: 300, y: 180, size: 4, dir: 1 },
      { x: 680, y: 200, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Lockdown',
    hint: 'One room at a time. The clock keeps speeding up.',
    time: 130,
    ramp: 0.008,
    start: [90, 40],
    rects: [
      { x: 312, y: 0, w: 16, h: 480, gate: 1 },
      { x: 632, y: 0, w: 16, h: 480, gate: 2 },
    ],
    balls: [
      { x: 220, y: 180, size: 3, dir: 1, group: 1 },
      { x: 480, y: 200, size: 3, dir: 1, group: 2, fast: true },
      { x: 800, y: 170, size: 4, dir: -1 },
    ],
  },
  {
    name: 'Vertigo',
    time: 100,
    spin: 7,
    ceiling: { speed: 6, lift: 9 },
    balls: [
      { x: 250, y: 200, size: 4, dir: 1 },
      { x: 720, y: 220, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Minefield',
    hint: 'The beam knocks. Then it pops. Then it pops again.',
    time: 100,
    weapon: 'beam',
    drops: ['beam', 'pulse', 'shield'],
    dropRate: 0.25,
    start: [480, 330],
    balls: [
      { x: 100, y: 200, size: 2, dir: 1, armor: 1 },
      { x: 250, y: 260, size: 2, dir: -1, armor: 1 },
      { x: 400, y: 200, size: 2, dir: 1, armor: 1 },
      { x: 560, y: 260, size: 2, dir: -1, armor: 1 },
      { x: 710, y: 200, size: 2, dir: 1, armor: 1 },
      { x: 860, y: 260, size: 2, dir: -1, armor: 1 },
    ],
  },
  {
    name: 'Eye of the Storm',
    hint: 'Everything at once.',
    time: 160,
    flip: 9,
    wind: 35,
    ramp: 0.005,
    start: [300, 660],
    drops: ['twin', 'anchor', 'shield', 'slow', 'time', 'life', 'beam'],
    balls: [
      { x: 480, y: 200, size: 5, dir: 1, armor: 1 },
      { x: 120, y: 250, size: 2, dir: 1, fast: true },
      { x: 840, y: 250, size: 2, dir: -1, fast: true },
    ],
  },
];

// Twists: portals, three- and four-way splits, runaway speed and drops you don't want.
//  portals: [ax, ay, bx, by] pairs; a ball entering one comes out of the other
//  split:   pieces per pop (level-wide, or per ball)
//  playerSpeed / 'haste' drops: you run faster than you'd like
export const TWISTS: Level[] = [
  {
    name: 'Wormhole',
    hint: 'What goes in the orange portal comes out the blue one.',
    time: 70,
    start: [480, 400],
    portals: [[150, 330, 810, 150]],
    balls: [{ x: 300, y: 200, size: 3, dir: -1 }],
  },
  {
    name: 'Triplets',
    hint: 'These split three ways. The middle one bounces straight up and down.',
    time: 80,
    split: 3,
    start: [200, 140],
    balls: [{ x: 600, y: 190, size: 3, dir: -1 }],
  },
  {
    name: 'Too Much Coffee',
    hint: 'Lightning drops make you run far too fast. Try not to step on them.',
    time: 80,
    drops: ['haste', 'haste', 'haste', 'time'],
    dropRate: 0.4,
    balls: [
      { x: 220, y: 200, size: 3, dir: 1 },
      { x: 740, y: 200, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Butterfingers',
    hint: 'Every drop is a curse. Don\'t touch them.',
    time: 90,
    weapon: 'twin',
    drops: ['beam', 'pulse', 'haste', 'beam', 'pulse'],
    dropRate: 0.45,
    start: [480, 420],
    balls: [
      { x: 160, y: 230, size: 2, dir: 1 },
      { x: 360, y: 190, size: 3, dir: 1 },
      { x: 600, y: 190, size: 3, dir: -1 },
      { x: 800, y: 230, size: 2, dir: -1 },
    ],
  },
  {
    name: 'Hall of Mirrors',
    time: 100,
    start: [110, 60],
    rects: [{ x: 472, y: 0, w: 16, h: 480, gate: 1 }],
    portals: [[240, 120, 720, 380], [380, 400, 860, 110]],
    balls: [
      { x: 260, y: 260, size: 3, dir: 1, group: 1 },
      { x: 700, y: 200, size: 3, dir: -1 },
    ],
  },
  {
    name: 'Quadruplets',
    hint: 'Four ways now.',
    time: 90,
    split: 4,
    start: [480, 400],
    balls: [
      { x: 200, y: 220, size: 2, dir: 1 },
      { x: 760, y: 220, size: 2, dir: -1 },
    ],
  },
  {
    name: 'Express',
    hint: 'You\'re fast. Too fast.',
    time: 80,
    playerSpeed: 1.7,
    ceiling: { speed: 6, lift: 8 },
    balls: [
      { x: 180, y: 240, size: 2, dir: 1, fast: true },
      { x: 480, y: 180, size: 3, dir: -1 },
      { x: 780, y: 240, size: 2, dir: -1, fast: true },
    ],
  },
  {
    name: 'Do Not Touch',
    hint: 'Three-way splits, and every drop is the wrong gun.',
    time: 110,
    split: 3,
    drops: ['beam', 'pulse'],
    dropRate: 0.35,
    start: [80, 140],
    balls: [
      { x: 480, y: 200, size: 3, dir: 1 },
      { x: 760, y: 260, size: 1, dir: -1, fast: true },
    ],
  },
  {
    name: 'Chaos Theory',
    hint: 'Everything at once.',
    time: 150,
    split: 3,
    ramp: 0.004,
    portals: [[120, 140, 840, 140]],
    drops: ['haste', 'shield', 'twin', 'beam', 'time', 'life'],
    dropRate: 0.25,
    start: [400, 560],
    balls: [
      { x: 300, y: 220, size: 3, dir: 1 },
      { x: 660, y: 220, size: 3, dir: -1, split: 2 },
      { x: 480, y: 330, size: 1, dir: 1, fast: true },
    ],
  },
];

export const SETS = [
  { id: 'campaign', name: 'Campaign', levels: CAMPAIGN },
  { id: 'hard', name: 'Hard mode', levels: HARD },
  { id: 'twists', name: 'Twists', levels: TWISTS },
];
