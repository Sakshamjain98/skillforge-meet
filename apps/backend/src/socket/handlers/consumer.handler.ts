import { Socket } from 'socket.io';
import { roomManager } from '../room.manager';
import { logger } from '../../utils/logger';
import type {
  ConsumePayload,
  ResumeConsumerPayload,
  SetPreferredLayersPayload,
} from '../../types/socket.types';

export function registerConsumerHandlers(socket: Socket): void {

  // ── consume ───────────────────────────────────────────────────────────────
  socket.on(
    'consume',
    async (
      { producerId, rtpCapabilities }: ConsumePayload,
      callback: (data: any) => void
    ) => {
      try {
        const room = roomManager.getRoom(socket.data.roomId);
        if (!room) return callback({ error: 'Room not found' });

        // Capability check — mediasoup will throw if incompatible
        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          return callback({ error: 'Cannot consume — incompatible RTP capabilities' });
        }

        const recvTransport = roomManager.getTransport(
          socket.id,
          socket.data.roomId,
          'recv'
        );

        const consumer = await recvTransport.consume({
          producerId,
          rtpCapabilities,
          // Start paused: client resumes after transport is connected.
          // This prevents media flowing before the client is ready.
          paused: true,
        });

        roomManager.addConsumer(socket.id, socket.data.roomId, consumer);

        // ── Quality adaptation ──────────────────────────────────────────────
        consumer.on('score', (score) => {
          socket.emit('consumer-score', { consumerId: consumer.id, score });

          // Auto-adjust simulcast spatial layer based on quality score
          if (
            consumer.type === 'simulcast' ||
            consumer.type === 'svc'
          ) {
            if (score.score < 5) {
              consumer.setPreferredLayers({ spatialLayer: 0 }).catch(() => {});
            } else if (score.score > 8) {
              consumer.setPreferredLayers({ spatialLayer: 2 }).catch(() => {});
            }
          }
        });

        // ── Mirror producer state changes to the consumer client ────────────
        consumer.on('producerpause', () => {
          socket.emit('consumer-paused', { consumerId: consumer.id });
        });

        consumer.on('producerresume', () => {
          socket.emit('consumer-resumed', { consumerId: consumer.id });
        });

        consumer.on('producerclose', () => {
          socket.emit('consumer-closed', { consumerId: consumer.id });
          try { consumer.close(); } catch { /* ignore */ }
        });

        consumer.on('transportclose', () => {
          try { consumer.close(); } catch { /* ignore */ }
        });

        logger.debug('Consumer created', {
          socketId:   socket.id,
          consumerId: consumer.id,
          producerId,
          kind:       consumer.kind,
          type:       consumer.type,
        });

        callback({
          id:            consumer.id,
          producerId:    consumer.producerId,
          kind:          consumer.kind,
          rtpParameters: consumer.rtpParameters,
          type:          consumer.type,
          appData:       consumer.appData,
        });
      } catch (err: any) {
        logger.error('consume error', { error: err.message });
        callback({ error: err.message });
      }
    }
  );

  // ── resume-consumer ───────────────────────────────────────────────────────
  // Client calls this immediately after 'consume' succeeds, once it has
  // connected the recv transport and is ready to receive media.
  socket.on(
    'resume-consumer',
    async (
      { consumerId }: ResumeConsumerPayload,
      callback: (data?: any) => void
    ) => {
      try {
        const consumer = roomManager.getConsumer(
          socket.id,
          socket.data.roomId,
          consumerId
        );
        if (!consumer) return callback({ error: 'Consumer not found' });

        await consumer.resume();
        callback({});
      } catch (err: any) {
        logger.error('resume-consumer error', { error: err.message });
        callback({ error: err.message });
      }
    }
  );

  // ── set-preferred-layers ──────────────────────────────────────────────────
  // Allows the client UI (quality selector) to manually control
  // which simulcast / SVC layer is delivered.
  socket.on(
    'set-preferred-layers',
    async (
      { consumerId, spatialLayer, temporalLayer }: SetPreferredLayersPayload,
      callback: (data?: any) => void
    ) => {
      try {
        const consumer = roomManager.getConsumer(
          socket.id,
          socket.data.roomId,
          consumerId
        );
        if (!consumer) return callback({ error: 'Consumer not found' });

        if (consumer.type === 'simulcast' || consumer.type === 'svc') {
          await consumer.setPreferredLayers({ spatialLayer, temporalLayer });
        }

        callback({});
      } catch (err: any) {
        callback({ error: err.message });
      }
    }
  );

  // ── get-consumer-stats ────────────────────────────────────────────────────
  socket.on(
    'get-consumer-stats',
    async (
      { consumerId }: { consumerId: string },
      callback: (data: any) => void
    ) => {
      try {
        const consumer = roomManager.getConsumer(
          socket.id,
          socket.data.roomId,
          consumerId
        );
        if (!consumer) return callback({ error: 'Consumer not found' });
        const stats = await consumer.getStats();
        callback({ stats });
      } catch (err: any) {
        callback({ error: err.message });
      }
    }
  );
}