'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/auth.store';

interface WaitingRoomProps {
  sessionTitle: string;
  onJoin:       () => Promise<void>;
  isJoining:    boolean;
  error?:       string | null;
}

export function WaitingRoom({
  sessionTitle,
  onJoin,
  isJoining,
  error,
}: WaitingRoomProps) {
  const { user }      = useAuthStore();
  const videoRef      = useRef<HTMLVideoElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);

  const [micOn,    setMicOn]    = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [devices,  setDevices]  = useState({ hasCamera: false, hasMic: false });

  // Preview local camera
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setDevices({
          hasCamera: stream.getVideoTracks().length > 0,
          hasMic:    stream.getAudioTracks().length > 0,
        });
      } catch {
        // No media — still allow joining audio-only or viewer-only
      }
    })();

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleMic = () => {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    tracks.forEach((t) => (t.enabled = !micOn));
    setMicOn((v) => !v);
  };

  const toggleCamera = () => {
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    tracks.forEach((t) => (t.enabled = !cameraOn));
    setCameraOn((v) => !v);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Title */}
        <div className="text-center mb-8">
          <p className="text-gray-400 text-sm mb-2">Ready to join?</p>
          <h1 className="text-white text-2xl font-bold">{sessionTitle}</h1>
          {user && (
            <p className="text-gray-400 text-sm mt-2">Joining as <span className="text-white">{user.name}</span></p>
          )}
        </div>

        {/* Camera preview */}
        <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-video mb-4 border border-gray-800">
          {devices.hasCamera && cameraOn ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-16 h-16 rounded-full bg-indigo-700 flex items-center justify-center text-white text-2xl font-semibold">
                {user?.name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <span className="text-gray-400 text-sm">
                {!devices.hasCamera ? 'No camera detected' : 'Camera off'}
              </span>
            </div>
          )}
        </div>

        {/* Toggle buttons */}
        <div className="flex justify-center gap-4 mb-6">
          <button
            onClick={toggleMic}
            disabled={!devices.hasMic}
            className="flex flex-col items-center gap-1.5 group disabled:opacity-40"
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${micOn ? 'bg-gray-700 group-hover:bg-gray-600' : 'bg-red-500/20'}`}>
              {micOn
                ? <Mic size={20} className="text-white" />
                : <MicOff size={20} className="text-red-400" />}
            </div>
            <span className="text-xs text-gray-400">
              {micOn ? 'Mute' : 'Unmute'}
            </span>
          </button>

          <button
            onClick={toggleCamera}
            disabled={!devices.hasCamera}
            className="flex flex-col items-center gap-1.5 group disabled:opacity-40"
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${cameraOn ? 'bg-gray-700 group-hover:bg-gray-600' : 'bg-red-500/20'}`}>
              {cameraOn
                ? <Video size={20} className="text-white" />
                : <VideoOff size={20} className="text-red-400" />}
            </div>
            <span className="text-xs text-gray-400">
              {cameraOn ? 'Stop video' : 'Start video'}
            </span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Join button */}
        <Button
          onClick={onJoin}
          loading={isJoining}
          fullWidth
          size="lg"
          className="text-base"
        >
          {isJoining ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Joining…
            </>
          ) : (
            'Join now'
          )}
        </Button>
      </div>
    </div>
  );
}