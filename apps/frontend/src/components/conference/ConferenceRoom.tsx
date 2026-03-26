'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useConference } from '@/hooks/useConference';
import { useConferenceStore } from '@/store/conference.store';
import { useUIStore } from '@/store/ui.store';
import { VideoGrid } from './VideoGrid';
import { ControlBar } from './ControlBar';
import { ChatPanel }          from './ChatPanel';
import { ParticipantPanel } from './ParticipantPanel';
import { DeviceSelector } from './DeviceSelector';
import { WaitingRoom } from './WaitingRoom';
import toast from 'react-hot-toast';

interface ConferenceRoomProps {
  roomId:       string;
  sessionTitle: string;
}

export function ConferenceRoom({ roomId, sessionTitle }: ConferenceRoomProps) {
  const router = useRouter();
  const [isJoining, setIsJoining] = useState(false);
  const [showWaiting, setShowWaiting] = useState(true);

  // Zustand slices
  const isJoined      = useConferenceStore((s) => s.isJoined);
  const isConnected   = useConferenceStore((s) => s.isConnected);
  const error         = useConferenceStore((s) => s.error);
  const isMicOn       = useConferenceStore((s) => s.isMicOn);
  const isCameraOn    = useConferenceStore((s) => s.isCameraOn);
  const isScreenSharing = useConferenceStore((s) => s.isScreenSharing);
  const isHandRaised  = useConferenceStore((s) => s.isHandRaised);

  const showChat         = useUIStore((s) => s.showChat);
  const showParticipants = useUIStore((s) => s.showParticipants);
  const showDevices      = useUIStore((s) => s.showDeviceSelector);
  const chatUnread       = useUIStore((s) => s.chatUnreadCount);
  const uiActions        = useUIStore();

  // Conference actions from the hook
  const {
    joinRoom,
    leaveRoom,
    toggleMic,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    toggleHand,
    sendReaction,
    sendMessage,
    mutePeer,
    kickPeer,
  } = useConference(roomId);

  // ── Join flow ──────────────────────────────────────────────────────────────
  const handleJoin = useCallback(async () => {
    setIsJoining(true);
    try {
      await joinRoom();
      setShowWaiting(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to join — please try again');
    } finally {
      setIsJoining(false);
    }
  }, [joinRoom]);

  // ── Leave flow ─────────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    await leaveRoom();
    router.push('/dashboard');
  }, [leaveRoom, router]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isJoined) return;
    const handler = (e: KeyboardEvent) => {
      // Only when no input is focused
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'd' && !e.metaKey) toggleMic();
      if (e.key === 'e' && !e.metaKey) toggleCamera();
      if (e.key === 'h' && !e.metaKey) toggleHand();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isJoined, toggleMic, toggleCamera, toggleHand]);

  // ── Waiting room ───────────────────────────────────────────────────────────
  if (showWaiting) {
    return (
      <WaitingRoom
        sessionTitle={sessionTitle}
        onJoin={handleJoin}
        isJoining={isJoining}
        error={error}
      />
    );
  }

  // ── Loading / connecting state ─────────────────────────────────────────────
  if (!isJoined) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">
            {!isConnected ? 'Connecting to server…' : 'Setting up media…'}
          </p>
        </div>
      </div>
    );
  }

  // ── Main conference UI ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-gray-950 overflow-hidden">

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-5 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-red-400 text-xs font-semibold uppercase tracking-wider">Live</span>
          </div>
          <span className="text-gray-600 text-xs">·</span>
          <span className="text-white text-sm font-medium truncate max-w-[300px]">
            {sessionTitle}
          </span>
        </div>

        {/* Room ID copy */}
        <button
          onClick={() => {
            navigator.clipboard.writeText(roomId);
            toast.success('Room ID copied!');
          }}
          className="text-gray-500 hover:text-gray-300 font-mono text-xs transition-colors px-2 py-1 rounded hover:bg-gray-800"
          title="Copy room ID"
        >
          {roomId.slice(0, 8).toUpperCase()}
        </button>
      </div>

      {/* ── Main content area ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Video grid — takes all remaining space */}
        <div className="flex-1 overflow-hidden">
          <VideoGrid />
        </div>

        {/* Side panels — chat or participants (only one at a time) */}
        {showChat && (
          <ChatPanel
            onSend={sendMessage}
            onClose={uiActions.closeChat}
          />
        )}

        {showParticipants && (
          <ParticipantPanel
            onClose={uiActions.closeParticipants}
            onMutePeer={mutePeer}
            onKickPeer={kickPeer}
          />
        )}
      </div>

      {/* ── Control bar ───────────────────────────────────────────────── */}
      <ControlBar
        isMicOn={isMicOn}
        isCameraOn={isCameraOn}
        isScreenSharing={isScreenSharing}
        isHandRaised={isHandRaised}
        chatUnreadCount={chatUnread}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onToggleScreen={isScreenSharing ? stopScreenShare : startScreenShare}
        onToggleHand={toggleHand}
        onToggleChat={uiActions.toggleChat}
        onToggleParticipants={uiActions.toggleParticipants}
        onOpenDevices={uiActions.openDeviceSelector}
        onReaction={sendReaction}
        onLeave={handleLeave}
      />

      {/* ── Device selector modal ──────────────────────────────────────── */}
      <DeviceSelector
        open={showDevices}
        onClose={uiActions.closeDeviceSelector}
      />
    </div>
  );
}