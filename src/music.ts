// Music, synthesised in the browser: no audio files. A track is a few bars of data (a chord
// per bar, a melody in scale steps, and one-bar bass / arpeggio / drum patterns);
// `createMusic` plays it on a loop through the Web Audio clock. Two sounds: 'chip' (plain
// square and triangle waves, the first set of tracks) and 'modern' (layered detuned synths
// through filters, a chord pad, punchier drums, echo and reverb). Old tracks are kept.

export interface Track {
  id: string; name: string;
  /** What it's a candidate for. */
  kind: 'level' | 'boss';
  bpm: number;
  /** MIDI note of melody step 0 (the key note). */
  root: number;
  /** Semitones of the 7 scale steps. */
  scale: number[];
  /** The chord for each bar, as the scale step of its root. Loops if shorter than the melody. */
  chords: number[];
  /** One string per bar, 16 slots each: a scale step (7 = an octave up), `-` holds the note, `.` is silence. */
  lead: string[];
  /** One bar, 16 slots: R root, F fifth, O octave, `.` silence. */
  bass: string;
  /** One bar, 16 slots: 0 1 2 = the chord's three notes, 3 = its root an octave up, `.` silence. */
  arp: string;
  /** One bar, 16 slots: k kick, s snare, h hat, o open hat, x kick and snare together, `.` silence. */
  drums: string;
  /** Second drum bar, played every other bar, for a fill. */
  drums2?: string;
  leadWave?: OscillatorType;
  /** Which set of instruments plays it. Default 'chip'. */
  style?: 'chip' | 'modern';
  /** Modern lead sound: 'saw' bright and wide, 'soft' rounder, 'pluck' short and bell-like. */
  tone?: 'saw' | 'soft' | 'pluck';
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11], HARMONIC = [0, 2, 3, 5, 7, 8, 11], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
/** Bars 1-4 again, an octave higher. */
const up = (bars: string[]) => bars.map((b) => b.split(' ').map((t) => (/^\d+$/.test(t) ? String(+t + 7) : t)).join(' '));

const meltdown = [
  '4 - . 2 . 0 . 2 4 - . 7 - - . .',
  '5 - . 2 . 0 . 2 5 - . 7 - - . .',
  '5 - . 3 . 0 . 3 5 - . 7 - 8 - .',
  '6 - . 4 . 1 . 4 6 - 8 - 6 - 4 -',
];

