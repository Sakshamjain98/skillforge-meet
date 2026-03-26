'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Video, Plus, Calendar, Clock, Users,
  LogOut, CheckCircle2, Circle, PlayCircle,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { Session } from '@/types/conference.types';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  SCHEDULED: { label: 'Scheduled', color: 'text-yellow-400 bg-yellow-400/10', icon: Circle },
  LIVE:      { label: 'Live now',  color: 'text-green-400  bg-green-400/10',  icon: PlayCircle },
  COMPLETED: { label: 'Ended',     color: 'text-gray-400   bg-gray-400/10',   icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', color: 'text-red-400    bg-red-400/10',    icon: Circle },
} as const;

// ── Create session modal ──────────────────────────────────────────────────────

function CreateSessionModal({
  open,
  onClose,
  onCreate,
}: {
  open:     boolean;
  onClose:  () => void;
  onCreate: (session: Session) => void;
}) {
  const [title, setTitle]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/sessions', { title: title.trim() });
      onCreate(data.session);
      setTitle('');
      onClose();
      toast.success('Session created!');
    } catch {
      toast.error('Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New session">
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-300 font-medium mb-1.5">
            Session title
          </label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="e.g. React Hooks deep dive"
            maxLength={200}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5
              text-white placeholder:text-gray-500 text-sm
              focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} fullWidth>Cancel</Button>
          <Button onClick={handleCreate} loading={loading} fullWidth>Create</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({
  session,
  onJoin,
}: {
  session: Session;
  onJoin:  (id: string) => void;
}) {
  const cfg      = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.SCHEDULED;
  const StatusIcon = cfg.icon;
  const canJoin  = session.status === 'LIVE' || session.status === 'SCHEDULED';
  const { user } = useAuthStore();
  const isExternal = !!(session.orgId && user && session.orgId !== user.orgId);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-4">

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-white font-semibold text-base truncate">
              {session.title}
            </h3>
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.color}`}>
              <StatusIcon size={10} />
              {cfg.label}
            </span>
            {isExternal && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
                External
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 mt-1.5">
            <span className="flex items-center gap-1.5">
              <Users size={13} />
              {session.coach.name}
            </span>
            {session.scheduledAt && (
              <span className="flex items-center gap-1.5">
                <Calendar size={13} />
                {format(new Date(session.scheduledAt), 'MMM d, HH:mm')}
              </span>
            )}
            {session.startedAt && session.status === 'LIVE' && (
              <span className="flex items-center gap-1.5 text-green-400">
                <Clock size={13} />
                Started {formatDistanceToNow(new Date(session.startedAt))} ago
              </span>
            )}
            {session.endedAt && (
              <span className="flex items-center gap-1.5">
                <Clock size={13} />
                Ended {formatDistanceToNow(new Date(session.endedAt))} ago
              </span>
            )}
          </div>
        </div>

        {/* Action */}
        <Button
          onClick={() => onJoin(session.id)}
          disabled={!canJoin}
          variant={session.status === 'LIVE' ? 'primary' : 'secondary'}
          size="sm"
          className="flex-shrink-0"
        >
          <Video size={14} />
          {session.status === 'LIVE' ? 'Join' : 'Start'}
        </Button>
      </div>

      {/* Recording link */}
      {session.recordingUrl && (
        <a
          href={session.recordingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <PlayCircle size={13} />
          Watch recording
        </a>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { logout } = useAuth();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const canCreateSession = ['COACH', 'ORG_ADMIN', 'MANAGER'].includes(user?.role ?? '');

  useEffect(() => {
    api.get('/sessions')
      .then((r) => setSessions(r.data.sessions))
      .catch(() => toast.error('Failed to load sessions'))
      .finally(() => setLoading(false));
  }, []);

  const handleJoin = (sessionId: string) => {
    router.push(`/room/${sessionId}`);
  };

  const handleCreated = (session: Session) => {
    setSessions((prev) => [session, ...prev]);
  };

  // Group by status for display
  const liveSessions      = sessions.filter((s) => s.status === 'LIVE');
  const scheduledSessions = sessions.filter((s) => s.status === 'SCHEDULED');
  const pastSessions      = sessions.filter((s) => ['COMPLETED', 'CANCELLED'].includes(s.status));

  return (
    <div className="min-h-screen bg-gray-950 overflow-y-auto">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Video size={16} className="text-white" />
            </div>
            <div>
              <span className="text-white font-semibold">SkillForge Meet</span>
              {user?.name && (
                <span className="ml-2 text-gray-500 text-sm">· {user.name}</span>
              )}
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </header>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Page title + create button */}
        <div className="flex items-center justify-between">
          <h2 className="text-white text-2xl font-bold">Sessions</h2>
          {canCreateSession && (
            <Button onClick={() => setShowCreate(true)} size="md">
              <Plus size={16} />
              New session
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-20">
            <Calendar size={40} className="text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No sessions yet</p>
            {canCreateSession && (
              <p className="text-gray-600 text-sm mt-1">
                Create your first session to get started.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Live sessions first */}
            {liveSessions.length > 0 && (
              <section>
                <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  Live now
                </h3>
                <div className="space-y-3">
                  {liveSessions.map((s) => (
                    <SessionCard key={s.id} session={s} onJoin={handleJoin} />
                  ))}
                </div>
              </section>
            )}

            {/* Scheduled */}
            {scheduledSessions.length > 0 && (
              <section>
                <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  Upcoming
                </h3>
                <div className="space-y-3">
                  {scheduledSessions.map((s) => (
                    <SessionCard key={s.id} session={s} onJoin={handleJoin} />
                  ))}
                </div>
              </section>
            )}

            {/* Past */}
            {pastSessions.length > 0 && (
              <section>
                <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  Past sessions
                </h3>
                <div className="space-y-3">
                  {pastSessions.map((s) => (
                    <SessionCard key={s.id} session={s} onJoin={handleJoin} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Create session modal */}
      <CreateSessionModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreated}
      />
    </div>
  );
}