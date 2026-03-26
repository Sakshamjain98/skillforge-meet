import path from 'path';
import fs from 'fs';
const fsp = fs.promises;
import { consumeQueue, QUEUES } from '../config/rabbitmq';
import { cloudinary } from '../config/cloudinary';
import { updateRecordingUrl } from '../services/session.service';
import { logger } from '../utils/logger';
import { spawn } from 'child_process';
import { getIo } from '../socket';

async function handle(msg: any) {
  const content = JSON.parse(msg.content.toString());
  const { sessionId, orgId, outputDir, m3u8Path } = content;
  logger.info('Recording worker handling job', { sessionId, outputDir });

  try {
    // Basic validation
    try { await fsp.access(m3u8Path); } catch { throw new Error('m3u8 not found'); }
    const stat = await fsp.stat(m3u8Path);
    if (!stat.size) throw new Error('m3u8 empty');

    try { getIo()?.to(sessionId).emit('recording:upload:started', { sessionId }); } catch {}

    // Attempt HLS upload
    try {
      const result = await cloudinary.uploader.upload(m3u8Path, {
        resource_type: 'video',
        public_id:     `skillforge/recordings/${orgId}/${sessionId}/index`,
        overwrite:     true,
        eager: [
          { streaming_profile: 'hd', format: 'm3u8' },
        ],
        eager_async: false,
      });
      const url = result.secure_url;
      await updateRecordingUrl(sessionId, url);
      try { getIo()?.to(sessionId).emit('recording:upload:done', { sessionId, url }); } catch {}
      logger.info('Recording uploaded', { sessionId, url });
      try { await fsp.rm(outputDir, { recursive: true, force: true }); } catch {}
      return;
    } catch (uploadErr) {
      logger.warn('HLS upload failed, attempting MP4 fallback', { sessionId, error: String(uploadErr) });
      try { getIo()?.to(sessionId).emit('recording:upload:warning', { sessionId, warning: 'HLS upload failed, trying MP4 fallback' }); } catch {}
    }

    // Transcode to MP4
    const mp4Path = path.join(outputDir, 'output.mp4');
    await (async function transcodeHlsToMp4(): Promise<void> {
      return new Promise((resolve, reject) => {
        const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', m3u8Path, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', mp4Path]);
        let stderr = '';
        p.on('error', (err) => reject(err));
        p.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        p.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg failed with status ${code}: ${stderr}`));
        });
      });
    })();

    const st = await fsp.stat(mp4Path);
    if (!st || st.size === 0) throw new Error('MP4 missing after transcode');

    const mp4Result = await cloudinary.uploader.upload(mp4Path, {
      resource_type: 'video',
      public_id:     `skillforge/recordings/${orgId}/${sessionId}/index_mp4`,
      overwrite:     true,
    });
    const url = mp4Result.secure_url;
    await updateRecordingUrl(sessionId, url);
    try { getIo()?.to(sessionId).emit('recording:upload:done', { sessionId, url }); } catch {}
    logger.info('MP4 fallback uploaded', { sessionId, url });
    try { await fsp.rm(outputDir, { recursive: true, force: true }); } catch {}
  } catch (err) {
    logger.error('Recording worker failed', { error: String(err), sessionId });
    try { getIo()?.to(sessionId).emit('recording:upload:failed', { sessionId, error: String(err) }); } catch {}
    throw err;
  }
}

// Start consuming when run directly
(async function start() {
  try {
    await consumeQueue(QUEUES.RECORDING, handle, 2);
    logger.info('Recording worker started, consuming queue');
  } catch (err) {
    logger.error('Recording worker failed to start', { error: String(err) });
    process.exit(1);
  }
})();