export const TRACKS: Track[] = [
  {
    id: 'liftoff', name: 'Lift Off', kind: 'level', bpm: 140, root: 72, scale: MAJOR, chords: [0, 4, 5, 3],
    lead: [
      '4 . 4 . 2 . 4 . 7 - - . 4 . 2 .',
      '1 . 1 . 4 . 1 . 6 - - . 4 - . .',
      '5 . 5 . 7 . 5 . 9 - - . 7 . 5 .',
      '3 . 5 . 7 . 5 . 3 - 4 - 5 - 6 -',
      '7 - . 4 . 7 . 9 - - . 7 . 4 . .',
      '8 - . 6 . 4 . 8 - - . 6 . 4 . .',
      '9 - . 7 . 5 . 9 - 11 - 9 - 7 - .',
      '7 - 5 - 3 - 5 - 4 - - - . . . .',
    ],
    bass: 'R . R . O . R . R . R . O . F .',
    arp: '0 . 1 . 2 . 1 . 0 . 1 . 2 . 3 .',
    drums: 'k . h . s . h . k . h k s . h .',
  },
  {
    id: 'nightshift', name: 'Night Shift', kind: 'level', bpm: 118, root: 69, scale: MINOR, chords: [0, 5, 2, 6],
    lead: [
      '0 . . 2 . . 4 . 2 . 0 . . . . .',
      '0 . . 2 . . 5 . 4 . 2 . . . . .',
      '2 . . 4 . . 6 . 4 . 2 . . . 1 .',
      '1 . . 3 . . 6 . 4 - 3 - 1 - . .',
      '7 - . 4 . 7 . 9 - . 7 . 4 . 2 .',
      '7 - . 5 . 7 . 9 - . 7 . 5 . 2 .',
      '9 - . 6 . 4 . 9 - . 6 . 4 . 2 .',
      '8 - . 6 . 3 . 8 - 6 - 4 - 3 - 1 -'.split(' ').slice(0, 16).join(' '),
    ],
    bass: 'R . . R . . O . R . . R . F O .',
    arp: '0 1 2 3 2 1 0 1 2 3 2 1 0 1 2 1',
    drums: 'k . . h s . . h k . k h s . h .',
    leadWave: 'triangle',
  },
  {
    id: 'clockwork', name: 'Clockwork', kind: 'level', bpm: 128, root: 74, scale: DORIAN, chords: [0, 3, 0, 6],
    lead: [
      '4 - - - . . 2 - 4 - 7 - - - . .',
      '5 - - - . . 3 - 5 - 7 - - - . .',
      '4 - - - . . 7 - 9 - 8 - 7 - 4 -',
      '6 - - - 3 - 6 - 8 - - - . . . .',
    ],
    bass: 'R . R R . . R . O . R R . . F .',
    arp: '0 2 1 2 3 2 1 2 0 2 1 2 3 2 1 2',
    drums: 'k . h h s . h . k . h h s . h h',
  },
  {
    id: 'sugarrush', name: 'Sugar Rush', kind: 'level', bpm: 158, root: 67, scale: MAJOR, chords: [0, 5, 3, 4],
    lead: [
      '7 . 9 . 11 . 9 11 . 11 . 9 7 . . .',
      '12 . 11 . 9 . 11 12 . 12 . 11 9 . . .',
      '10 . 12 . 14 . 12 14 . 14 . 12 10 . . .',
      '11 . 13 . 15 . 13 15 . 15 - 13 - 11 - .',
      '14 - 16 - 18 - 16 - 14 . 11 . 14 - . .',
      '16 - 14 - 12 - 14 - 16 . 12 . 16 - . .',
      '17 - 16 - 14 - 12 - 14 . 10 . 14 - . .',
      '15 - 13 - 11 - 13 - 15 - 17 - 18 - . .',
    ],
    bass: 'R . O . R . O . R . O . R . O F',
    arp: '0 . 2 . 1 . 2 . 0 . 2 . 1 . 3 .',
    drums: 'k . h . s . h k . k h . s . h .',
  },
  {
    id: 'redalert', name: 'Red Alert', kind: 'boss', bpm: 172, root: 64, scale: MINOR, chords: [0, 0, 5, 6],
    lead: [
      '7 7 . 7 . 7 6 7 . . 4 . 6 . 7 .',
      '7 7 . 7 . 7 6 7 . 9 - 8 - 7 - .',
      '9 9 . 9 . 9 7 9 . . 5 . 7 . 9 .',
      '8 8 . 8 . 8 6 8 . 10 - 8 - 6 - 8',
      '11 - - - 9 - - - 7 - 9 - 11 - 9 -',
      '11 - - - 14 - - - 11 - 9 - 7 - . .',
      '12 - - - 9 - - - 7 - 9 - 12 - 9 -',
      '13 - - - 10 - - - 8 - 10 - 13 - 15 -',
    ],
    bass: 'R R O R R O R R O R R O R O R O',
    arp: '0 2 3 2 1 2 3 2 0 2 3 2 1 2 3 2',
    drums: 'k h s h k k s h k h s h k k s s',
    drums2: 'k h s h k k s h k h s s k s s s',
  },
  {
    id: 'meltdown', name: 'Meltdown', kind: 'boss', bpm: 150, root: 60, scale: MINOR, chords: [0, 5, 3, 4],
    lead: [...up(meltdown), ...up(up(meltdown))],
    bass: 'R . R R O . R R R . R R O . F F',
    arp: '0 3 2 3 1 3 2 3 0 3 2 3 1 3 2 3',
    drums: 'k . h k s . h k k . h k s . s h',
    drums2: 'k . h k s . h k k k h k s s s s',
    leadWave: 'sawtooth',
  },
];

