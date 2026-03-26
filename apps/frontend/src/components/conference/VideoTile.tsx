'use client';
import { useEffect, useRef, memo } from 'react';
import { MicOff, Hand, MonitorUp } from 'lucide-react';
import { clsx } from 'clsx';

interface VideoTileProps {
  stream?:      MediaStream | null;
  audioStream?: MediaStream | null;
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

  // Attach video stream
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      el.srcObject = stream;
    } else {
      el.srcObject = null;
    }
  }, [stream]);

  // Attach audio stream (remote only — never play local audio back)
  useEffect(() => {
    const el = audioRef.current;
    if (!el || isLocal) return;
    if (audioStream) {
      el.srcObject = audioStream;
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
        </div>
      </div>

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