// Peer-to-peer link over WebRTC (via PeerJS). The public PeerJS broker is only used to
// introduce the two browsers; game traffic then flows directly between them.
//
// The data channel is unreliable/unordered on purpose (no head-of-line blocking), so every
// message type must tolerate loss: inputs are resent until acknowledged (see rollback.ts)
// and control messages are repeated by the caller.
//
// The broker connection is a websocket that browsers drop freely (backgrounded tab, phone
// switching apps to send the invite, flaky wifi). That must never kill a room: while waiting
// we quietly reconnect under the same room code, and once the two players are linked the
// broker is no longer needed at all.

import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';

const PREFIX = 'splitstorm-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const BROKER_ERRORS = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'];

export interface Link { send(m: unknown): void }
export interface Room { close(): void }
export interface RoomHandlers {
  /** Host only: the room exists and can be joined with this code. */
  onReady?(code: string): void;
  onOpen(link: Link): void;
  onData(m: unknown): void;
  onClose(reason: string): void;
}

function wire(conn: DataConnection, h: RoomHandlers, isCurrent: () => boolean) {
  conn.on('open', () => { if (isCurrent()) h.onOpen({ send: (m) => { if (conn.open) conn.send(m); } }); });
  conn.on('data', (d) => { if (isCurrent()) h.onData(d); });
  conn.on('close', () => { if (isCurrent()) h.onClose('The other player disconnected.'); });
  conn.on('error', (e) => { if (isCurrent()) h.onClose(`Connection error: ${e.message}`); });
}

function describe(e: { type?: string; message?: string }): string {
  if (e.type === 'peer-unavailable') return 'No room with that code. Ask the host for a fresh link.';
  if (e.type === 'browser-incompatible') return 'This browser does not support WebRTC.';
  if (e.type && BROKER_ERRORS.includes(e.type)) return 'Could not reach the matchmaking broker. Check your connection.';
  return e.message ?? 'Connection failed.';
}

/** Open a room. Pass `code` to reopen a room under the code it already had. */
export function hostRoom(h: RoomHandlers, code = ''): Room {
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let closed = false;
  let everReady = code !== '';
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const linked = () => !!conn && conn.open;

  const open = () => {
    if (!code) for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const p = new Peer(PREFIX + code);
    peer = p;
    p.on('open', () => { tries = 0; everReady = true; h.onReady?.(code); });
    p.on('connection', (c) => {
      if (linked()) { c.close(); return; } // room is full
      conn = c;
      wire(c, h, () => !closed && conn === c);
    });
    p.on('disconnected', () => recover({ type: 'disconnected' }));
    p.on('error', (e) => {
      if (closed || p !== peer) return;
      if (e.type === 'unavailable-id' && !everReady) { p.destroy(); code = ''; open(); } // code taken, roll again
      else if (e.type === 'unavailable-id' || BROKER_ERRORS.includes(e.type)) recover(e);
      else if (!linked()) h.onClose(describe(e));
    });
  };

  // Lost the broker: get back on it under the same code. Irrelevant once the players are linked.
  const recover = (e: { type?: string; message?: string }) => {
    if (closed || linked() || timer !== undefined) return;
    if (++tries > 12) { h.onClose(describe(e.type === 'unavailable-id' ? { type: 'network' } : e)); return; }
    timer = setTimeout(() => {
      timer = undefined;
      if (closed || linked()) return;
      if (peer && !peer.destroyed) { if (peer.disconnected) peer.reconnect(); }
      else open();
    }, Math.min(400 * tries, 2500));
  };

  const onVisible = () => {
    if (document.visibilityState !== 'visible' || closed || linked()) return;
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
  };
}

export function joinRoom(code: string, h: RoomHandlers): Room {
  let closed = false;
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const linked = () => !!conn && conn.open;

  const attempt = () => {
    const p = new Peer();
    peer = p;
    p.on('open', () => {
      const c = p.connect(PREFIX + code.toUpperCase(), { reliable: false, serialization: 'json' });
      conn = c;
      wire(c, h, () => !closed && conn === c);
    });
    p.on('error', (e) => {
      if (closed || p !== peer || linked()) return;
      // The host may be momentarily off the broker (e.g. their phone is in the messaging
      // app sending this very link), so keep knocking for a while before giving up.
      const retryable = e.type === 'peer-unavailable' || BROKER_ERRORS.includes(e.type);
      if (!retryable || ++tries > 20) { h.onClose(describe(e)); return; }
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (closed || linked()) return;
        p.destroy();
        attempt();
      }, 1500);
    });
  };
  attempt();
  return { close: () => { closed = true; clearTimeout(timer); peer?.destroy(); } };
}
