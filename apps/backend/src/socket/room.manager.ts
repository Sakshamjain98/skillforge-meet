import type {
  Router,
  Producer,
  Consumer,
  WebRtcTransport,
  PlainTransport,
} from 'mediasoup/node/lib/types';
import {
  getLeastLoadedWorker,
  mediaCodecs,
  incrementWorkerLoad,
  decrementWorkerLoad,
} from '../config/mediasoup';
import { logger } from '../utils/logger';
import type { PeerState, RoomState, ProducerInfo, TransportDirection } from '../types/mediasoup.types';

class RoomManager {
  private rooms = new Map<string, RoomState>();

  // ── Room lifecycle ──────────────────────────────────────────────────────────

  async getOrCreateRoom(roomId: string, orgId: string): Promise<RoomState> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const worker = getLeastLoadedWorker();
    const router = await worker.createRouter({ mediaCodecs });
    incrementWorkerLoad(worker.pid!);

    const room: RoomState = {
      id:          roomId,
      orgId,
      router,
      workerPid:   worker.pid!,
      peers:       new Map(),
      isRecording: false,
      createdAt:   new Date(),
    };

    this.rooms.set(roomId, room);
    logger.info('Room created', { roomId, workerPid: worker.pid });
    return room;
  }

  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  getRoomBySocketId(socketId: string): RoomState | undefined {
    for (const room of this.rooms.values()) {
      if (room.peers.has(socketId)) return room;
    }
    return undefined;
  }

  // ── Peer lifecycle ──────────────────────────────────────────────────────────

  addPeer(
    socketId: string,
    data: Pick<PeerState, 'userId' | 'orgId' | 'name' | 'role' | 'roomId'>
  ): PeerState {
    const room = this.rooms.get(data.roomId);
    if (!room) throw new Error(`Room ${data.roomId} not found`);

    const peer: PeerState = {
      socketId,
      producers:   new Map(),
      consumers:   new Map(),
      isHandRaised: false,
      isMuted:     false,
      isCameraOff: false,
      ...data,
    };

    room.peers.set(socketId, peer);
    logger.debug('Peer added', { socketId, userId: data.userId, roomId: data.roomId });
    return peer;
  }

  getPeer(socketId: string, roomId: string): PeerState | undefined {
    return this.rooms.get(roomId)?.peers.get(socketId);
  }

  getPeerBySocketId(socketId: string): PeerState | undefined {
    for (const room of this.rooms.values()) {
      const peer = room.peers.get(socketId);
      if (peer) return peer;
    }
    return undefined;
  }

  getRoomPeers(roomId: string): PeerState[] {
    return Array.from(this.rooms.get(roomId)?.peers.values() ?? []);
  }

  /**
   * Returns every producer in the room except those owned by excludeSocketId.
   * Used to give a newly joined peer the list of existing streams to consume.
   */
  getAllProducersInRoom(roomId: string, excludeSocketId: string): ProducerInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const result: ProducerInfo[] = [];
    for (const [sid, peer] of room.peers) {
      if (sid === excludeSocketId) continue;
      for (const [producerId, producer] of peer.producers) {
        result.push({
          producerId,
          userId:   peer.userId,
          kind:     producer.kind,
          socketId: sid,
        });
      }
    }
    return result;
  }

  // ── Transport management ────────────────────────────────────────────────────

  setTransport(
    socketId: string,
    roomId: string,
    direction: TransportDirection,
    transport: WebRtcTransport
  ): void {
    const peer = this.getPeer(socketId, roomId);
    if (!peer) throw new Error(`Peer ${socketId} not found in room ${roomId}`);
    if (direction === 'send') peer.sendTransport = transport;
    else                      peer.recvTransport = transport;
  }

  getTransport(
    socketId: string,
    roomId: string,
    direction: TransportDirection
  ): WebRtcTransport {
    const peer = this.getPeer(socketId, roomId);
    if (!peer) throw new Error(`Peer ${socketId} not found`);
    const transport = direction === 'send' ? peer.sendTransport : peer.recvTransport;
    if (!transport) throw new Error(`${direction} transport not initialised for ${socketId}`);
    return transport;
  }

  // ── Producer management ─────────────────────────────────────────────────────

  addProducer(socketId: string, roomId: string, producer: Producer): void {
    const peer = this.getPeer(socketId, roomId);
    if (!peer) throw new Error(`Peer ${socketId} not found`);
    peer.producers.set(producer.id, producer);
  }

  getProducer(
    socketId: string,
    roomId: string,
    producerId: string
  ): Producer | undefined {
    return this.getPeer(socketId, roomId)?.producers.get(producerId);
  }

  // ── Consumer management ─────────────────────────────────────────────────────

  addConsumer(socketId: string, roomId: string, consumer: Consumer): void {
    const peer = this.getPeer(socketId, roomId);
    if (!peer) throw new Error(`Peer ${socketId} not found`);
    peer.consumers.set(consumer.id, consumer);
  }

  getConsumer(
    socketId: string,
    roomId: string,
    consumerId: string
  ): Consumer | undefined {
    return this.getPeer(socketId, roomId)?.consumers.get(consumerId);
  }

  // ── Peer removal (on disconnect or leave) ───────────────────────────────────

  async removePeer(
    socketId: string
  ): Promise<{ roomId: string; userId: string; orgId: string } | null> {
    for (const [roomId, room] of this.rooms) {
      const peer = room.peers.get(socketId);
      if (!peer) continue;

      // Close all mediasoup resources
      for (const producer of peer.producers.values()) {
        try { producer.close(); } catch { /* already closed */ }
      }
      for (const consumer of peer.consumers.values()) {
        try { consumer.close(); } catch { /* already closed */ }
      }
      try { peer.sendTransport?.close(); } catch { /* ignore */ }
      try { peer.recvTransport?.close(); } catch { /* ignore */ }

      room.peers.delete(socketId);

      logger.debug('Peer removed', { socketId, userId: peer.userId, roomId });

      // Tear down empty rooms to free mediasoup resources
      if (room.peers.size === 0) {
        try { room.router.close(); } catch { /* ignore */ }
        decrementWorkerLoad(room.workerPid);
        this.rooms.delete(roomId);
        logger.info('Room closed (empty)', { roomId });
      }

      return { roomId, userId: peer.userId, orgId: peer.orgId };
    }
    return null;
  }

  // ── Room recording state ────────────────────────────────────────────────────

  setRecording(roomId: string, recording: boolean): void {
    const room = this.rooms.get(roomId);
    if (room) room.isRecording = recording;
  }

  setRecordingTransport(
    roomId: string,
    transport: PlainTransport | { audio?: PlainTransport; video?: PlainTransport }
  ): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    // If caller passed an object with audio/video transports, store under recordingTransports
    const maybe = transport as any;
    if (maybe && (maybe.audio || maybe.video)) {
      room.recordingTransports = {
        audio: maybe.audio,
        video: maybe.video,
      };
      // keep backwards compatibility by setting recordingTransport to audio transport when available
      if (maybe.audio) room.recordingTransport = maybe.audio;
    } else {
      room.recordingTransport = transport as PlainTransport;
    }
  }

  setRecordingTarget(roomId: string, userId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.recordingUserId = userId;
  }

  // ── Snapshot for clients ────────────────────────────────────────────────────

  getRoomSnapshot(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      id:          roomId,
      peerCount:   room.peers.size,
      isRecording: room.isRecording,
      peers: Array.from(room.peers.values()).map((p) => ({
        userId:        p.userId,
        name:          p.name,
        role:          p.role,
        isHandRaised:  p.isHandRaised,
        isMuted:       p.isMuted,
        isCameraOff:   p.isCameraOff,
        producerCount: p.producers.size,
      })),
    };
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────────

  getStats() {
    const stats: Record<string, unknown>[] = [];
    for (const [roomId, room] of this.rooms) {
      stats.push({
        roomId,
        orgId:     room.orgId,
        peers:     room.peers.size,
        recording: room.isRecording,
        age:       Date.now() - room.createdAt.getTime(),
      });
    }
    return stats;
  }
}

// Singleton — shared across all socket handlers
export const roomManager = new RoomManager();