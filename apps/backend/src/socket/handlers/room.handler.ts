import { Server, Socket } from 'socket.io';
import { roomManager } from '../room.manager';
import { prisma } from '../../config/database';
import { publish, ROUTING_KEYS } from '../../config/rabbitmq';
import { logger } from '../../utils/logger';
import type {
  JoinRoomPayload,
  JoinRoomResponse,
} from '../../types/socket.types';

export function registerRoomHandlers(io: Server, socket: Socket): void {

  // ── join-room ─────────────────────────────────────────────────────────────
  socket.on(
    'join-room',
    async (
      { roomId }: JoinRoomPayload,
      callback: (data: JoinRoomResponse) => void
    ) => {
      try {
        const { userId, orgId, name, role } = socket.data;

        // 1. Authorise — allow authenticated users to join by session id.
        // Previously we restricted joins to users in the same org (orgId).
        // To permit cross-organization joins, look up the session by id only.
        const session = await prisma.liveSession.findUnique({ where: { id: roomId } });
        if (!session) {
          return callback({ error: 'Session not found' } as any);
        }

        // Log if the joining user is from a different org than the session owner.
        if (session.orgId !== orgId) {
          logger.info('Cross-org join: user from different org joining session', {
            roomId,
            sessionOrgId: session.orgId,
            userOrgId: orgId,
            userId,
          });
        }

        // 2. Get or create mediasoup Room / Router
        const room = await roomManager.getOrCreateRoom(roomId, orgId);

        // 3. Register peer in RoomManager
        roomManager.addPeer(socket.id, { userId, orgId, name, role, roomId });

        // 4. Join Socket.IO room for broadcasting
        await socket.join(roomId);
        socket.data.roomId = roomId;

        // 5. Collect existing producers (to give new peer something to consume)
        const existingProducers = roomManager.getAllProducersInRoom(
          roomId,
          socket.id
        ).map((p) => ({
          ...p,
          kind: (p.kind === 'audio' ? 'audio' : 'video') as 'audio' | 'video',
        }));

        // 6. Collect existing peer metadata (for UI participant list)
        const peers = roomManager
          .getRoomPeers(roomId)
          .filter((p) => p.socketId !== socket.id)
          .map((p) => ({ userId: p.userId, name: p.name, role: p.role }));

        // 7. Notify everyone else that a new peer arrived
        socket.to(roomId).emit('peer-joined', {
          userId,
          name,
          role,
          socketId: socket.id,
        });

        // 8. Flip session to LIVE the first time someone joins
        if (session.status === 'SCHEDULED') {
          await prisma.liveSession.update({
            where: { id: roomId },
            data:  { status: 'LIVE', startedAt: new Date() },
          });
        }

        // 9. Publish attendance event → RabbitMQ → attendance worker
        publish(ROUTING_KEYS.PARTICIPANT_JOINED, {
          sessionId: roomId,
          userId,
          orgId,
          joinedAt: new Date().toISOString(),
        });

        logger.info('Peer joined room', {
          userId,
          roomId,
          totalPeers: room.peers.size,
        });

        callback({
          rtpCapabilities:  room.router.rtpCapabilities,
          existingProducers,
          peers,
        });
      } catch (err: any) {
        logger.error('join-room error', { error: err.message });
        callback({ error: err.message } as any);
      }
    }
  );

  // ── leave-room (explicit) ─────────────────────────────────────────────────
  socket.on('leave-room', async () => {
    await handlePeerLeave(io, socket);
  });

  // ── disconnecting (browser close / network drop) ──────────────────────────
  socket.on('disconnecting', async () => {
    await handlePeerLeave(io, socket);
  });

  // ── get-room-state (snapshot) ─────────────────────────────────────────────
  socket.on('get-room-state', (callback: (data: any) => void) => {
    const state = roomManager.getRoomSnapshot(socket.data.roomId);
    callback(state ?? { error: 'Room not found' });
  });
}

// ── Shared leave logic (used by explicit leave and disconnect) ────────────────
export async function handlePeerLeave(
  io: Server,
  socket: Socket
): Promise<void> {
  const result = await roomManager.removePeer(socket.id);
  if (!result) return;

  const { roomId, userId, orgId } = result;

  // Notify remaining peers
  socket.to(roomId).emit('peer-left', {
    userId,
    socketId: socket.id,
  });

  // Publish leave event → attendance worker records left_at + duration
  publish(ROUTING_KEYS.PARTICIPANT_LEFT, {
    sessionId: roomId,
    userId,
    orgId,
    leftAt: new Date().toISOString(),
  });

  logger.info('Peer left room', { userId, roomId });
}