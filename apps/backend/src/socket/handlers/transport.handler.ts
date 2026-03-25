import { Socket } from 'socket.io';
import { roomManager } from '../room.manager';
import { logger } from '../../utils/logger';
import type {
  CreateTransportPayload,
  ConnectTransportPayload,
  SetPreferredLayersPayload,
} from '../../types/socket.types';

/** WebRTC transport options — same config for both send and recv transports */
function buildTransportOptions() {
  return {
    listenIps: [
      {
        ip:          '0.0.0.0',
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
    minimumAvailableOutgoingBitrate:   600_000,
    maxSctpMessageSize: 262_144,
  };
}

export function registerTransportHandlers(socket: Socket): void {

  // ── create-transport ──────────────────────────────────────────────────────
  socket.on(
    'create-transport',
    async (
      { direction }: CreateTransportPayload,
      callback: (data: any) => void
    ) => {
      try {
        const room = roomManager.getRoom(socket.data.roomId);
        if (!room) return callback({ error: 'Room not found' });

        const transport = await room.router.createWebRtcTransport(
          buildTransportOptions()
        );

        // Auto-close transport when DTLS negotiation fails or client closes
        transport.on('dtlsstatechange', (state) => {
          if (state === 'closed' || state === 'failed') {
            logger.debug('Transport DTLS state changed', {
              transportId: transport.id,
              state,
            });
            if (state === 'closed') transport.close();
          }
        });

        // 'close' is not a valid event for WebRtcTransport, so this handler is removed.

        // Store reference in RoomManager so handlers can look it up
        roomManager.setTransport(socket.id, socket.data.roomId, direction, transport);

        logger.debug('Transport created', {
          socketId:    socket.id,
          direction,
          transportId: transport.id,
        });

        callback({
          id:             transport.id,
          iceParameters:  transport.iceParameters,
          iceCandidates:  transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
        });
      } catch (err: any) {
        logger.error('create-transport error', { error: err.message });
        callback({ error: err.message });
      }
    }
  );

  // ── connect-transport ─────────────────────────────────────────────────────
  socket.on(
    'connect-transport',
    async (
      { transportId, dtlsParameters, direction }: ConnectTransportPayload,
      callback: (data?: any) => void
    ) => {
      try {
        const transport = roomManager.getTransport(
          socket.id,
          socket.data.roomId,
          direction
        );

        if (transport.id !== transportId) {
          return callback({ error: 'Transport ID mismatch' });
        }

        // Type dtlsParameters as required by mediasoup
        const safeDtlsParameters = dtlsParameters as { fingerprints: any[] };
        if (!safeDtlsParameters || !Array.isArray(safeDtlsParameters.fingerprints)) {
          callback({ error: 'Invalid dtlsParameters: missing fingerprints' });
          return;
        }
        await transport.connect({ dtlsParameters: safeDtlsParameters });
        logger.debug('Transport connected', { transportId });
        callback({});
      } catch (err: any) {
        logger.error('connect-transport error', { error: err.message });
        callback({ error: err.message });
      }
    }
  );

  // ── restart-ice (called by client when connection state = failed) ──────────
  socket.on(
    'restart-ice',
    async (
      { transportId, direction }: { transportId: string; direction: 'send' | 'recv' },
      callback: (data?: any) => void
    ) => {
      try {
        const transport = roomManager.getTransport(
          socket.id,
          socket.data.roomId,
          direction
        );
        if (transport.id !== transportId) {
          return callback({ error: 'Transport ID mismatch' });
        }
        const iceParameters = await transport.restartIce();
        callback({ iceParameters });
      } catch (err: any) {
        logger.error('restart-ice error', { error: err.message });
        callback({ error: err.message });
      }
    }
  );

  // ── get-transport-stats ───────────────────────────────────────────────────
  socket.on(
    'get-transport-stats',
    async (
      { direction }: { direction: 'send' | 'recv' },
      callback: (data: any) => void
    ) => {
      try {
        const transport = roomManager.getTransport(
          socket.id,
          socket.data.roomId,
          direction
        );
        const stats = await transport.getStats();
        callback({ stats });
      } catch (err: any) {
        callback({ error: err.message });
      }
    }
  );
}