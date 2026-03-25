import { Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { logger } from '../utils/logger';

/**
 * Socket.IO middleware that validates the JWT sent in socket.handshake.auth.token
 * and attaches the decoded payload to socket.data.
 *
 * Client must connect with:
 *   io(URL, { auth: { token: '<accessToken>' } })
 */
export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): void {
  const token =
    socket.handshake.auth?.token ??
    (socket.handshake.headers.authorization ?? '').replace('Bearer ', '');

  if (!token) {
    logger.warn('Socket connection rejected — no token', {
      socketId: socket.id,
    });
    return next(new Error('Authentication required'));
  }

  try {
    const payload = verifyAccessToken(token);

    socket.data.userId = payload.userId;
    socket.data.orgId  = payload.orgId;
    socket.data.role   = payload.role;
    socket.data.name   = payload.name;
    socket.data.email  = payload.email;
    // roomId is set later when the client emits join-room
    socket.data.roomId = '';

    next();
  } catch (err) {
    logger.warn('Socket connection rejected — invalid token', {
      socketId: socket.id,
      error:    String(err),
    });
    next(new Error('Invalid or expired token'));
  }
}