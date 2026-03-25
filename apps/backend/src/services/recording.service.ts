import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { cloudinary } from '../config/cloudinary';
import { updateRecordingUrl } from './session.service';
import { logger } from '../utils/logger';

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
  const outputDir = path.join(process.cwd(), 'tmp', 'recordings', sessionId);
  fs.mkdirSync(outputDir, { recursive: true });

  const sdpContent = buildSdp(audioPort, videoPort, audioPayloadType, videoPayloadType);
  const sdpPath    = path.join(outputDir, 'input.sdp');
  fs.writeFileSync(sdpPath, sdpContent);

  const m3u8Path = path.join(outputDir, 'index.m3u8');

  const ffmpegArgs = [
    '-protocol_whitelist', 'pipe,file,rtp,udp',
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

  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stderr?.on('data', (data: Buffer) => {
    logger.debug(`[FFmpeg ${sessionId}] ${data.toString().trim()}`);
  });

  proc.on('exit', (code) => {
    logger.info(`FFmpeg exited for session ${sessionId}`, { code });
    activeRecordings.delete(sessionId);
  });

  activeRecordings.set(sessionId, { process: proc, outputDir, m3u8Path });
  logger.info(`Recording started for session ${sessionId}`);
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

  // Gracefully stop FFmpeg (send 'q' then SIGTERM)
  rec.process.stdin?.write('q');
  await new Promise<void>((resolve) => {
    rec.process.on('exit', () => resolve());
    setTimeout(() => {
      rec.process.kill('SIGTERM');
      resolve();
    }, 5000);
  });

  activeRecordings.delete(sessionId);

  // Upload HLS playlist to Cloudinary
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

    // Clean up temp files
    fs.rmSync(rec.outputDir, { recursive: true, force: true });
    return url;
  } catch (err) {
    logger.error(`Cloudinary upload failed for session ${sessionId}`, {
      error: String(err),
    });
    return null;
  }
}

export function isRecording(sessionId: string): boolean {
  return activeRecordings.has(sessionId);
}