import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisPub, redisSub } from '../config/redis';
import { socketAuthMiddleware } from './auth.middleware';
import { registerRoomHandlers } from './handlers/room.handler';
import { registerTransportHandlers } from './handlers/transport.handler';
import { registerProducerHandlers } from './handlers/producer.handler';
import { registerConsumerHandlers } from './handlers/consumer.handler';
import { registerChatHandlers } from './handlers/chat.handler';
import { registerControlHandlers } from './handlers/control.handler';
import { logger } from '../utils/logger';

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    // Allow cross-origin from the Next.js dev server
    cors: {
      origin:      process.env.CLIENT_URL || 'http://localhost:3000',
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    // Prefer WebSocket; fall back to polling for restricted networks
    transports: ['websocket', 'polling'],
    // Heartbeat settings — keep connection alive through idle periods
    pingInterval:      25_000,
    pingTimeout:       20_000,
    // Max message size (for chat messages with potential base64 content)
    maxHttpBufferSize: 1e6, // 1 MB
  });

  // ── Redis adapter for horizontal scaling ─────────────────────────────────
  // With this adapter, io.to(roomId).emit() broadcasts across ALL server
  // instances, not just the one that received the socket connection.
  io.adapter(createAdapter(redisPub, redisSub));

  // ── Auth middleware — runs before every connection ───────────────────────
  io.use(socketAuthMiddleware);

  // ── Per-connection handler registration ──────────────────────────────────
  io.on('connection', (socket) => {
    logger.info('Socket connected', {
      socketId: socket.id,
      userId:   socket.data.userId,
      orgId:    socket.data.orgId,
    });

    // Register all domain handlers
    registerRoomHandlers(io, socket);
    registerTransportHandlers(socket);
    registerProducerHandlers(io, socket);
    registerConsumerHandlers(socket);
    registerChatHandlers(io, socket);
    registerControlHandlers(io, socket);

    socket.on('error', (err) => {
      logger.error('Socket error', {
        socketId: socket.id,
        userId:   socket.data.userId,
        error:    err.message,
      });
    });

    socket.on('disconnect', (reason) => {
      logger.info('Socket disconnected', {
        socketId: socket.id,
        userId:   socket.data.userId,
        reason,
      });
    });
  });

  logger.info('Socket.IO server initialised');
  return io;
}