// ---- second iteration: the same notes with the modern sound, and two new melodies ----
const again = (id: string, name: string, more: Partial<Track>): Track => ({ ...TRACKS.find((t) => t.id === id)!, id: id + '2', name, style: 'modern', leadWave: undefined, ...more });
TRACKS.push(
  {
    id: 'skyline', name: 'Skyline', kind: 'level', style: 'modern', tone: 'saw', bpm: 124, root: 72, scale: MAJOR, chords: [5, 3, 0, 4],
    lead: [
      '9 - - 7 - - 5 - 4 - - . 5 - 7 -',
      '9 - - 7 - - 5 - 7 - - - . . . .',
      '9 - - 7 - - 4 - 7 - - . 8 - 9 -',
      '8 - - - 6 - 4 - 8 - - - . . 7 8',
      '9 - 11 - 12 - - 11 - - 9 - 7 - 9 -',
      '12 - - 11 - - 9 - 7 - - - . . 9 11',
      '11 - - 9 - - 7 - 9 - 11 - 14 - - -',
      '13 - - - 11 - 8 - 11 - - - . . . .',
    ],
    bass: 'R . . R . . R . R . . R . . O .',
    arp: '0 . 2 . 3 . 2 . 0 . 2 . 3 . 2 .',
    drums: 'k . h . x . h . k . h . x . h h',
    drums2: 'k . h . x . h . k . h k x . o .',
  },
  {
    id: 'neontide', name: 'Neon Tide', kind: 'level', style: 'modern', tone: 'soft', bpm: 108, root: 74, scale: MINOR, chords: [0, 6, 5, 6],
    lead: [
      '4 - - - - - 2 - 4 - - - 7 - - -',
      '6 - - - - - 3 - 6 - - - 8 - - -',
      '5 - - - - - 2 - 5 - - - 7 - 9 -',
      '8 - - - 6 - - - 3 - - - . . . .',
      '9 - - 7 - - 4 - 9 - - 7 - - 4 -',
      '8 - - 6 - - 3 - 8 - - 6 - - 3 -',
      '9 - - 7 - - 5 - 9 - - 7 - - 5 -',
      '10 - - 8 - - 6 - 10 - 11 - 13 - - -',
    ],
    bass: 'R . R . R . R . R . R . R . R .',
    arp: '0 2 3 2 0 2 3 2 0 2 3 2 0 2 3 2',
    drums: 'k . h . s . h . k . h k s . h .',
    drums2: 'k . h . s . h . k . h k s . o .',
  },
  again('nightshift', 'Night Shift II', { tone: 'pluck', drums: 'k . . h s . . h k . k h s . o .' }),
  again('sugarrush', 'Sugar Rush II', { tone: 'saw', drums: 'k . h . x . h . k . h . x . h h' }),
  again('redalert', 'Red Alert II', { tone: 'saw' }),
  again('meltdown', 'Meltdown II', { tone: 'saw' }),
);

// ---- third batch: more variety, and two slower boss tracks ----
const undertow = [
  '0 - - - - - 2 - 1 - - - 0 - - -',
  '5 - - - - - 7 - 6 - - - 5 - - -',
  '6 - - - - - 8 - 7 - - - 6 - 8 -',
  '7 - - - - - - - 4 - - - 2 - 1 -',
];
TRACKS.push(
  {
    id: 'glass', name: 'Glass Elevator', kind: 'level', style: 'modern', tone: 'pluck', bpm: 116, root: 72, scale: LYDIAN, chords: [0, 1, 0, 1],
    lead: [
      '4 . 7 . 9 . 7 . 4 . 7 . 11 - - .',
      '5 . 8 . 10 . 8 . 5 . 8 . 12 - - .',
      '9 . 7 . 4 . 7 . 9 . 11 . 14 - - .',
      '10 . 8 . 5 . 8 . 12 - 10 - 8 - 5 -',
    ],
    bass: 'R . . . R . . R . . R . . . O .',
    arp: '0 . . 2 . . 3 . 0 . . 2 . . 3 .',
    drums: 'k . h . s . h . k . h . s . h h',
    drums2: 'k . h . s . h . k . h . s . o .',
  },
  {
    id: 'backalley', name: 'Back Alley', kind: 'level', style: 'modern', tone: 'pluck', bpm: 100, root: 76, scale: DORIAN, chords: [0, 0, 3, 0],
    lead: [
      '0 . . 2 . 0 . . 4 . 2 . 0 . . .',
      '0 . . 2 . 4 . . 6 . 4 . 2 . . .',
      '3 . . 5 . 3 . . 7 . 5 . 3 . . .',
      '4 . . 2 . 0 . . 2 - 1 - 0 - . .',
      '7 . 7 . . 6 . 4 . . 6 . 7 - . .',
      '7 . 7 . . 9 . 7 . . 6 . 4 - . .',
      '10 . 10 . . 9 . 7 . . 9 . 10 - . .',
      '7 . 6 . 4 . 2 . 4 - 2 - 0 - . .',
    ],
    bass: 'R . . R . . O . . R . R . F O .',
    arp: '. . 2 . . 3 . . 2 . . . 3 . 2 .',
    drums: 'k . h . s . h k . k h . s . h .',
    drums2: 'k . h . s . h k . k h . s . o h',
  },
  {
    id: 'updraft', name: 'Updraft', kind: 'level', style: 'modern', tone: 'saw', bpm: 148, root: 66, scale: MINOR, chords: [0, 5, 2, 6],
    lead: [
      '7 - - 9 - - 11 - 9 - - 7 - - 4 -',
      '7 - - 9 - - 12 - 9 - - 7 - - 5 -',
      '9 - - 11 - - 13 - 11 - - 9 - - 6 -',
      '8 - - 10 - - 13 - 10 - - 8 - 10 - 11',
      '14 - - - 11 - 9 - 11 - - - 9 - 7 -',
      '14 - - - 12 - 9 - 12 - - - 9 - 7 -',
      '16 - - - 13 - 11 - 13 - - - 11 - 9 -',
      '15 - - - 13 - 10 - 13 - 15 - 17 - - -',
    ],
    bass: 'R . R . R . R . R . R . R . O .',
    arp: '0 2 3 2 1 2 3 2 0 2 3 2 1 2 3 2',
    drums: 'k . h . x . h . k . h . x . h .',
    drums2: 'k . h . x . h . k . h . x . o h',
  },
  {
    // a slower boss: a minor key with a raised seventh, the old "battle theme" tension
    id: 'showdown', name: 'Showdown', kind: 'boss', style: 'modern', tone: 'saw', bpm: 132, root: 69, scale: HARMONIC, chords: [0, 3, 5, 4],
    lead: [
      '4 - 2 - 0 - 2 - 4 - - - 7 - - -',
      '5 - 3 - 0 - 3 - 5 - - - 7 - - -',
      '7 - 5 - 2 - 5 - 7 - - - 9 - - -',
      '8 - 6 - 4 - 6 - 8 - 6 - 4 - 6 -',
      '11 - - 9 - - 7 - 11 - - 9 - - 7 -',
      '12 - - 10 - - 7 - 12 - - 10 - - 7 -',
      '14 - - 12 - - 9 - 14 - - 12 - - 9 -',
      '13 - - - 11 - - - 13 - 11 - 8 - 6 -',
    ],
    bass: 'R . R R . R R . R . R R . R O .',
    arp: '0 2 3 2 1 2 3 2 0 2 3 2 1 2 3 2',
    drums: 'k . h h s . h k k . h h s . h h',
    drums2: 'k . h h s . h k k . h h s s x s',
  },
  {
    // slower still: half-time drums and long low notes
    id: 'undertow', name: 'Undertow', kind: 'boss', style: 'modern', tone: 'saw', bpm: 112, root: 74, scale: MINOR, chords: [0, 5, 6, 0],
    lead: [...undertow, ...up(undertow)],
    bass: 'R . . R . . R . R . . R . . O .',
    arp: '0 . 2 . 3 . 2 . 0 . 2 . 3 . 2 .',
    drums: 'k . h . . . h . s . h . k . h .',
    drums2: 'k . h . . . h . s . h . k k s s',
  },
);

