import { RoomManager } from '../src/socket/room.manager';

// Minimal mock types to avoid importing mediasoup heavy objects
function makeRoom(roomId: string, orgId = 'org1') {
  return {
    id: roomId,
    orgId,
    router: {} as any,
    workerPid: 1,
    peers: new Map<string, any>(),
    isRecording: false,
    createdAt: new Date(),
  } as any;
}

function makePeer(socketId: string, userId = 'u1', roomId = 'r1') {
  return {
    socketId,
    userId,
    orgId: 'org1',
    name: 'Test',
    role: 'participant',
    roomId,
    producers: new Map(),
    consumers: new Map(),
  } as any;
}

describe('RoomManager', () => {
  let rm: RoomManager;

  beforeEach(() => {
    rm = new RoomManager();
  });

  test('basic room/peer/producer flow', async () => {
    const room = makeRoom('r1');
    const peer = makePeer('s1', 'userA', 'r1');
    room.peers.set('s1', peer);
    (rm as any).addRoomForTests(room);

    // getRoomBySocketId
    const found = rm.getRoomBySocketId('s1');
    expect(found).toBeDefined();
    expect(found && found.id).toBe('r1');

    // addPeer
    const newPeer = rm.addPeer('s2', { userId: 'userB', orgId: 'org1', name: 'B', role: 'participant', roomId: 'r1' });
    expect(newPeer.socketId).toBe('s2');

    // addProducer and getAllProducersInRoom
    rm.addProducer('s1', 'r1', { id: 'p1', kind: 'video' } as any);
    rm.addProducer('s2', 'r1', { id: 'p2', kind: 'audio' } as any);
    const prods = rm.getAllProducersInRoom('r1', 's2');
    expect(Array.isArray(prods)).toBe(true);
    const ids = prods.map((p) => p.producerId);
    expect(ids.includes('p1')).toBe(true);
    expect(ids.includes('p2')).toBe(false);

    // removePeer
    const removed = await rm.removePeer('s1');
    expect(removed).toBeDefined();
    expect(removed && removed.roomId).toBe('r1');
    expect(removed && removed.userId).toBe('userA');
  });
});
