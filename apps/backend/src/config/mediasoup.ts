import * as mediasoup from 'mediasoup';
import type { Worker, RouterRtpCodecCapability } from 'mediasoup/node/lib/types';
import os from 'os';
import { logger } from '../utils/logger';
import { WorkerEntry } from '../types/mediasoup.types';

// ── Codec list passed to every Router ────────────────────────────────────────
export const mediaCodecs: RouterRtpCodecCapability[] = [
  {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
  },
  {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: { 'x-google-start-bitrate': 1000 },
  },
  {
      kind: 'video',
      mimeType: 'video/VP9',
      clockRate: 90000,
      parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
      }
  },
  {
      kind: 'video',
      mimeType: 'video/h264',
      clockRate: 90000,
      parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
      }
  },
];

// ── Worker pool ───────────────────────────────────────────────────────────────
const workers: WorkerEntry[] = [];

const WORKER_SETTINGS: mediasoup.types.WorkerSettings = {
  rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT || '40000'),
  rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT || '49999'),
  logLevel:   'warn',
  logTags:    ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
};

async function spawnWorker(): Promise<Worker> {
  const worker = await mediasoup.createWorker(WORKER_SETTINGS);

  worker.on('died', (err) => {
    logger.error(`MediaSoup worker ${worker.pid} died`, { error: String(err) });
    const idx = workers.findIndex((w) => w.worker.pid === worker.pid);
    if (idx !== -1) workers.splice(idx, 1);
    // Respawn after 2 seconds
    setTimeout(() => {
      spawnWorker().then((w) => {
        workers.push({ worker: w, load: 0 });
        logger.info(`Replacement MediaSoup worker spawned: PID ${w.pid}`);
      });
    }, 2000);
  });

  return worker;
}

export async function createWorkers(): Promise<void> {
  // Cap at 4 workers in dev; use all cores in production
  const numWorkers =
    process.env.NODE_ENV === 'production'
      ? os.cpus().length
      : Math.min(os.cpus().length, 2);

  for (let i = 0; i < numWorkers; i++) {
    const worker = await spawnWorker();
    workers.push({ worker, load: 0 });
    logger.info(`MediaSoup worker created: PID ${worker.pid}`);
  }
}

export function getLeastLoadedWorker(): Worker {
  if (workers.length === 0) throw new Error('No MediaSoup workers available');
  return [...workers].sort((a, b) => a.load - b.load)[0].worker;
}

export function getWorkerByPid(pid: number): Worker | null {
  const entry = workers.find((w) => w.worker.pid === pid);
  return entry ? entry.worker : null;
}

export function incrementWorkerLoad(pid: number): void {
  const entry = workers.find((w) => w.worker.pid === pid);
  if (entry) entry.load++;
}

export function decrementWorkerLoad(pid: number): void {
  const entry = workers.find((w) => w.worker.pid === pid);
  if (entry) entry.load = Math.max(0, entry.load - 1);
}

export function getWorkerCount(): number {
  return workers.length;
}