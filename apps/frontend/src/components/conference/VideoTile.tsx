'use client';
import { useEffect, useRef, memo, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { MicOff, Hand, MonitorUp } from 'lucide-react';
import { clsx } from 'clsx';

interface VideoTileProps {
  stream?:      MediaStream | null;
  audioStream?: MediaStream | null;
  // Consumer ids for remote media (set by the conference hook)
  videoConsumerId?: string;
  audioConsumerId?: string;
  // Local indicator: whether the local video track is live (not ended)
  localVideoLive?: boolean;
  name:         string;
  isLocal?:     boolean;
  isMuted?:     boolean;
  isCameraOff?: boolean;
  isHandRaised?: boolean;
  isScreenShare?: boolean;
  /** When true the tile fills its container completely */
  fill?:        boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export const VideoTile = memo(function VideoTile({
  stream,
  audioStream,
  videoConsumerId,
  audioConsumerId,
  localVideoLive = true,
  name,
  isLocal      = false,
  isMuted      = false,
  isCameraOff  = false,
  isHandRaised = false,
  isScreenShare = false,
  fill         = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [videoPlayBlocked, setVideoPlayBlocked] = useState(false);
  const [audioPlayBlocked, setAudioPlayBlocked] = useState(false);

  const tryPlayElement = async (el?: HTMLMediaElement | null) => {
    if (!el) return false;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    const rect = el.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0) return false;
    try {
      await el.play();
      return true;
    } catch (err) {
      console.debug('[VideoTile] play() blocked', err);
      return false;
    }
  };

  // Attach video stream
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      try {
        // Avoid re-attaching the same stream (prevents rapid reflows and play aborts)
        const currentId = (el.srcObject as MediaStream | null)?.id;
        if (currentId === stream.id) return;

        console.debug('[VideoTile] attaching video stream', { name, isLocal, id: stream.id });
        el.muted = !!isLocal;
        el.srcObject = stream;

        // Wait for metadata/layout to be ready before attempting play and retry if needed
        const onLoaded = async () => {
          console.debug('[VideoTile] loadedmetadata fired', { name, id: stream.id });
          try {
            const ok = await tryPlayElement(el);
            console.debug('[VideoTile] play after loadedmetadata', { ok, name, id: stream.id });
            setVideoPlayBlocked(!ok);
          } catch (err) {
            console.debug('[VideoTile] play after loadedmetadata failed', err);
            setVideoPlayBlocked(true);
          }
        };

        el.removeEventListener('loadedmetadata', onLoaded);
        el.addEventListener('loadedmetadata', onLoaded, { once: true });

        // Aggressive retry strategy: immediate, 250ms, 750ms, 1500ms
        let cancelled = false;
        const attemptPlay = async (label: string) => {
          if (cancelled) return;
          try {
            const ok = await tryPlayElement(el);
            console.debug('[VideoTile] tryPlay', { label, ok, name, id: stream.id });
            if (ok) {
              setVideoPlayBlocked(false);
              // Log track readiness and element dimensions
              try {
                const vt = stream.getVideoTracks()[0];
                console.debug('[VideoTile] videoTrack state', { id: vt?.id, enabled: vt?.enabled, readyState: vt?.readyState });
              } catch (e) { /* ignore */ }
              console.debug('[VideoTile] element dims', { videoWidth: el.videoWidth, videoHeight: el.videoHeight });

              // If the video element reports zero dimensions, try re-attaching the stream
              if ((el.videoWidth === 0 || el.videoHeight === 0) && stream.getVideoTracks().length > 0) {
                console.debug('[VideoTile] zero-dim video detected, reattaching stream', { name, id: stream.id });
                try {
                  el.srcObject = null;
                  // small delay before reassigning
                  setTimeout(async () => {
                    if (cancelled) return;
                    el.srcObject = stream;
                    const ok2 = await tryPlayElement(el);
                    console.debug('[VideoTile] reattach tryPlay', { ok2, name, id: stream.id, videoWidth: el.videoWidth, videoHeight: el.videoHeight });
                    if (ok2) setVideoPlayBlocked(false);
                  }, 50);
                } catch (e) {
                  console.debug('[VideoTile] reattach failed', e);
                }
              }
            }
          } catch (err) {
            console.debug('[VideoTile] tryPlay error', { label, err, name, id: stream.id });
          }
        };

        void attemptPlay('immediate');
        const t1 = setTimeout(() => void attemptPlay('250ms'), 250);
        const t2 = setTimeout(() => void attemptPlay('750ms'), 750);
        const t3 = setTimeout(() => void attemptPlay('1500ms'), 1500);

        return () => {
          cancelled = true;
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
        };
      } catch (e) {
        console.debug('[VideoTile] attach/play error', e);
      }
    } else {
      console.debug('[VideoTile] clearing video stream', { name, isLocal });
      try { el.pause(); } catch {}
      el.srcObject = null;
      setVideoPlayBlocked(false);
    }
  }, [stream, isLocal]);

  // Attach audio stream (remote only — never play local audio back)
  useEffect(() => {
    const el = audioRef.current;
    if (!el || isLocal) return;
    if (audioStream) {
      console.debug('[VideoTile] attaching audio stream', { name, id: audioStream.id });
      el.srcObject = audioStream;
      void (async () => {
        try {
          await el.play();
          setAudioPlayBlocked(false);
        } catch (err) {
          console.debug('[VideoTile] audio.play() blocked', err);
          setAudioPlayBlocked(true);
        }
      })();
    } else {
      el.srcObject = null;
    }
  }, [audioStream, isLocal]);

  const showVideo = !!stream && !isCameraOff;
  const initials  = getInitials(name);

  return (
    <div
      className={clsx(
        'relative bg-gray-900 rounded-2xl overflow-hidden flex items-center justify-center',
        'border border-gray-800 group',
        fill ? 'w-full h-full' : 'aspect-video w-full'
      )}
    >
      {/* ── Video element ──────────────────────────────────────────────── */}
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={clsx(
            'w-full h-full object-cover',
            // Mirror local camera only (not screen share)
            isLocal && !isScreenShare && 'scale-x-[-1]'
          )}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 select-none">
          <div className="w-16 h-16 rounded-full bg-indigo-700 flex items-center justify-center text-white text-xl font-semibold tracking-wide shadow-lg">
            {initials}
          </div>
          {isCameraOff && (
            <span className="text-gray-500 text-xs">Camera off</span>
          )}
        </div>
      )}

      {/* Hidden audio element for remote participants */}
      {!isLocal && <audio ref={audioRef} autoPlay playsInline className="hidden" />}

      {/* Debug overlay: show stream id + track info when present (dev only) */}
      {/* {stream && (
        <div className="absolute top-2 right-2 bg-black/60 text-xs text-white px-2 py-1 rounded-md select-none pointer-events-none">
          <div>id: {stream.id.slice(0, 8)}</div>
          <div className="text-[10px] opacity-80">tracks: {stream.getTracks().length}</div>
        </div>
      )} */}

      {/* ── Screen-share badge ─────────────────────────────────────────── */}
      {isScreenShare && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-blue-600/90 backdrop-blur-sm text-white text-xs font-medium px-2 py-1 rounded-lg">
          <MonitorUp size={12} />
          Screen
        </div>
      )}

      {/* ── Bottom name bar ────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gradient-to-t from-black/80 to-transparent">
        <span className="text-white text-xs font-medium truncate max-w-[160px] drop-shadow">
          {isLocal ? `${name} (You)` : name}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isMuted && (
            <span className="flex items-center justify-center w-5 h-5 bg-red-500 rounded-full">
              <MicOff size={10} className="text-white" />
            </span>
          )}
          {isLocal && !localVideoLive && (
            <span className="ml-2 text-xs text-yellow-300 bg-black/40 px-2 py-0.5 rounded">Video not live</span>
          )}
        </div>
      </div>

      {/* Play blocked overlay (remote audio) */}
      {audioPlayBlocked && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            className="px-3 py-1 bg-black/60 text-white rounded-md"
                onClick={async () => {
                  // If we have a consumer id, request server to resume the consumer
                  if (audioConsumerId) {
                    const socket = getSocket();
                    socket.emit('resume-consumer', { consumerId: audioConsumerId }, (res: any) => {
                      if (res && res.error) {
                        console.debug('[VideoTile] resume-consumer error', res.error);
                      } else {
                        // attempt local play
                        const a = audioRef.current;
                        if (!a) return;
                        void a.play().then(() => setAudioPlayBlocked(false)).catch((e) => console.debug('[VideoTile] manual audio play failed', e));
                      }
                    });
                    return;
                  }
                  const a = audioRef.current;
                  if (!a) return;
                  try {
                    await a.play();
                    setAudioPlayBlocked(false);
                  } catch (e) {
                    console.debug('[VideoTile] manual audio play failed', e);
                  }
                }}
          >
            Click to enable audio
          </button>
        </div>
      )}

      {/* Play blocked overlay (video) */}
      {videoPlayBlocked && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            className="px-3 py-1 bg-black/60 text-white rounded-md"
            onClick={async () => {
              if (videoConsumerId) {
                const socket = getSocket();
                socket.emit('resume-consumer', { consumerId: videoConsumerId }, (res: any) => {
                  if (res && res.error) console.debug('[VideoTile] resume-consumer error', res.error);
                  else {
                    const v = videoRef.current;
                    if (!v) return;
                    void v.play().then(() => setVideoPlayBlocked(false)).catch((e) => console.debug('[VideoTile] manual video play failed', e));
                  }
                });
                return;
              }
              const v = videoRef.current;
              if (!v) return;
              try {
                await v.play();
                setVideoPlayBlocked(false);
              } catch (e) {
                console.debug('[VideoTile] manual video play failed', e);
              }
            }}
          >
            Click to enable video
          </button>
        </div>
      )}

      {/* ── Hand raised badge ──────────────────────────────────────────── */}
      {isHandRaised && (
        <div className="absolute top-2 right-2 flex items-center justify-center w-7 h-7 bg-yellow-500 rounded-full shadow-lg animate-pulse-dot">
          <Hand size={14} className="text-white" />
        </div>
      )}

      {/* ── Speaking indicator (subtle glow when not muted) ────────────── */}
      {!isMuted && (
        <div className="absolute inset-0 rounded-2xl ring-2 ring-transparent group-[.speaking]:ring-green-500 pointer-events-none" />
      )}
    </div>
  );
});