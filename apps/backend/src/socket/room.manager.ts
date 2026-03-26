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
  getWorkerByPid,
} from '../config/mediasoup';
import broker from './worker.broker';
import { logger } from '../utils/logger';
import type { PeerState, RoomState, ProducerInfo, TransportDirection } from '../types/mediasoup.types';

export class RoomManager {
  private rooms = new Map<string, RoomState>();

  // Indices for O(1) lookups
  // socketId -> roomId
  private socketToRoom = new Map<string, string>();
  // producerId -> { roomId, socketId, userId, kind }
  private producerIndex = new Map<string, { roomId: string; socketId: string; userId: string; kind: string }>();
  // roomId -> Set of producerIds
  private roomProducers = new Map<string, Set<string>>();

  // ── Room lifecycle ──────────────────────────────────────────────────────────

  async getOrCreateRoom(roomId: string, orgId: string): Promise<RoomState> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    // If a broker already assigned this room to a worker, attempt to use it
    try {
      const assigned = await broker.getWorkerForRoom(roomId);
      if (assigned) {
        // Try to find a matching local worker by pid
        const localWorker = getWorkerByPid(assigned);
        if (localWorker) {
          const router = await localWorker.createRouter({ mediaCodecs });
          incrementWorkerLoad(localWorker.pid!);
          const room: RoomState = {
            id:          roomId,
            orgId,
            router,
            workerPid:   localWorker.pid!,
            peers:       new Map(),
            isRecording: false,
            createdAt:   new Date(),
          };
          this.rooms.set(roomId, room);
          logger.info('Room created using broker-assigned worker', { roomId, workerPid: localWorker.pid });
          return room;
        }
      }
    } catch (e) {
      logger.debug('Broker lookup failed or returned nothing', { roomId, error: String(e) });
    }

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
    // Persist mapping to broker
    try { await broker.assignRoomToWorker(roomId, room.workerPid); } catch (e) { logger.warn('Failed to persist room->worker mapping', { roomId, error: String(e) }); }
    logger.info('Room created', { roomId, workerPid: worker.pid });
    return room;
  }

  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(roomId);
  }

  getRoomBySocketId(socketId: string): RoomState | undefined {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
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
    this.socketToRoom.set(socketId, data.roomId);
    logger.debug('Peer added', { socketId, userId: data.userId, roomId: data.roomId });
    return peer;
  }

  getPeer(socketId: string, roomId: string): PeerState | undefined {
    return this.rooms.get(roomId)?.peers.get(socketId);
  }

  getPeerBySocketId(socketId: string): PeerState | undefined {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId)?.peers.get(socketId);
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
    const set = this.roomProducers.get(roomId);
    if (!set) return [];
    const result: ProducerInfo[] = [];
    for (const producerId of set) {
      const info = this.producerIndex.get(producerId);
      if (!info) continue;
      if (info.socketId === excludeSocketId) continue;
      result.push({ producerId, userId: info.userId, kind: info.kind as any, socketId: info.socketId });
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
    // update producer indices
    this.producerIndex.set(producer.id, { roomId, socketId, userId: peer.userId, kind: producer.kind });
    if (!this.roomProducers.has(roomId)) this.roomProducers.set(roomId, new Set());
    this.roomProducers.get(roomId)!.add(producer.id);
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
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const peer = room.peers.get(socketId);
    if (!peer) return null;

    // Close all mediasoup resources
    for (const producer of peer.producers.values()) {
      try { producer.close(); } catch { /* already closed */ }
    }
    for (const consumer of peer.consumers.values()) {
      try { consumer.close(); } catch { /* already closed */ }
    }
    try { peer.sendTransport?.close(); } catch { /* ignore */ }
    try { peer.recvTransport?.close(); } catch { /* ignore */ }

    // Remove producer indices for this peer
    for (const producer of peer.producers.values()) {
      this.producerIndex.delete(producer.id);
      const s = this.roomProducers.get(roomId);
      if (s) s.delete(producer.id);
    }

    room.peers.delete(socketId);
    this.socketToRoom.delete(socketId);

    logger.debug('Peer removed', { socketId, userId: peer.userId, roomId });

    // Tear down empty rooms to free mediasoup resources
    if (room.peers.size === 0) {
      try { room.router.close(); } catch { /* ignore */ }
      decrementWorkerLoad(room.workerPid);
      this.rooms.delete(roomId);
      // cleanup indices
      this.roomProducers.delete(roomId);
      try { await broker.unassignRoom(roomId); } catch (e) { logger.debug('Failed to unassign room from broker', { roomId, error: String(e) }); }
      logger.info('Room closed (empty)', { roomId });
    }

    return { roomId, userId: peer.userId, orgId: peer.orgId };
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
  // Testing helper: inject a pre-built room (used by unit tests)
  addRoomForTests(room: RoomState): void {
    this.rooms.set(room.id, room);
    // populate roomProducers and socketToRoom
    for (const [sid, peer] of room.peers) {
      this.socketToRoom.set(sid, room.id);
      for (const [pid, producer] of peer.producers) {
        this.producerIndex.set(pid, { roomId: room.id, socketId: sid, userId: peer.userId, kind: producer.kind });
        if (!this.roomProducers.has(room.id)) this.roomProducers.set(room.id, new Set());
        this.roomProducers.get(room.id)!.add(pid);
      }
    }
  }
}

// Singleton — shared across all socket handlers
export const roomManager = new RoomManager();