// ---- fourth batch: ten more ----
const curtain = [
  '0 - - 0 2 - - 2 4 - - - 2 - 0 -',
  '4 - - 4 5 - - 5 7 - - - 5 - 4 -',
  '3 - - 3 5 - - 5 7 - - - 10 - - -',
  '4 - - 4 6 - - 6 8 - - 6 4 - 1 -',
];
TRACKS.push(
  {
    id: 'paperplanes', name: 'Paper Planes', kind: 'level', style: 'modern', tone: 'soft', bpm: 104, root: 72, scale: MAJOR, chords: [0, 2, 3, 4],
    lead: [
      '2 - - - 4 - - - 7 - - - 4 - 2 -',
      '1 - - - 4 - - - 6 - - - 4 - 1 -',
      '0 - - - 3 - - - 5 - - - 7 - 5 -',
      '1 - - - 4 - - - 6 - 4 - 8 - - -',
      '9 - 7 - 4 - 7 - 9 - - - 11 - - -',
      '8 - 6 - 4 - 6 - 8 - - - 11 - - -',
      '10 - 7 - 5 - 7 - 10 - - - 12 - - -',
      '11 - 8 - 6 - 8 - 11 - 8 - 6 - 4 -',
    ],
    bass: 'R . . . R . . . R . . . F . . .',
    arp: '0 . 1 . 2 . 3 . 2 . 1 . 0 . 1 .',
    drums: 'k . . h . . h . s . . h . . h .',
  },
  {
    id: 'hopskip', name: 'Hop Skip', kind: 'level', style: 'modern', tone: 'pluck', bpm: 132, root: 67, scale: MAJOR, chords: [0, 3, 0, 4],
    lead: [
      '7 . 9 . 11 . 9 . 7 . . 9 . 7 . .',
      '10 . 12 . 14 . 12 . 10 . . 12 . 10 . .',
      '7 . 9 . 11 . 14 . 11 . . 9 . 7 . .',
      '11 . 13 . 15 . 13 . 11 - 8 - 11 - . .',
    ],
    bass: 'R . O . R . O . R . O . R . O .',
    arp: '. 0 . 2 . 3 . 2 . 0 . 2 . 3 . 2',
    drums: 'k . h . x . h . k k h . x . h .',
    drums2: 'k . h . x . h . k k h . x . o .',
  },
  {
    id: 'lowtide', name: 'Low Tide', kind: 'level', style: 'modern', tone: 'soft', bpm: 92, root: 76, scale: MINOR, chords: [0, 3, 5, 6],
    lead: [
      '4 - - - - - - - 2 - - - 0 - - -',
      '3 - - - - - - - 5 - - - 7 - - -',
      '5 - - - - - - - 7 - - - 9 - - -',
      '6 - - - - - 8 - 10 - - - 8 - 6 -',
      '11 - - 9 - - 7 - 9 - - - . . . .',
      '10 - - 9 - - 7 - 5 - - - . . . .',
      '12 - - 9 - - 7 - 9 - - - . . . .',
      '13 - - 10 - - 8 - 10 - 11 - 13 - - -',
    ],
    bass: 'R . . . . . R . . . R . . . . .',
    arp: '0 . 2 . 3 . 2 . 0 . 2 . 3 . 2 .',
    drums: 'k . . . s . . h . . k . s . . .',
  },
  {
    id: 'circuit', name: 'Circuit Breaker', kind: 'level', style: 'modern', tone: 'saw', bpm: 126, root: 62, scale: MINOR, chords: [0, 0, 5, 6],
    lead: [
      '7 . 7 9 . 7 . 6 7 . 7 9 . 11 . 9',
      '7 . 7 9 . 7 . 6 7 . 4 . 6 . 7 .',
      '9 . 9 12 . 9 . 7 9 . 9 12 . 14 . 12',
      '8 . 8 10 . 8 . 6 8 . 10 . 13 - - .',
    ],
    bass: 'R R . R R . R . R R . R R . O .',
    arp: '. . 3 . . . 3 . . . 3 . . 2 3 .',
    drums: 'k . h . x . h k . k h . x . h h',
  },
  {
    id: 'sunday', name: 'Sunday Driver', kind: 'level', style: 'modern', tone: 'pluck', bpm: 96, root: 65, scale: MAJOR, chords: [0, 5, 1, 4],
    lead: [
      '7 . . 9 . . 11 . 9 . . 7 . . . .',
      '7 . . 9 . . 12 . 9 . . 7 . . . .',
      '8 . . 10 . . 12 . 10 . . 8 . . . .',
      '8 . . 11 . . 13 . 11 - 10 - 8 - . .',
    ],
    bass: 'R . . R . . . . O . . R . . F .',
    arp: '0 . . . 2 . . . 3 . . . 2 . . .',
    drums: 'k . . h s . . h k . . h s . h .',
  },
  {
    id: 'nightbus', name: 'Night Bus', kind: 'level', style: 'modern', tone: 'soft', bpm: 112, root: 67, scale: DORIAN, chords: [0, 3, 0, 6],
    lead: [
      '7 - - - 9 - 11 - - - 9 - 7 - - -',
      '7 - - - 10 - 12 - - - 10 - 7 - - -',
      '11 - - - 9 - 7 - - - 4 - 7 - - -',
      '10 - - - 8 - 6 - - - 8 - 10 - 13 -',
    ],
    bass: 'R . . R . . R . . R . . O . R .',
    arp: '0 2 . 3 . 2 . 0 2 . 3 . 2 . 3 .',
    drums: 'k . h . . . h . s . h . . k h .',
  },
  {
    id: 'confetti', name: 'Confetti', kind: 'level', style: 'modern', tone: 'saw', bpm: 144, root: 62, scale: MAJOR, chords: [3, 4, 2, 5],
    lead: [
      '10 - 12 - 14 - - 12 - - 10 - 12 - 14 -',
      '11 - 13 - 15 - - 13 - - 11 - 13 - 15 -',
      '9 - 11 - 13 - - 11 - - 9 - 11 - 13 -',
      '12 - 14 - 16 - - 14 - - 12 - 9 - 7 -',
    ],
    bass: 'R . R . O . R . R . R . O . R .',
    arp: '0 2 3 2 0 2 3 2 0 2 3 2 0 2 3 2',
    drums: 'k . h . x . h . k . h k x . h h',
  },
  {
    // a grim march
    id: 'curtain', name: 'Iron Curtain', kind: 'boss', style: 'modern', tone: 'saw', bpm: 120, root: 72, scale: HARMONIC, chords: [0, 0, 3, 4],
    lead: [...curtain, ...up(curtain)],
    bass: 'R . . R R . . R R . . R R . O .',
    arp: '0 . 2 . 3 . 2 . 0 . 2 . 3 . 2 .',
    drums: 'k . h k s . h . k . h k s . s s',
  },
  {
    // fast and relentless, stepping down the scale
    id: 'nowayout', name: 'No Way Out', kind: 'boss', style: 'modern', tone: 'saw', bpm: 160, root: 64, scale: MINOR, chords: [0, 6, 5, 4],
    lead: [
      '7 . 7 . 11 . 7 . 9 . 7 . 11 . 9 .',
      '6 . 6 . 10 . 6 . 8 . 6 . 10 . 8 .',
      '5 . 5 . 9 . 5 . 7 . 5 . 9 . 7 .',
      '4 . 4 . 8 . 4 . 6 . 8 . 11 - 13 -',
      '14 - - - 11 - - - 9 - 11 - 14 - - -',
      '13 - - - 10 - - - 8 - 10 - 13 - - -',
      '12 - - - 9 - - - 7 - 9 - 12 - - -',
      '11 - - - 8 - - - 6 - 8 - 11 - 13 -',
    ],
    bass: 'R R R R R R R R R R R R R R O O',
    arp: '0 3 2 3 0 3 2 3 0 3 2 3 0 3 2 3',
    drums: 'k h h h x h h h k h k h x h h h',
  },
  {
    // the slowest: sparse and menacing
    id: 'slowburn', name: 'Slow Burn', kind: 'boss', style: 'modern', tone: 'saw', bpm: 96, root: 64, scale: PHRYGIAN, chords: [0, 1, 0, 6],
    lead: [
      '7 - - - - - - - 8 - - - 7 - - -',
      '8 - - - - - - - 10 - - - 12 - - -',
      '11 - - - - - 9 - 7 - - - 4 - - -',
      '10 - - - 8 - - - 6 - - - 5 - 6 -',
    ],
    bass: 'R . . . . . R . R . . . . . . R',
    arp: '0 . . 2 . . 3 . . 2 . . 0 . . .',
    drums: 'k . . . . . h . s . . . k . h .',
    drums2: 'k . . . . . h . s . . k . k s s',
  },
);

