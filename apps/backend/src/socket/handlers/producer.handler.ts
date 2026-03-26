import { Server, Socket } from 'socket.io';
import { roomManager } from '../room.manager';
import { logger } from '../../utils/logger';
import type { ProducePayload } from '../../types/socket.types';

// Minimal local type for RtpParameters to satisfy TS
type RtpParameters = { codecs: any[]; [key: string]: any };

export function registerProducerHandlers(io: Server, socket: Socket): void {

  // ── produce ───────────────────────────────────────────────────────────────
  socket.on(
    'produce',
    async (
      { kind, rtpParameters, appData }: ProducePayload,
      callback: (data: any) => void
    ) => {
      try {
        const sendTransport = roomManager.getTransport(
          socket.id,
          socket.data.roomId,
          'send'
        );

        // Cast rtpParameters and appData to satisfy mediasoup types
        const safeRtpParameters = rtpParameters as RtpParameters;
        const safeAppData = (appData && typeof appData === 'object') ? appData as Record<string, any> : {};

        const producer = await sendTransport.produce({
          kind,
          rtpParameters: safeRtpParameters,
          appData: safeAppData,
        });

        roomManager.addProducer(socket.id, socket.data.roomId, producer);

        // If room is recording, create a server-side consumer to pipe this producer into the recording transport
        try {
          const room = roomManager.getRoom(socket.data.roomId);
          if (room?.isRecording && (room.recordingTransport || room.recordingTransports)) {
            // If a specific recording user is configured, only record their producers
            if (room.recordingUserId && room.recordingUserId !== socket.data.userId) {
              // Not the target user — skip creating a recording consumer
            } else {
              const recordingTransport = (producer.kind === 'audio')
                ? (room.recordingTransports?.audio ?? room.recordingTransport)
                : (room.recordingTransports?.video ?? room.recordingTransport);
              const router = room.router;
              if (router.canConsume({ producerId: producer.id, rtpCapabilities: router.rtpCapabilities })) {
                try {
                  // @ts-ignore - mediasoup typings allow transport.consume
                  const recConsumer = await (recordingTransport as any).consume({
                    producerId: producer.id,
                    rtpCapabilities: router.rtpCapabilities,
                    paused: false,
                  });
                  recConsumer.on('producerclose', () => { try { recConsumer.close(); } catch {} });
                } catch (err) {
                  logger.warn('Failed to create recording consumer for new producer', { producerId: producer.id, error: String(err) });
                }
              }
            }
          }
        } catch (err) {
          logger.warn('Error while attempting to create recording consumer', { error: String(err) });
        }

        // Forward quality score updates to the producing client
        producer.on('score', (score) => {
          socket.emit('producer-score', { producerId: producer.id, score });
        });

        producer.on('videoorientationchange', (orientation) => {
          logger.debug('Video orientation changed', {
            producerId: producer.id,
            orientation,
          });
        });

        // Tell every other peer in the room about the new producer
        // so they can immediately consume it
        socket.to(socket.data.roomId).emit('new-producer', {
          producerId: producer.id,
          socketId:   socket.id,
          userId:     socket.data.userId,
          kind,
          appData,
        });

        logger.info('Producer created', {
          userId:     socket.data.userId,
          kind,
          producerId: producer.id,
          roomId:     socket.data.roomId,
        });

        callback({ id: producer.id });
      } catch (err: any) {
        logger.error('produce error', { error: err.message });
        callback({ error: err.message });
      }
    }
  );

  // ── pause-producer ────────────────────────────────────────────────────────
  socket.on(
    'pause-producer',
    async (
      { producerId }: { producerId: string },
      callback: (data?: any) => void
    ) => {
      try {
        const producer = roomManager.getProducer(
          socket.id,
          socket.data.roomId,
          producerId
        );
        if (!producer) return callback({ error: 'Producer not found' });

        await producer.pause();

        // Notify room — consumers will receive 'consumer-paused' from mediasoup
        socket.to(socket.data.roomId).emit('producer-paused', {
          producerId,
          userId: socket.data.userId,
        });

        callback({});
      } catch (err: any) {
        callback({ error: err.message });
      }
    }
  );

  // ── resume-producer ───────────────────────────────────────────────────────
  socket.on(
    'resume-producer',
    async (
      { producerId }: { producerId: string },
      callback: (data?: any) => void
    ) => {
      try {
        const producer = roomManager.getProducer(
          socket.id,
          socket.data.roomId,
          producerId
        );
        if (!producer) return callback({ error: 'Producer not found' });

        await producer.resume();

        socket.to(socket.data.roomId).emit('producer-resumed', {
          producerId,
          userId: socket.data.userId,
        });

        callback({});
      } catch (err: any) {
        callback({ error: err.message });
      }
    }
  );

  // ── close-producer ────────────────────────────────────────────────────────
  socket.on(
    'close-producer',
    async (
      { producerId }: { producerId: string },
      callback: (data?: any) => void
    ) => {
      try {
        const producer = roomManager.getProducer(
          socket.id,
          socket.data.roomId,
          producerId
        );
        if (!producer) return callback({ error: 'Producer not found' });

        producer.close();

        socket.to(socket.data.roomId).emit('producer-closed', {
          producerId,
          userId: socket.data.userId,
        });

        callback({});
      } catch (err: any) {
        callback({ error: err.message });
      }
    }
  );
}