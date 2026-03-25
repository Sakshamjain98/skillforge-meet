import { Redis } from 'ioredis';
import { logger } from '../utils/logger';

function createRedisClient(name: string): Redis {
  const client = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  client.on('connect', () => logger.info(`Redis [${name}] connected`));
  client.on('error', (err) =>
    logger.error(`Redis [${name}] error`, { message: err.message })
  );
  client.on('close', () => logger.warn(`Redis [${name}] connection closed`));

  return client;
}

// Main client for general caching
export const redis = createRedisClient('main');

// Dedicated pub/sub clients for Socket.IO adapter
// (Socket.IO adapter requires two separate connections)
export const redisPub = createRedisClient('pub');
export const redisSub = createRedisClient('sub');

export async function connectRedis(): Promise<void> {
  await Promise.all([redis.connect(), redisPub.connect(), redisSub.connect()]);
  logger.info('All Redis clients connected');
}