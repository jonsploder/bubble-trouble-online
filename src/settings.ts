// Player settings, kept in this browser: sound volume and keyboard controls.
const KEY = 'splitstorm.settings.v1';

export type Action = 'left' | 'right' | 'fire';
export const ACTIONS: Action[] = ['left', 'right', 'fire'];
/** keys[player][action]: the key codes (KeyboardEvent.code) that do it. Player 0 is also used alone in a 1-player game. */
export type Controls = Record<Action, string[]>[];

const defaultKeys = (): Controls => [
  { left: ['ArrowLeft'], right: ['ArrowRight'], fire: ['Space', 'ArrowUp'] },
  { left: ['KeyA'], right: ['KeyD'], fire: ['KeyW', 'ShiftLeft'] },
];

export const settings = { vol: 10, keys: defaultKeys() };
/** Volume steps on the slider. */
export const VOL_MAX = 10;

try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  if (typeof saved.vol === 'number') settings.vol = Math.max(0, Math.min(VOL_MAX, Math.round(saved.vol)));
  if (Array.isArray(saved.keys) && saved.keys.length === 2) {
    const ok = saved.keys.every((p: Record<string, unknown>) => ACTIONS.every((a) => Array.isArray(p?.[a]) && (p[a] as unknown[]).every((k) => typeof k === 'string')));
    if (ok) settings.keys = saved.keys;
  }
} catch { /* private window: defaults */ }

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export function resetKeys() {
  settings.keys = defaultKeys();
  saveSettings();
}

/** Keys that can't be bound: they pause the game. */
export const RESERVED = ['Escape', 'KeyP'];

/** Make `code` the only key for this player's action, taking it off anything else that used it. */
export function bind(player: number, action: Action, code: string) {
  for (const p of settings.keys) for (const a of ACTIONS) p[a] = p[a].filter((k) => k !== code);
  settings.keys[player][action] = [code];
  saveSettings();
}

/** Is this key bound to anything? */
export const isBound = (code: string) => settings.keys.some((p) => ACTIONS.some((a) => p[a].includes(code)));

const NAMES: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter', Backspace: 'Bksp', Tab: 'Tab',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
};
export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const side = code.match(/^(.*)(Left|Right)$/);
  if (side) return `${side[2] === 'Left' ? 'L' : 'R'} ${side[1].replace('Control', 'Ctrl').replace('Meta', 'Cmd')}`;
  return code;
}

/** "← / →  + Space" style summary of one player's keys. */
export function controlsLine(p: number) {
  const k = settings.keys[p], f = (a: Action) => (k[a][0] ? keyName(k[a][0]) : '-');
  return `${f('left')} / ${f('right')} + ${f('fire')}`;
}
