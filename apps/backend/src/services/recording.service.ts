import { spawn, spawnSync, ChildProcess } from 'child_process';
import dgram from 'dgram';
import { roomManager } from '../socket/room.manager';
import fs from 'fs';
import path from 'path';
import { cloudinary } from '../config/cloudinary';
import { updateRecordingUrl } from './session.service';
import { logger } from '../utils/logger';
import { getIo } from '../socket';

interface RecordingSession {
  process:    ChildProcess;
  outputDir:  string;
  m3u8Path:   string;
}

const activeRecordings = new Map<string, RecordingSession>();

/** Build a minimal SDP string so FFmpeg can ingest raw RTP */
function buildSdp(
  audioPort: number,
  videoPort: number,
  audioPayloadType: number,
  videoPayloadType: number
): string {
  return [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    // Audio
    `m=audio ${audioPort} RTP/AVP ${audioPayloadType}`,
    `a=rtpmap:${audioPayloadType} opus/48000/2`,
    'a=recvonly',
    // Video
    `m=video ${videoPort} RTP/AVP ${videoPayloadType}`,
    `a=rtpmap:${videoPayloadType} VP8/90000`,
    'a=recvonly',
  ].join('\r\n') + '\r\n';
}

/**
 * Start an FFmpeg recording process for a session.
 * audioPort / videoPort: local UDP ports that MediaSoup PlainTransport
 * will forward RTP packets to.
 */
