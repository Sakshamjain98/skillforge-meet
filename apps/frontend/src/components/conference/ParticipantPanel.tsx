'use client';
import { X, MicOff, Hand, ShieldX, Crown } from 'lucide-react';
import { clsx } from 'clsx';
import { useConferenceStore } from '@/store/conference.store';
import { useAuthStore } from '@/store/auth.store';
import type { Peer } from '@/types/conference.types';

interface ParticipantPanelProps {
  onClose:    () => void;
  onMutePeer: (userId: string) => void;
  onKickPeer: (userId: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
  ORG_ADMIN:   'Admin',
  MANAGER:     'Manager',
  COACH:       'Coach',
  STAFF_WHITE: 'Staff',
  STAFF_BLUE:  'Staff',
};

const MODERATOR_ROLES = new Set(['COACH', 'ORG_ADMIN', 'MANAGER']);

function Avatar({ name, small }: { name: string; small?: boolean }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={clsx(
        'rounded-full bg-indigo-700 flex items-center justify-center',
        'text-white font-semibold flex-shrink-0',
        small ? 'w-7 h-7 text-xs' : 'w-8 h-8 text-sm'
      )}
    >
      {initials}
    </div>
  );
}

function PeerRow({
  peer,
  isLocal,
  canModerate,
  onMute,
  onKick,
}: {
  peer:        Peer | { userId: string; name: string; role: string; isMuted: boolean; isCameraOff: boolean; isHandRaised: boolean };
  isLocal:     boolean;
  canModerate: boolean;
  onMute:      () => void;
  onKick:      () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/60 group transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar name={peer.name} />
        <div className="min-w-0">
          <p className="text-white text-sm font-medium flex items-center gap-1.5 truncate">
            {isLocal ? `${peer.name} (You)` : peer.name}
            {peer.role === 'COACH' && (
              <Crown size={11} className="text-yellow-400 flex-shrink-0" />
            )}
          </p>
          <p className="text-gray-500 text-xs">
            {ROLE_LABELS[peer.role] ?? peer.role}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Status indicators */}
        {('isHandRaised' in peer) && peer.isHandRaised && (
          <Hand size={13} className="text-yellow-400" />
        )}
        {peer.isMuted && (
          <MicOff size={13} className="text-red-400" />
        )}

        {/* Moderator actions — visible on hover for non-local peers */}
        {canModerate && !isLocal && (
          <div className="hidden group-hover:flex items-center gap-1 ml-1">
            <button
              onClick={onMute}
              title="Mute"
              className="p-1 rounded text-gray-400 hover:text-yellow-400 hover:bg-gray-700 transition-colors"
            >
              <MicOff size={13} />
            </button>
            <button
              onClick={onKick}
              title="Remove"
              className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors"
            >
              <ShieldX size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ParticipantPanel({
  onClose,
  onMutePeer,
  onKickPeer,
}: ParticipantPanelProps) {
  const { user }   = useAuthStore();
  const peers      = useConferenceStore((s) => Array.from(s.peers.values()));
  const isMicOn    = useConferenceStore((s) => s.isMicOn);
  const isHandRaised = useConferenceStore((s) => s.isHandRaised);

  const canModerate = MODERATOR_ROLES.has(user?.role ?? '');
  const totalCount  = peers.length + 1;

  return (
    <div className="flex flex-col w-72 min-w-[288px] h-full bg-gray-900 border-l border-gray-800 animate-slide-up">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <span className="text-white font-semibold">
          Participants
          <span className="ml-2 text-gray-400 text-sm font-normal">
            ({totalCount})
          </span>
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800"
          aria-label="Close participants"
        >
          <X size={16} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin scrollbar-thumb-gray-700">

        {/* Local user (always first) */}
        {user && (
          <PeerRow
            peer={{
              userId:      user.id,
              name:        user.name,
              role:        user.role,
              isMuted:     !isMicOn,
              isCameraOff: false,
              isHandRaised,
            }}
            isLocal
            canModerate={false}
            onMute={() => {}}
            onKick={() => {}}
          />
        )}

        {/* Separator */}
        {peers.length > 0 && (
          <div className="mx-4 my-2 border-t border-gray-800" />
        )}

        {/* Remote peers */}
        {peers.map((peer) => (
          <PeerRow
            key={peer.userId}
            peer={peer}
            isLocal={false}
            canModerate={canModerate}
            onMute={() => onMutePeer(peer.userId)}
            onKick={() => onKickPeer(peer.userId)}
          />
        ))}

        {peers.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-8">
            No other participants yet
          </p>
        )}
      </div>
    </div>
  );
}