import { Server, Socket } from 'socket.io';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import type { SendMessagePayload } from '../../types/socket.types';

export function registerChatHandlers(io: Server, socket: Socket): void {

  // ── send-message ──────────────────────────────────────────────────────────
  socket.on(
    'send-message',
    async (
      { text }: SendMessagePayload,
      callback: (data?: any) => void
    ) => {
      try {
        const trimmed = (text ?? '').trim();
        if (!trimmed) return callback({ error: 'Message cannot be empty' });
        if (trimmed.length > 2000) return callback({ error: 'Message too long (max 2000 chars)' });

        const message = await prisma.sessionChat.create({
          data: {
            orgId:     socket.data.orgId,
            sessionId: socket.data.roomId,
            userId:    socket.data.userId,
            message:   trimmed,
          },
          select: {
            id:        true,
            message:   true,
            createdAt: true,
            userId:    true,
          },
        });

        const payload = {
          id:        message.id,
          userId:    socket.data.userId,
          name:      socket.data.name,
          text:      message.message,
          timestamp: message.createdAt.toISOString(),
        };

        // Broadcast to everyone in the room INCLUDING the sender
        io.to(socket.data.roomId).emit('new-message', payload);

        callback({ id: message.id });
      } catch (err: any) {
        logger.error('send-message error', { error: err.message });
        callback({ error: err.message });
      }
    }
  );

  // ── get-chat-history ──────────────────────────────────────────────────────
  // Called by the client right after joining so the chat panel is pre-populated.
  socket.on(
    'get-chat-history',
    async (callback: (data: any) => void) => {
      try {
        const messages = await prisma.sessionChat.findMany({
          where:   { sessionId: socket.data.roomId },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
          take:    200,
        });

        callback({
          messages: messages.map((m : any) => ({
            id:        m.id,
            userId:    m.userId,
            name:      m.user.name,
            text:      m.message,
            timestamp: m.createdAt.toISOString(),
          })),
        });
      } catch (err: any) {
        logger.error('get-chat-history error', { error: err.message });
        callback({ error: err.message });
      }
    }
  );
}