type Slot = { n: number; len: number } | null;
/** A bar of melody as notes with lengths. */
function parseLead(bar: string): Slot[] {
  const t = bar.trim().split(/\s+/), out: Slot[] = new Array(16).fill(null);
  for (let i = 0; i < 16; i++) {
    if (!/^\d+$/.test(t[i] ?? '.')) continue;
    let len = 1;
    while (t[i + len] === '-') len++;
    out[i] = { n: +t[i], len };
  }
  return out;
}
const slots = (bar: string) => { const t = bar.trim().split(/\s+/); return Array.from({ length: 16 }, (_, i) => t[i] ?? '.'); };

export interface Music {
  /** Start a track (by id) from the top, or stop with null. The same track again carries on. */
  play(id: string | null): void;
  readonly playing: string | null;
}

/** A music player that sends its sound to `out`. */
export function createMusic(ac: AudioContext, speaker: AudioNode): Music {
  // everything passes through `out`, which dips to silence while one track hands over to the next
  const out = ac.createGain();
  out.connect(speaker);
  const noise = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
  const nd = noise.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < nd.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; nd[i] = seed / 2147483648 - 1; }

  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  function tone(type: OscillatorType, midi: number, at: number, dur: number, vol: number) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.value = hz(midi);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.005);
    g.gain.setValueAtTime(vol, at + Math.max(0.006, dur - 0.03));
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.01);
  }
  function hit(kind: string, at: number) {
    if (kind === 'k') {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(150, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.11);
      g.gain.setValueAtTime(0.32, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
      o.connect(g).connect(out);
      o.start(at); o.stop(at + 0.14);
      return;
    }
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise;
    f.type = 'highpass';
    f.frequency.value = kind === 's' ? 1400 : 7000;
    const dur = kind === 's' ? 0.12 : 0.035;
    g.gain.setValueAtTime(kind === 's' ? 0.16 : 0.06, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(out);
    src.start(at); src.stop(at + dur + 0.01);
  }

  // ---- modern sound: everything goes through a compressor, with echo and reverb sends ----
  const bus = ac.createDynamicsCompressor();
  bus.threshold.value = -16; bus.ratio.value = 4; bus.attack.value = 0.004; bus.release.value = 0.18;
  const busOut = ac.createGain();
  busOut.gain.value = 0.5;
  bus.connect(busOut).connect(out);
  const echo = ac.createDelay(1.5), echoBack = ac.createGain(), echoTone = ac.createBiquadFilter(), echoIn = ac.createGain();
  echoBack.gain.value = 0.34;
  echoTone.type = 'lowpass'; echoTone.frequency.value = 2600;
  echoIn.connect(echo); echo.connect(echoTone); echoTone.connect(echoBack); echoBack.connect(echo); echoTone.connect(bus);
  const verb = ac.createConvolver(), verbIn = ac.createGain();
  {
    // a made-up room: 1.8 s of noise dying away
    const len = Math.floor(ac.sampleRate * 1.8), imp = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = imp.getChannelData(c);
      for (let i = 0; i < len; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; d[i] = (seed / 2147483648 - 1) * (1 - i / len) ** 2.6; }
    }
    verb.buffer = imp;
  }
  verbIn.connect(verb); verb.connect(bus);
  /** Pad and bass dip on every kick, the pumping feel of modern dance music. */
  const duck = ac.createGain();
  duck.connect(bus);

  /** A few detuned oscillators through a low-pass filter that opens and closes with the note. */
  function synth(o: { type: OscillatorType; midi: number; at: number; dur: number; vol: number; detune: number[]; cut: number; sweep: number; attack?: number; release?: number; decay?: number; to?: AudioNode; echo?: number; verb?: number }) {
    const f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'lowpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(o.cut * o.sweep, o.at);
    f.frequency.exponentialRampToValueAtTime(o.cut, o.at + 0.16);
    const a = o.attack ?? 0.008, r = o.release ?? 0.09, end = o.at + o.dur + r;
    g.gain.setValueAtTime(0.0001, o.at);
    g.gain.linearRampToValueAtTime(o.vol, o.at + a);
    if (o.decay) g.gain.exponentialRampToValueAtTime(0.0001, o.at + a + o.decay);
    else { g.gain.setValueAtTime(o.vol, o.at + Math.max(a, o.dur)); g.gain.linearRampToValueAtTime(0.0001, end); }
    for (const d of o.detune) {
      const osc = ac.createOscillator();
      osc.type = o.type;
      osc.frequency.value = hz(o.midi);
      osc.detune.value = d;
      osc.connect(f);
      osc.start(o.at);
      osc.stop((o.decay ? o.at + a + o.decay : end) + 0.02);
    }
    f.connect(g);
    g.connect(o.to ?? bus);
    if (o.echo) { const e = ac.createGain(); e.gain.value = o.echo; g.connect(e).connect(echoIn); }
    if (o.verb) { const v = ac.createGain(); v.gain.value = o.verb; g.connect(v).connect(verbIn); }
  }
  function mLead(tone: Track['tone'], midi: number, at: number, dur: number, boss: boolean) {
    if (tone === 'pluck') synth({ type: 'sawtooth', midi, at, dur, vol: 0.15, detune: [-6, 6], cut: 900, sweep: 6, decay: Math.max(0.28, dur * 1.2), echo: 0.45, verb: 0.35 });
    else if (tone === 'soft') {
      synth({ type: 'triangle', midi, at, dur, vol: 0.2, detune: [-4, 4], cut: 2600, sweep: 1.5, attack: 0.03, release: 0.2, echo: 0.3, verb: 0.5 });
      synth({ type: 'sawtooth', midi, at, dur, vol: 0.04, detune: [0], cut: 1500, sweep: 2, attack: 0.04, release: 0.2, verb: 0.4 });
    } else synth({ type: 'sawtooth', midi, at, dur, vol: 0.075, detune: [-14, -5, 5, 14], cut: boss ? 3400 : 2400, sweep: 2.4, release: 0.12, echo: 0.3, verb: 0.3 });
  }
  function mDrum(kind: string, at: number, boss: boolean) {
    if (kind === 'x') { mDrum('k', at, boss); mDrum('s', at, boss); return; }
    if (kind === 'k') {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(175, at);
      o.frequency.exponentialRampToValueAtTime(43, at + 0.13);
      g.gain.setValueAtTime(0.85, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
      o.connect(g).connect(bus);
      o.start(at); o.stop(at + 0.26);
      duck.gain.cancelScheduledValues(at);
      duck.gain.setValueAtTime(0.4, at);
      duck.gain.linearRampToValueAtTime(1, at + 0.2);
      return;
    }
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise;
    const snare = kind === 's', open = kind === 'o';
    f.type = snare ? 'bandpass' : 'highpass';
    f.frequency.value = snare ? 1900 : 8500;
    f.Q.value = snare ? 0.7 : 0.5;
    const dur = snare ? 0.17 : open ? 0.16 : 0.04;
    g.gain.setValueAtTime(snare ? 0.5 : open ? 0.11 : 0.1, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(bus);
    if (snare) {
      const v = ac.createGain(); v.gain.value = 0.35; g.connect(v).connect(verbIn);
      const o = ac.createOscillator(), og = ac.createGain(); // the drum's body
      o.type = 'triangle';
      o.frequency.setValueAtTime(210, at); o.frequency.exponentialRampToValueAtTime(150, at + 0.07);
      og.gain.setValueAtTime(0.22, at); og.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
      o.connect(og).connect(bus);
      o.start(at); o.stop(at + 0.1);
    }
    src.start(at); src.stop(at + dur + 0.01);
  }

  let cur: { t: Track; lead: Slot[][]; bass: string[]; arp: string[]; drums: string[][] } | null = null;
  let step = 0, next = 0, timer = 0, swap = 0, want: string | null = null;
  const FADE_OUT = 0.7, FADE_IN = 0.25; // seconds

  function schedule() {
    if (!cur) return;
    const { t } = cur, dur = 60 / t.bpm / 4;
    if (next < ac.currentTime) next = ac.currentTime + 0.03; // the tab was asleep: carry on from now
    while (next < ac.currentTime + 0.15) {
      const bar = Math.floor(step / 16) % cur.lead.length, i = step % 16;
      const chord = t.chords[bar % t.chords.length];
      const note = (deg: number) => t.root + 12 * Math.floor(deg / 7) + t.scale[((deg % 7) + 7) % 7];
      if (t.style === 'modern') {
        const boss = t.kind === 'boss';
        // a held chord under everything, one per bar
        if (i === 0) for (const k of [0, 2, 4]) synth({ type: 'sawtooth', midi: note(chord + k) - 12, at: next, dur: dur * 15.5, vol: 0.028, detune: [-9, 9], cut: boss ? 1300 : 950, sweep: 0.6, attack: 0.12, release: 0.3, to: duck, verb: 0.5 });
        const ml = cur.lead[bar][i];
        if (ml) mLead(t.tone, note(ml.n), next, ml.len * dur * 0.9, boss);
        const mb = cur.bass[i];
        if (mb !== '.') {
          const midi = note(chord + (mb === 'F' ? 4 : mb === 'O' ? 7 : 0)) - 24;
          synth({ type: 'sawtooth', midi, at: next, dur: dur * 0.85, vol: 0.2, detune: [0], cut: boss ? 520 : 380, sweep: 3.5, release: 0.05, to: duck });
          synth({ type: 'sine', midi, at: next, dur: dur * 0.85, vol: 0.26, detune: [0], cut: 4000, sweep: 1, release: 0.05, to: duck });
        }
        const ma = cur.arp[i];
        if (ma !== '.') synth({ type: 'square', midi: note(chord + [0, 2, 4, 7][+ma]), at: next, dur, vol: 0.05, detune: [-5, 5], cut: 700, sweep: 5, decay: 0.2, echo: 0.5, verb: 0.2 });
        const md = cur.drums[Math.floor(step / 16) % cur.drums.length][i];
        if (md !== '.') mDrum(md, next, boss);
        step++;
        next += dur;
        continue;
      }
      const l = cur.lead[bar][i];
      if (l) tone(t.leadWave ?? 'square', note(l.n), next, l.len * dur * 0.92, t.leadWave === 'triangle' ? 0.13 : 0.06);
      const b = cur.bass[i];
      if (b !== '.') tone('triangle', note(chord + (b === 'F' ? 4 : b === 'O' ? 7 : 0)) - 24, next, dur * 0.9, 0.16);
      const a = cur.arp[i];
      if (a !== '.') tone('square', note(chord + [0, 2, 4, 7][+a]), next, dur * 0.7, 0.022);
      const d = cur.drums[Math.floor(step / 16) % cur.drums.length][i];
      if (d !== '.') hit(d, next);
      step++;
      next += dur;
    }
  }

  return {
    get playing() { return want; },
    play(id) {
      if (want === id) return;
      want = id;
      window.clearTimeout(swap);
      const start = () => {
        const t = TRACKS.find((x) => x.id === want);
        window.clearInterval(timer);
        cur = t ? { t, lead: t.lead.map(parseLead), bass: slots(t.bass), arp: slots(t.arp), drums: [t.drums, t.drums2 ?? t.drums].map(slots) } : null;
        const now = ac.currentTime;
        out.gain.cancelScheduledValues(now);
        if (!cur) return;
        out.gain.setValueAtTime(0.0001, now);
        out.gain.linearRampToValueAtTime(1, now + FADE_IN);
        echo.delayTime.value = (60 / cur.t.bpm / 4) * 3; // echoes land a dotted eighth later
        step = 0;
        next = now + 0.06;
        schedule();
        timer = window.setInterval(schedule, 25);
      };
      if (!cur) { start(); return; }
      // fade the old track out, then bring the new one in
      const now = ac.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0.0001, now + FADE_OUT);
      swap = window.setTimeout(start, FADE_OUT * 1000);
    },
  };
}
