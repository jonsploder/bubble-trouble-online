// Peer-to-peer rooms over WebRTC (via PeerJS), for up to 4 players. The public PeerJS broker
// is only used to introduce browsers to each other; game traffic then flows directly.
//
// Shape: every guest connects to the host. The host hands out seats (1-3) and tells everyone
// who else is in the room; guests then also connect to each other, so nobody's inputs have
// to detour through the host. A guest-to-guest link that fails to open is not an error: the
// netcode passes inputs along by whatever links exist (see rollback.ts).
//
// Data channels are unreliable/unordered on purpose (no head-of-line blocking), so every
// message type must tolerate loss: inputs are resent until acknowledged and control
// messages are repeated by the caller.
//
// The broker connection is a websocket that browsers drop freely (backgrounded tab, phone
// switching apps to send the invite, flaky wifi). That must never kill a room: we quietly
// reconnect under the same room code.

import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';

const PREFIX = 'splitstorm-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const BROKER_ERRORS = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'];
export const MAX_PLAYERS = 4;

export interface RosterEntry { seat: number; id: string }

export interface Room {
  close(): void;
  /** Send to the player in `seat` over the direct link, if there is one. */
  send(seat: number, m: unknown): void;
  /** Seats we have a direct link to. */
  seats(): number[];
  /** Host: who is in the room (for telling the guests). */
  roster(): RosterEntry[];
  /** Guest: learn our own seat and who else is here; opens links to the other guests. */
  setRoster(me: number, list: RosterEntry[]): void;
  /** Host: refuse newcomers while a game is running. */
  setOpen(open: boolean): void;
}

export interface RoomHandlers {
  /** Host only: the room exists and can be joined with this code. */
  onReady?(code: string): void;
  /** A direct link to the player in `seat` opened or closed. Seat 0 is the host. */
  onLink(seat: number, up: boolean): void;
  onData(seat: number, m: unknown): void;
  /** The room is gone (for a guest: lost the host). */
  onClose(reason: string): void;
}

function describe(e: { type?: string; message?: string }): string {
  if (e.type === 'peer-unavailable') return 'No room with that code. Ask the host for a fresh link.';
  if (e.type === 'browser-incompatible') return 'This browser does not support WebRTC.';
  if (e.type && BROKER_ERRORS.includes(e.type)) return 'Could not reach the matchmaking broker. Check your connection.';
  return e.message ?? 'Connection failed.';
}

const sender = (links: Map<number, DataConnection>) => (seat: number, m: unknown) => {
  const c = links.get(seat);
  if (c && c.open) c.send(m);
};

/** Open a room. Pass `code` to reopen a room under the code it already had. */
export function hostRoom(h: RoomHandlers, code = ''): Room {
  let peer: Peer | null = null;
  let closed = false;
  let accepting = true;
  let everReady = code !== '';
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const links = new Map<number, DataConnection>();

  const accept = (c: DataConnection) => {
    let seat = 0;
    c.on('open', () => {
      if (closed) return;
      for (let s = 1; s < MAX_PLAYERS && !seat; s++) if (!links.has(s)) seat = s;
      if (!seat || !accepting) { c.close(); return; } // full, or a game is running
      links.set(seat, c);
      h.onLink(seat, true);
    });
    c.on('data', (d) => { if (!closed && seat && links.get(seat) === c) h.onData(seat, d); });
    const gone = () => {
      if (closed || !seat || links.get(seat) !== c) return;
      links.delete(seat);
      h.onLink(seat, false);
    };
    c.on('close', gone);
    c.on('error', gone);
  };

  const open = () => {
    if (!code) for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const p = new Peer(PREFIX + code);
    peer = p;
    p.on('open', () => { tries = 0; everReady = true; h.onReady?.(code); });
    p.on('connection', accept);
    p.on('disconnected', () => recover({ type: 'disconnected' }));
    p.on('error', (e) => {
      if (closed || p !== peer) return;
      if (e.type === 'unavailable-id' && !everReady) { p.destroy(); code = ''; open(); } // code taken, roll again
      else if (e.type === 'unavailable-id' || BROKER_ERRORS.includes(e.type)) recover(e);
      else if (!links.size) h.onClose(describe(e));
    });
  };

  // Lost the broker: get back on it under the same code so more friends can still join.
  // With players already linked this is best effort; alone in the room, repeated failure is fatal.
  const recover = (e: { type?: string; message?: string }) => {
    if (closed || timer !== undefined) return;
    if (++tries > 12) {
      if (!links.size) h.onClose(describe(e.type === 'unavailable-id' ? { type: 'network' } : e));
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (closed) return;
      if (peer && !peer.destroyed) { if (peer.disconnected) peer.reconnect(); }
      else open();
    }, Math.min(400 * tries, 2500));
  };

  const onVisible = () => {
    if (document.visibilityState !== 'visible' || closed) return;
    if (!peer || peer.destroyed || peer.disconnected) { tries = 0; recover({ type: 'disconnected' }); }
  };
  document.addEventListener('visibilitychange', onVisible);

  open();
  return {
    close: () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      peer?.destroy();
    },
    send: sender(links),
    seats: () => [...links.keys()],
    roster: () => [...links].map(([seat, c]) => ({ seat, id: c.peer })),
    setRoster: () => {},
    setOpen: (v) => { accepting = v; },
  };
}

