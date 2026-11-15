import type { GameEvent } from './sim';

let ac: AudioContext | null = null;

export function unlockAudio() {
  try {
    if (!ac) ac = new AudioContext();
    else if (ac.state === 'suspended') void ac.resume();
  } catch { /* no audio available */ }
}

function blip(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.05, slide = 0) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur);
}

export function playEvents(ev: GameEvent[]) {
  let pops = 0;
  for (const e of ev) {
    switch (e.t) {
      case 'pop': if (pops++ < 3) blip(520 - e.size * 70, 0.09, 'triangle', 0.09, -120); break;
      case 'spike': if (pops++ < 3) blip(900, 0.05, 'sawtooth', 0.04, -500); break;
      case 'shoot': blip(e.weapon === 'beam' ? 180 : e.weapon === 'pulse' ? 880 : 330, e.weapon === 'beam' ? 0.2 : 0.06, 'square', 0.03, e.weapon === 'beam' ? 600 : 200); break;
      case 'pickup': blip(660, 0.08, 'sine', 0.08, 400); break;
      case 'shield': blip(300, 0.2, 'sawtooth', 0.06, -200); break;
      case 'die': blip(220, 0.5, 'sawtooth', 0.09, -180); break;
      case 'handoff': blip(392, 0.1, 'triangle', 0.08, 300); setTimeout(() => blip(587, 0.15, 'triangle', 0.08), 100); break;
      case 'send': blip(700, 0.12, 'square', 0.04, -400); break;
      case 'portal': blip(260, 0.18, 'sine', 0.06, 500); break;
      case 'revive': blip(523, 0.1, 'triangle', 0.08, 200); setTimeout(() => blip(880, 0.2, 'triangle', 0.08), 100); break;
      case 'haste': blip(1200, 0.15, 'sawtooth', 0.04, 800); break;
      case 'gate': blip(140, 0.3, 'square', 0.06, 200); break;
      case 'clear': blip(523, 0.12, 'sine', 0.09); setTimeout(() => blip(784, 0.25, 'sine', 0.09), 120); break;
      case 'floor': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, i === 3 ? 0.5 : 0.14, 'triangle', 0.08), 900 + i * 130)); break;
      case 'start': blip(440, 0.08, 'sine', 0.05); break;
    }
  }
}
