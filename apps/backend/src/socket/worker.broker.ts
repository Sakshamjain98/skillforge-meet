import { redis } from '../config/redis';
import { logger } from '../utils/logger';

const ROOM_KEY_PREFIX = 'sf:room:worker:'; // + roomId => workerPid
const WORKER_KEY_PREFIX = 'sf:worker:rooms:'; // + workerPid => set(roomId)
const ROOM_TTL = 60 * 60 * 24; // 24 hours, adjustable

export async function assignRoomToWorker(roomId: string, workerPid: number): Promise<void> {
  const roomKey = ROOM_KEY_PREFIX + roomId;
  const workerKey = WORKER_KEY_PREFIX + workerPid;
  try {
    await redis.set(roomKey, String(workerPid), 'EX', ROOM_TTL);
    await redis.sadd(workerKey, roomId);
    await redis.expire(workerKey, ROOM_TTL);
    logger.debug('Assigned room to worker (broker)', { roomId, workerPid });
  } catch (err) {
    logger.error('Failed to assign room to worker', { roomId, workerPid, error: String(err) });
    throw err;
  }
}

export async function getWorkerForRoom(roomId: string): Promise<number | null> {
  const roomKey = ROOM_KEY_PREFIX + roomId;
  try {
    const v = await redis.get(roomKey);
    if (!v) return null;
    const pid = Number(v);
    return Number.isNaN(pid) ? null : pid;
  } catch (err) {
    logger.error('Failed to get worker for room', { roomId, error: String(err) });
    return null;
  }
}

export async function unassignRoom(roomId: string): Promise<void> {
  const roomKey = ROOM_KEY_PREFIX + roomId;
  try {
    const pidStr = await redis.get(roomKey);
    if (!pidStr) {
      await redis.del(roomKey);
      return;
    }
    const pid = Number(pidStr);
    await redis.del(roomKey);
    const workerKey = WORKER_KEY_PREFIX + pid;
    await redis.srem(workerKey, roomId);
  } catch (err) {
    logger.error('Failed to unassign room', { roomId, error: String(err) });
    throw err;
  }
}

export async function listRoomsForWorker(workerPid: number): Promise<string[]> {
  const workerKey = WORKER_KEY_PREFIX + workerPid;
  try {
    const members = await redis.smembers(workerKey);
    return members || [];
  } catch (err) {
    logger.error('Failed to list rooms for worker', { workerPid, error: String(err) });
    return [];
  }
}

export async function clearWorkerAssignments(workerPid: number): Promise<void> {
  const workerKey = WORKER_KEY_PREFIX + workerPid;
  try {
    const rooms = await redis.smembers(workerKey);
    const pipeline = redis.pipeline();
    for (const r of rooms) pipeline.del(ROOM_KEY_PREFIX + r);
    pipeline.del(workerKey);
    await pipeline.exec();
    logger.info('Cleared worker assignments', { workerPid, count: rooms.length });
  } catch (err) {
    logger.error('Failed to clear worker assignments', { workerPid, error: String(err) });
  }
}

export default {
  assignRoomToWorker,
  getWorkerForRoom,
  unassignRoom,
  listRoomsForWorker,
  clearWorkerAssignments,
};
