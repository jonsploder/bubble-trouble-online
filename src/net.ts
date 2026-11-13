// Peer-to-peer link over WebRTC (via PeerJS). The public PeerJS broker is only used to
// introduce the two browsers; game traffic then flows directly between them.
//
// The data channel is unreliable/unordered on purpose (no head-of-line blocking), so every
// message type must tolerate loss: inputs are resent until acknowledged (see rollback.ts)
// and control messages are repeated by the caller.

import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';

const PREFIX = 'splitstorm-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface Link { send(m: unknown): void }
export interface Room { close(): void }
export interface RoomHandlers {
  /** Host only: the room exists and can be joined with this code. */
  onReady?(code: string): void;
  onOpen(link: Link): void;
  onData(m: unknown): void;
  onClose(reason: string): void;
}

function wire(conn: DataConnection, h: RoomHandlers) {
  conn.on('open', () => h.onOpen({ send: (m) => { if (conn.open) conn.send(m); } }));
  conn.on('data', (d) => h.onData(d));
  conn.on('close', () => h.onClose('The other player disconnected.'));
  conn.on('error', (e) => h.onClose(`Connection error: ${e.message}`));
}

function describe(e: { type?: string; message?: string }): string {
  switch (e.type) {
    case 'peer-unavailable': return 'No room with that code.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Could not reach the matchmaking broker.';
    case 'browser-incompatible': return 'This browser does not support WebRTC.';
    default: return e.message ?? 'Connection failed.';
  }
}

export function hostRoom(h: RoomHandlers): Room {
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let closed = false;
  const open = () => {
    let code = '';
    for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const p = new Peer(PREFIX + code);
    peer = p;
    p.on('open', () => h.onReady?.(code));
    p.on('connection', (c) => {
      if (conn && conn.open) { c.close(); return; } // room is full
      conn = c;
      wire(c, h);
    });
    p.on('error', (e) => {
      if (closed) return;
      if (e.type === 'unavailable-id') { p.destroy(); open(); } // code taken, roll again
      else h.onClose(describe(e));
    });
  };
  open();
  return { close: () => { closed = true; peer?.destroy(); } };
}

export function joinRoom(code: string, h: RoomHandlers): Room {
  let closed = false;
  const peer = new Peer();
  peer.on('open', () => {
    wire(peer.connect(PREFIX + code.toUpperCase(), { reliable: false, serialization: 'json' }), h);
  });
  peer.on('error', (e) => { if (!closed) h.onClose(describe(e)); });
  return { close: () => { closed = true; peer.destroy(); } };
}