export async function startRecording(
  sessionId: string,
  audioPort: number,
  videoPort: number,
  audioPayloadType = 100,
  videoPayloadType = 101
): Promise<void> {
  // Helper to obtain an available UDP port on localhost
  async function getFreeUdpPort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      sock.once('error', (err) => { try { sock.close(); } catch {} ; reject(err); });
      sock.bind(0, '127.0.0.1', () => {
        // @ts-ignore
        const addr = sock.address();
        const port = typeof addr === 'object' ? (addr.port as number) : Number(addr);
        try { sock.close(); } catch {}
        resolve(port);
      });
    });
  }

  // If caller passed 0, let the OS pick free ports to avoid collisions
  if (!audioPort || audioPort <= 0) {
    audioPort = await getFreeUdpPort();
  }
  if (!videoPort || videoPort <= 0) {
    // allocate a separate port for video to avoid FFmpeg binding the same
    // UDP port twice (which causes "Address already in use")
    videoPort = await getFreeUdpPort();
  }
  const outputDir = path.join(process.cwd(), 'tmp', 'recordings', sessionId);
  fs.mkdirSync(outputDir, { recursive: true });

  const sdpContent = buildSdp(audioPort, videoPort, audioPayloadType, videoPayloadType);
  const sdpPath    = path.join(outputDir, 'input.sdp');
  fs.writeFileSync(sdpPath, sdpContent);

  const m3u8Path = path.join(outputDir, 'index.m3u8');

  const ffmpegArgs = [
    '-protocol_whitelist', 'pipe,file,rtp,udp',
    // Increase probing so FFmpeg can detect codec parameters from live RTP
    '-probesize', '5000000',
    '-analyzeduration', '5000000',
    '-f',   'sdp',
    '-i',   sdpPath,
    // Video codec
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    // Audio codec
    '-c:a', 'aac',
    '-ar',  '48000',
    '-ac',  '2',
    // HLS output
    '-f',             'hls',
    '-hls_time',      '4',
    '-hls_list_size', '0',       // keep all segments
    '-hls_flags',     'delete_segments+append_list',
    '-hls_segment_filename', path.join(outputDir, 'seg_%03d.ts'),
    m3u8Path,
  ];

  // Ensure ffmpeg is available before attempting to spawn it (clear ENOENT symptom)
  try {
    const v = spawnSync('ffmpeg', ['-version']);
    if (v.error || v.status !== 0) {
      logger.error('FFmpeg check failed', { error: String(v.error) });
      throw new Error('FFmpeg not found in PATH or not executable. Install ffmpeg and ensure it is on the system PATH.');
    }
  } catch (err) {
    logger.error('FFmpeg availability check threw', { error: String(err) });
    try { getIo()?.to(sessionId).emit('recording:start:failed', { sessionId, error: String(err) }); } catch {}
    throw err;
  }

  // Keep stdin as a pipe so we can send the 'q' command to gracefully stop
  // FFmpeg and ensure it finalises the HLS playlist before exiting.
  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

  proc.on('error', (err) => {
    logger.error(`Failed to spawn FFmpeg for session ${sessionId}`, { error: String(err) });
    try { getIo()?.to(sessionId).emit('recording:start:failed', { sessionId, error: String(err) }); } catch {}
    activeRecordings.delete(sessionId);
  });

  proc.stderr?.on('data', (data: Buffer) => {
    logger.debug(`[FFmpeg ${sessionId}] ${data.toString().trim()}`);
  });

  proc.on('exit', (code) => {
    logger.info(`FFmpeg exited for session ${sessionId}`, { code });
    activeRecordings.delete(sessionId);
  });

  activeRecordings.set(sessionId, { process: proc, outputDir, m3u8Path });
  logger.info(`Recording started for session ${sessionId}`);

  // Create a mediasoup PlainTransport on the room's router and wire up consumers
  try {
    const room = roomManager.getRoom(sessionId);
    if (!room) throw new Error(`Room ${sessionId} not found when starting recording`);

    const router = room.router;

    // Create a single PlainTransport which will be connected to FFmpeg's listening port
    // Create two PlainTransports: one for audio, one for video. This lets
    // FFmpeg bind separate UDP sockets and avoids the "Address already in use" error
    // when it attempts to open sockets per SDP m= line.
    const audioTransport = await router.createPlainTransport({
      listenIp: { ip: '127.0.0.1' },
      rtcpMux: false,
      comedia: false,
    });
    const videoTransport = await router.createPlainTransport({
      listenIp: { ip: '127.0.0.1' },
      rtcpMux: false,
      comedia: false,
    });

    // Connect transports to their respective UDP ports
    try {
      await audioTransport.connect({ ip: '127.0.0.1', port: audioPort, rtcpPort: audioPort + 1 });
    } catch (err) {
      logger.warn('audioTransport.connect failed', { error: String(err) });
    }
    try {
      await videoTransport.connect({ ip: '127.0.0.1', port: videoPort, rtcpPort: videoPort + 1 });
    } catch (err) {
      logger.warn('videoTransport.connect failed', { error: String(err) });
    }

    // Save transports in RoomManager for later producer events
    roomManager.setRecordingTransport(sessionId, { audio: audioTransport, video: videoTransport } as any);

    // For each existing producer in the room, create a server-side consumer on the
    // appropriate plain transport (audio => audioTransport, video => videoTransport)
    // If a recordingUserId is set on the room, only consume producers belonging to that user.
    const targetUser = room.recordingUserId;
    for (const peer of room.peers.values()) {
      if (targetUser && peer.userId !== targetUser) continue;
      for (const producer of peer.producers.values()) {
        try {
          if (!router.canConsume({ producerId: producer.id, rtpCapabilities: router.rtpCapabilities })) continue;
          const targetTransport = (producer.kind === 'audio') ? audioTransport : videoTransport;
          // @ts-ignore - mediasoup typing allows transport.consume
          const recordingConsumer = await (targetTransport as any).consume({
            producerId: producer.id,
            rtpCapabilities: router.rtpCapabilities,
            paused: false,
          });
          recordingConsumer.on('producerclose', () => {
            try { recordingConsumer.close(); } catch {}
          });
        } catch (err) {
          logger.warn('Failed to create recording consumer', { producerId: producer.id, error: String(err) });
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to create recording transport/consume', { error: String(err) });
  }
}

/** Stop FFmpeg and upload the HLS playlist + segments to Cloudinary */
export async function stopRecording(
  sessionId: string,
  orgId: string
): Promise<string | null> {
  const rec = activeRecordings.get(sessionId);
  if (!rec) {
    logger.warn(`No active recording found for session ${sessionId}`);
    return null;
  }

  // Gracefully stop FFmpeg (send 'q' then SIGTERM). Give FFmpeg longer to
  // finalise the HLS playlist; poll for the playlist file before attempting upload.
  rec.process.stdin?.write('q');
  try { rec.process.stdin?.end(); } catch {}

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try { rec.process.kill('SIGTERM'); } catch {}
      resolve();
    }, 10000); // allow up to 10s for a clean exit

    rec.process.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  // Wait for the HLS playlist to appear and be non-empty (poll briefly)
  const waitForPlaylist = async (pathToCheck: string, timeoutMs = 60000) => {
    const tmpPath = `${pathToCheck}.tmp`;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        // Prefer the final playlist
        if (fs.existsSync(pathToCheck)) {
          const st = fs.statSync(pathToCheck);
          if (st.size && st.size > 0) return true;
        }
        // If a .tmp playlist exists and is non-empty, rename it to the final
        // playlist unconditionally (resolving race conditions where FFmpeg
        // writes a .tmp file then renames it).
        if (fs.existsSync(tmpPath)) {
          const st = fs.statSync(tmpPath);
          if (st.size && st.size > 0) {
            try {
              fs.renameSync(tmpPath, pathToCheck);
              return true;
            } catch (e) {
              logger.debug('Failed to rename tmp playlist to final, will retry', { error: String(e) });
            }
          }
        }
      } catch (e) {
        logger.debug('Error while waiting for playlist', { error: String(e) });
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };

  const playlistReady = await waitForPlaylist(rec.m3u8Path, 60000);
  if (!playlistReady) {
    logger.error(`HLS playlist not found at ${rec.m3u8Path}`);
    try { getIo()?.to(sessionId).emit('recording:upload:failed', { sessionId, error: `HLS playlist not found at ${rec.m3u8Path}` }); } catch {}
    throw new Error(`HLS playlist not found at ${rec.m3u8Path}`);
  }

  activeRecordings.delete(sessionId);

  // Upload HLS playlist to Cloudinary
  try {
    // Ensure the playlist exists and appears non-empty
    if (!fs.existsSync(rec.m3u8Path)) {
      // Log directory contents to help debugging
      try {
        const files = fs.readdirSync(rec.outputDir);
        const details = files.map((f) => {
          try { const s = fs.statSync(path.join(rec.outputDir, f)); return { f, size: s.size }; } catch { return { f, size: null }; }
        });
        logger.debug('Recording directory contents before upload', { outputDir: rec.outputDir, files: details });
      } catch (e) {
        logger.debug('Failed to list recording directory before upload', { error: String(e) });
      }
      const msg = `HLS playlist not found at ${rec.m3u8Path}`;
      logger.error(msg);
      try { getIo()?.to(sessionId).emit('recording:upload:failed', { sessionId, error: msg }); } catch {}
      throw new Error(msg);
    }
    const stat = fs.statSync(rec.m3u8Path);
    if (stat.size === 0) {
      logger.debug('Recording playlist exists but is empty', { path: rec.m3u8Path, size: stat.size });
      const msg = `HLS playlist is empty at ${rec.m3u8Path}`;
      logger.error(msg);
      try { getIo()?.to(sessionId).emit('recording:upload:failed', { sessionId, error: msg }); } catch {}
      throw new Error(msg);
    }

    // Notify clients upload is starting
    try { getIo()?.to(sessionId).emit('recording:upload:started', { sessionId }); } catch {}

    // First attempt: upload the HLS playlist directly (Cloudinary can ingest HLS)
    try {
      const result = await cloudinary.uploader.upload(rec.m3u8Path, {
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
      logger.info(`Recording uploaded for session ${sessionId}`, { url });
      try { getIo()?.to(sessionId).emit('recording:upload:done', { sessionId, url }); } catch {}
      fs.rmSync(rec.outputDir, { recursive: true, force: true });
      return url;
    } catch (uploadErr) {
      // If playlist upload failed (invalid file / auth), attempt MP4 fallback
      let uploadErrMsg = String(uploadErr);
      try { uploadErrMsg = JSON.stringify(uploadErr); } catch {}
      logger.warn('HLS upload failed, attempting MP4 transcode fallback', { error: uploadErrMsg });
      try { getIo()?.to(sessionId).emit('recording:upload:warning', { sessionId, warning: 'HLS upload failed, trying MP4 fallback' }); } catch {}

      // Transcode to MP4 using ffmpeg
      const mp4Path = path.join(rec.outputDir, 'output.mp4');
      try {
        logger.info('Transcoding HLS to MP4 as fallback', { sessionId, mp4Path });
        const ff = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', rec.m3u8Path, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', mp4Path], { timeout: 0 });
        if (ff.error) throw ff.error;
        if (ff.status !== 0) {
          throw new Error(`ffmpeg failed with status ${ff.status}: ${ff.stderr?.toString()}`);
        }
        if (!fs.existsSync(mp4Path) || fs.statSync(mp4Path).size === 0) {
          throw new Error('Transcoded MP4 not found or empty');
        }

        // Upload MP4 to Cloudinary
        const mp4Result = await cloudinary.uploader.upload(mp4Path, {
          resource_type: 'video',
          public_id:     `skillforge/recordings/${orgId}/${sessionId}/index_mp4`,
          overwrite:     true,
        });

        const url = mp4Result.secure_url;
        await updateRecordingUrl(sessionId, url);
        logger.info(`MP4 fallback uploaded for session ${sessionId}`, { url });
        try { getIo()?.to(sessionId).emit('recording:upload:done', { sessionId, url }); } catch {}
        // Clean up temp files
        try { fs.rmSync(rec.outputDir, { recursive: true, force: true }); } catch {}
        return url;
      } catch (fallbackErr) {
        let fallbackMsg = 'Unknown fallback error';
        if (fallbackErr instanceof Error) fallbackMsg = fallbackErr.message;
        else {
          try { fallbackMsg = JSON.stringify(fallbackErr); } catch { fallbackMsg = String(fallbackErr); }
        }
        logger.error(`MP4 fallback failed for session ${sessionId}`, { error: fallbackMsg });
        try { getIo()?.to(sessionId).emit('recording:upload:failed', { sessionId, error: fallbackMsg }); } catch {}
        throw new Error(fallbackMsg);
      }
    }
  } catch (err) {
    // Normalize error detail
    let errMsg = 'Unknown upload error';
    if (err instanceof Error) errMsg = err.message;
    else {
      try { errMsg = JSON.stringify(err); } catch { errMsg = String(err); }
    }
    logger.error(`Cloudinary upload failed for session ${sessionId}`, { error: errMsg });
    try { getIo()?.to(sessionId).emit('recording:upload:failed', { sessionId, error: errMsg }); } catch {}
    // Surface failure to caller so they can decide (do not silently return null when upload failed)
    throw new Error(errMsg);
  }
}

export function isRecording(sessionId: string): boolean {
  return activeRecordings.has(sessionId);
}