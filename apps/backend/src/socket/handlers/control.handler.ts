import { Server, Socket } from 'socket.io';
import { roomManager } from '../room.manager';
import { logger } from '../../utils/logger';
import type {
  RaiseHandPayload,
  ReactionPayload,
  MutePeerPayload,
  KickPeerPayload,
  UpdatePeerStatePayload,
  StartPollPayload,
  PollResponsePayload,
} from '../../types/socket.types';

const MODERATOR_ROLES = new Set(['COACH', 'ORG_ADMIN', 'MANAGER']);
const ALLOWED_REACTIONS = new Set(['👍', '👏', '😂', '❤️', '🎉', '🤔']);

export function registerControlHandlers(io: Server, socket: Socket): void {

  // ── raise-hand ────────────────────────────────────────────────────────────
  socket.on('raise-hand', ({ raised }: RaiseHandPayload) => {
    const peer = roomManager.getPeerBySocketId(socket.id);
    if (!peer) return;

    peer.isHandRaised = raised;

    io.to(socket.data.roomId).emit('hand-raised', {
      userId: socket.data.userId,
      name:   socket.data.name,
      raised,
    });
  });

  // ── send-reaction ─────────────────────────────────────────────────────────
  socket.on('send-reaction', ({ emoji }: ReactionPayload) => {
    if (!ALLOWED_REACTIONS.has(emoji)) return;

    io.to(socket.data.roomId).emit('reaction', {
      userId: socket.data.userId,
      name:   socket.data.name,
      emoji,
    });
  });

  // ── update-peer-state ─────────────────────────────────────────────────────
  // Client sends this whenever it locally mutes/unmutes or turns camera on/off
  // so the rest of the room can update the UI indicator without waiting for
  // the RTP pause/resume cycle.
  socket.on(
    'update-peer-state',
    ({ isMuted, isCameraOff }: UpdatePeerStatePayload) => {
      const peer = roomManager.getPeerBySocketId(socket.id);
      if (!peer) return;

      if (typeof isMuted     === 'boolean') peer.isMuted     = isMuted;
      if (typeof isCameraOff === 'boolean') peer.isCameraOff = isCameraOff;

      io.to(socket.data.roomId).emit('peer-state-changed', {
        userId:      socket.data.userId,
        isMuted:     peer.isMuted,
        isCameraOff: peer.isCameraOff,
      });
    }
  );

  // ── mute-peer (moderator only) ────────────────────────────────────────────
  socket.on('mute-peer', ({ targetUserId }: MutePeerPayload) => {
    if (!MODERATOR_ROLES.has(socket.data.role)) {
      logger.warn('Unauthorised mute-peer attempt', {
        by: socket.data.userId,
        role: socket.data.role,
      });
      return;
    }

    // Signal the target client to mute itself
    io.to(socket.data.roomId).emit('force-mute', { targetUserId });
  });

  // ── kick-peer (coach / admin only) ────────────────────────────────────────
  socket.on('kick-peer', ({ targetUserId }: KickPeerPayload) => {
    if (!['COACH', 'ORG_ADMIN'].includes(socket.data.role)) {
      logger.warn('Unauthorised kick-peer attempt', {
        by:   socket.data.userId,
        role: socket.data.role,
      });
      return;
    }

    io.to(socket.data.roomId).emit('force-kick', { targetUserId });

    logger.info('Peer kicked from room', {
      by:           socket.data.userId,
      targetUserId,
      roomId:       socket.data.roomId,
    });
  });

  // ── start-poll (moderator only) ───────────────────────────────────────────
  socket.on(
    'start-poll',
    ({ question, options }: StartPollPayload) => {
      if (!MODERATOR_ROLES.has(socket.data.role)) return;
      if (!question?.trim() || !Array.isArray(options) || options.length < 2) return;

      const pollId = `poll_${Date.now()}`;

      io.to(socket.data.roomId).emit('poll-started', {
        pollId,
        question: question.trim(),
        options:  options.map((o) => String(o).trim()).filter(Boolean),
        createdBy: socket.data.name,
      });

      logger.info('Poll started', {
        pollId,
        by: socket.data.userId,
        roomId: socket.data.roomId,
      });
    }
  );

  // ── poll-response ─────────────────────────────────────────────────────────
  socket.on('poll-response', ({ pollId, answer }: PollResponsePayload) => {
    if (!pollId || !answer) return;

    // Broadcast to moderators in the room (everyone sees it;
    // the UI on the moderator side aggregates totals client-side)
    socket.to(socket.data.roomId).emit('poll-answer', {
      pollId,
      userId: socket.data.userId,
      answer,
    });
  });
}