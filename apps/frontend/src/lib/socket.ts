import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';

let socket: Socket | null = null;

/**
 * Returns the singleton Socket.IO instance.
 * Call connectSocket() to actually open the connection.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect:  false,           // connect manually so we can attach auth first
      transports:   ['websocket'],   // skip polling — faster handshake
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

/** Open the connection, injecting the current access token */
export function connectSocket(accessToken: string): Socket {
  const s = getSocket();
  s.auth = { token: accessToken };
  if (!s.connected) s.connect();
  return s;
}

/** Gracefully disconnect and destroy the singleton */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}