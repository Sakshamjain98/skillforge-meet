'use client';
import { useState, useRef, useEffect } from 'react';
import {
  Mic, MicOff, Video, VideoOff,
  MonitorUp, MonitorOff,
  Hand, MessageSquare, Users, Phone,
  Smile, Settings, MoreVertical,
} from 'lucide-react';
import { clsx } from 'clsx';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ControlBarProps {
  isMicOn:         boolean;
  isCameraOn:      boolean;
  isScreenSharing: boolean;
  isHandRaised:    boolean;
  chatUnreadCount: number;
  onToggleMic:     () => void;
  onToggleCamera:  () => void;
  onToggleScreen:  () => void;
  onToggleHand:    () => void;
  onToggleChat:    () => void;
  onToggleParticipants: () => void;
  onOpenDevices:   () => void;
  onReaction:      (emoji: string) => void;
  onLeave:         () => void;
}

// ── Reaction emojis ───────────────────────────────────────────────────────────

const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '🤔'];

// ── Sub-components ────────────────────────────────────────────────────────────

function CtrlBtn({
  onClick,
  active    = true,
  danger    = false,
  label,
  badge,
  children,
}: {
  onClick:   () => void;
  active?:   boolean;
  danger?:   boolean;
  label:     string;
  badge?:    number;
  children:  React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col items-center gap-1 group">
      <button
        onClick={onClick}
        aria-label={label}
        title={label}
        className={clsx(
          'relative w-12 h-12 rounded-xl flex items-center justify-center',
          'transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950',
          danger
            ? 'bg-red-600 hover:bg-red-500 text-white focus:ring-red-500'
            : active
            ? 'bg-gray-700 hover:bg-gray-600 text-white focus:ring-gray-500'
            : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 focus:ring-red-500'
        )}
      >
        {children}
        {/* Badge for unread count */}
        {badge != null && badge > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 rounded-full text-[10px] text-white font-bold flex items-center justify-center">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
      {/* Tooltip */}
      <span className="absolute -bottom-6 text-[11px] text-gray-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {label}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ControlBar({
  isMicOn,
  isCameraOn,
  isScreenSharing,
  isHandRaised,
  chatUnreadCount,
  onToggleMic,
  onToggleCamera,
  onToggleScreen,
  onToggleHand,
  onToggleChat,
  onToggleParticipants,
  onOpenDevices,
  onReaction,
  onLeave,
}: ControlBarProps) {
  const [showReactions, setShowReactions] = useState(false);
  const reactionRef = useRef<HTMLDivElement>(null);

  // Close reaction picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (reactionRef.current && !reactionRef.current.contains(e.target as Node)) {
        setShowReactions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="h-20 bg-gray-950 border-t border-gray-800 flex items-center justify-between px-6 flex-shrink-0 relative">

      {/* ── Left cluster: mic + camera + screen ─────────────────────── */}
      <div className="flex items-center gap-3">
        <CtrlBtn
          onClick={onToggleMic}
          active={isMicOn}
          label={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
        </CtrlBtn>

        <CtrlBtn
          onClick={onToggleCamera}
          active={isCameraOn}
          label={isCameraOn ? 'Stop camera' : 'Start camera'}
        >
          {isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
        </CtrlBtn>

        <CtrlBtn
          onClick={onToggleScreen}
          active={!isScreenSharing}
          label={isScreenSharing ? 'Stop sharing' : 'Share screen'}
        >
          {isScreenSharing ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
        </CtrlBtn>

        {/* Device settings */}
        <CtrlBtn onClick={onOpenDevices} label="Audio & video settings">
          <Settings size={18} />
        </CtrlBtn>
      </div>

      {/* ── Centre cluster: reactions + hand ────────────────────────── */}
      <div className="flex items-center gap-3 relative" ref={reactionRef}>
        {/* Reaction picker button */}
        <div className="relative">
          <CtrlBtn
            onClick={() => setShowReactions((v) => !v)}
            label="Send reaction"
          >
            <Smile size={20} />
          </CtrlBtn>

          {showReactions && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-2xl p-2 flex gap-1.5 z-50 shadow-xl animate-slide-up">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    onReaction(emoji);
                    setShowReactions(false);
                  }}
                  className="text-2xl hover:scale-125 transition-transform p-1 rounded-lg hover:bg-gray-700"
                  aria-label={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <CtrlBtn
          onClick={onToggleHand}
          active={!isHandRaised}
          label={isHandRaised ? 'Lower hand' : 'Raise hand'}
        >
          <Hand
            size={20}
            className={isHandRaised ? 'text-yellow-400' : ''}
          />
        </CtrlBtn>
      </div>

      {/* ── Right cluster: chat + participants + leave ───────────────── */}
      <div className="flex items-center gap-3">
        <CtrlBtn
          onClick={onToggleChat}
          label="Chat"
          badge={chatUnreadCount}
        >
          <MessageSquare size={20} />
        </CtrlBtn>

        <CtrlBtn onClick={onToggleParticipants} label="Participants">
          <Users size={20} />
        </CtrlBtn>

        {/* Leave — red and prominent */}
        <CtrlBtn onClick={onLeave} danger label="Leave session">
          <Phone size={20} className="rotate-[135deg]" />
        </CtrlBtn>
      </div>
    </div>
  );
}