export function joinRoom(code: string, h: RoomHandlers): Room {
  let closed = false;
  let peer: Peer | null = null;
  let hostConn: DataConnection | null = null;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let me = 0;
  let roster: RosterEntry[] = [];
  const links = new Map<number, DataConnection>();
  const strangers = new Map<string, DataConnection>(); // guests who reached us before we knew their seat
  const dialled = new Set<string>();
  const hostUp = () => !!hostConn && hostConn.open;

  const wireHost = (c: DataConnection) => {
    const current = () => !closed && hostConn === c;
    c.on('open', () => { if (current()) { links.set(0, c); h.onLink(0, true); } });
    c.on('data', (d) => { if (current()) h.onData(0, d); });
    c.on('close', () => { if (current()) h.onClose('Lost the host. The room may be full, in a game, or closed.'); });
    c.on('error', (e) => { if (current()) h.onClose(`Connection error: ${e.message}`); });
  };

  // A link to another guest. Purely an optimisation, so failures are silent.
  const wireGuest = (c: DataConnection, seat: number) => {
    const up = () => {
      if (closed || links.has(seat)) return;
      links.set(seat, c);
      h.onLink(seat, true);
    };
    if (c.open) up(); else c.on('open', up);
    c.on('data', (d) => { if (!closed && links.get(seat) === c) h.onData(seat, d); });
    const gone = () => {
      dialled.delete(c.peer);
      if (closed || links.get(seat) !== c) return;
      links.delete(seat);
      h.onLink(seat, false);
    };
    c.on('close', gone);
    c.on('error', gone);
  };

  const attempt = () => {
    const p = new Peer();
    peer = p;
    p.on('open', () => {
      if (hostUp()) return;
      hostConn = p.connect(PREFIX + code.toUpperCase(), { reliable: false, serialization: 'json' });
      wireHost(hostConn);
    });
    p.on('connection', (c) => {
      const known = roster.find((r) => r.id === c.peer);
      if (known) wireGuest(c, known.seat); else strangers.set(c.peer, c);
    });
    p.on('disconnected', () => { if (!closed && hostUp() && !p.destroyed) p.reconnect(); });
    p.on('error', (e) => {
      if (closed || p !== peer || hostUp()) return; // once in the room, broker trouble doesn't matter
      // The host may be momentarily off the broker (e.g. their phone is in the messaging
      // app sending this very link), so keep knocking for a while before giving up.
      const retryable = e.type === 'peer-unavailable' || BROKER_ERRORS.includes(e.type);
      if (!retryable || ++tries > 20) { h.onClose(describe(e)); return; }
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (closed || hostUp()) return;
        p.destroy();
        attempt();
      }, 1500);
    });
  };
  attempt();

  return {
    close: () => { closed = true; clearTimeout(timer); peer?.destroy(); },
    send: sender(links),
    seats: () => [...links.keys()],
    roster: () => roster,
    setRoster: (seat, list) => {
      me = seat;
      roster = list;
      const p = peer;
      if (closed || !p || p.destroyed) return;
      for (const r of list) {
        if (r.seat === me || links.has(r.seat)) continue;
        const waiting = strangers.get(r.id);
        if (waiting) { strangers.delete(r.id); wireGuest(waiting, r.seat); continue; }
        // The higher seat dials the lower one, so each pair only connects once.
        if (r.seat < me && !dialled.has(r.id) && !p.disconnected) {
          dialled.add(r.id);
          wireGuest(p.connect(r.id, { reliable: false, serialization: 'json' }), r.seat);
        }
      }
    },
    setOpen: () => {},
  };
}
