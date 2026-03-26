'use client';
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { useConferenceStore } from '@/store/conference.store';
import { useAuthStore } from '@/store/auth.store';
import { VideoTile } from './VideoTile';

/** Returns the Tailwind grid-cols class for N participants */
function getGridClass(count: number): string {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  if (count <= 4)  return 'grid-cols-2';
  if (count <= 6)  return 'grid-cols-3';
  if (count <= 9)  return 'grid-cols-3';
  return 'grid-cols-4';
}

export function VideoGrid() {
  const { user }       = useAuthStore();
  const localStream    = useConferenceStore((s) => s.localStream);
  const isMicOn        = useConferenceStore((s) => s.isMicOn);
  const isCameraOn     = useConferenceStore((s) => s.isCameraOn);
  const isHandRaised   = useConferenceStore((s) => s.isHandRaised);
  const isScreenSharing = useConferenceStore((s) => s.isScreenSharing);
  const localVideoLive  = useConferenceStore((s) => s.localVideoLive);
  const peers          = useConferenceStore((s) => Array.from(s.peers.values()));

  const totalCount = peers.length + 1; // +1 for local user

  const gridClass = useMemo(
    () => getGridClass(totalCount),
    [totalCount]
  );

  return (
    <div
      className={clsx(
        'grid gap-2 p-2 h-full w-full overflow-hidden',
        gridClass
      )}
    >
      {/* ── Local tile ────────────────────────────────────────────────── */}
      <VideoTile
        isLocal
        stream={localStream ?? undefined}
        localVideoLive={localVideoLive}
        name={user?.name ?? 'You'}
        isMuted={!isMicOn}
        isCameraOff={!isCameraOn}
        isHandRaised={isHandRaised}
        isScreenShare={isScreenSharing}
        fill={totalCount === 1}
      />

      {/* ── Remote tiles ──────────────────────────────────────────────── */}
      {peers.map((peer) => (
        <VideoTile
          key={peer.userId}
          stream={peer.videoStream}
          audioStream={peer.audioStream}
          videoConsumerId={peer.videoConsumerId}
          audioConsumerId={peer.audioConsumerId}
          name={peer.name}
          isMuted={peer.isMuted}
          isCameraOff={peer.isCameraOff}
          isHandRaised={peer.isHandRaised}
          fill={totalCount === 1}
        />
      ))}
    </div>
  );
}