'use client';
import { useCallback, useEffect, useRef, useState, MutableRefObject } from 'react';
import { Mic, MicOff, Video, VideoOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/auth.store';
import { useConferenceStore } from '@/store/conference.store';

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
  const videoRef: MutableRefObject<HTMLVideoElement | null> = useRef<HTMLVideoElement | null>(null) as MutableRefObject<HTMLVideoElement | null>;
  const streamRef     = useRef<MediaStream | null>(null);
  const [previewAttached, setPreviewAttached] = useState(false);

  // Callback ref ensures we attach the stream when the element mounts
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) return;
    const stored = useConferenceStore.getState().localStream ?? streamRef.current;
    if (stored) {
      try {
        el.muted = true;
        el.playsInline = true;
        el.srcObject = stored;
        setPreviewAttached(true);
      } catch (e) {
        console.debug('[WaitingRoom] attach via callback ref failed', e);
      }
    }
  }, []);

  const [micOn,    setMicOn]    = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [devices,  setDevices]  = useState({ hasCamera: false, hasMic: false });
  const [playBlocked, setPlayBlocked] = useState(false);

  // React to store.localStream changes so we attach when the preview becomes available
  const localStream = useConferenceStore((s) => s.localStream);

  useEffect(() => {
    if (!localStream) return;
    const el = videoRef.current;
    if (!el) return;
    try {
      el.muted = true;
      el.playsInline = true;
      el.srcObject = localStream;
      setPreviewAttached(true);
      // attempt to play safely elsewhere (tryPlay effect)
      setPlayBlocked(false);
    } catch (e) {
      console.debug('[WaitingRoom] attach from store failed', e);
    }
  }, [localStream, cameraOn]);

  // Helper to attempt play only when visible/ready; sets playBlocked on failure
  const tryPlay = async (el?: HTMLVideoElement | null) => {
    if (!el) return false;
    // Avoid autoplay attempts when page is hidden or element not visible
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      console.debug('[WaitingRoom] skipping play: document not visible');
      return false;
    }
    // Element must have layout to be play-able
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      console.debug('[WaitingRoom] skipping play: element has no size');
      return false;
    }
    try {
      await el.play();
      setPlayBlocked(false);
      return true;
    } catch (err) {
      console.debug('[WaitingRoom] tryPlay failed', err);
      setPlayBlocked(true);
      return false;
    }
  };

  // Try to play when previewAttached or cameraOn changes
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !previewAttached) return;
    // small timeout lets layout settle
    const id = setTimeout(() => {
      void tryPlay(el);
    }, 120);
    return () => clearTimeout(id);
  }, [previewAttached, cameraOn]);

  // Preview local camera
  useEffect(() => {
    let mounted = true;
    const store = useConferenceStore.getState();

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        console.debug('[WaitingRoom] got preview stream', stream);
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        // Persist preview stream to store so join reuses it
        try {
          useConferenceStore.getState().setLocalStream(stream);
          // Mark preview video as live
          useConferenceStore.getState().setLocalVideoLive(true);
          const vt = stream.getVideoTracks()[0];
          if (vt) vt.addEventListener('ended', () => useConferenceStore.getState().setLocalVideoLive(false), { once: true });
        } catch (e) {
          console.debug('[WaitingRoom] setLocalStream failed', e);
        }
        if (videoRef.current) {
          try {
            const el = videoRef.current;
            el.muted = true;
            el.playsInline = true;
            el.srcObject = stream;
            setPreviewAttached(true);
            await el.play().catch(async (e) => {
              console.debug('[WaitingRoom] video.play() failed', e);
              // retry once after short delay
              await new Promise((res) => setTimeout(res, 200));
              return el.play().catch((err) => console.debug('[WaitingRoom] video.play() retry failed', err));
            });
          } catch (e) {
            console.warn('[WaitingRoom] attach preview failed', e);
          }
        }
        setDevices({
          hasCamera: stream.getVideoTracks().length > 0,
          hasMic:    stream.getAudioTracks().length > 0,
        });
      } catch {
        console.warn('[WaitingRoom] getUserMedia failed — falling back to device enumeration');
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          const hasCamera = devs.some((d) => d.kind === 'videoinput');
          const hasMic = devs.some((d) => d.kind === 'audioinput');
          setDevices({ hasCamera, hasMic });
          console.debug('[WaitingRoom] enumerateDevices result', { hasCamera, hasMic, devs });
        } catch (err) {
          console.warn('[WaitingRoom] enumerateDevices failed', err);
        }
      }
    })();

    return () => {
      mounted = false;
      // If we persisted this preview stream to the store, don't stop its tracks here
      const stored = useConferenceStore.getState().localStream;
      if (streamRef.current && stored && stored.id === streamRef.current.id) {
        // leave tracks running for join flow
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleMic = () => {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    tracks.forEach((t) => (t.enabled = !micOn));
    setMicOn((v) => !v);
    // Persist mic state to store
    useConferenceStore.getState().setMicOn(!micOn);
  };

  const toggleCamera = () => {
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    tracks.forEach((t) => (t.enabled = !cameraOn));
    setCameraOn((v) => !v);
    // Persist camera state to store
    useConferenceStore.getState().setCameraOn(!cameraOn);
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
            <div className="w-full h-full relative">
              <video
                ref={setVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              {playBlocked && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    className="px-3 py-1 bg-black/60 text-white rounded-md"
                    onClick={() => void tryPlay(videoRef.current)}
                  >
                    Click to enable preview
                  </button>
                </div>
              )}
            </div>
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

          {/* Visible debug overlay for troubleshooting preview
          <div className="absolute top-3 left-3 bg-black/60 text-xs text-white px-2 py-1 rounded-md">
            <div>hasCamera: {String(devices.hasCamera)}</div>
            <div>cameraOn: {String(cameraOn)}</div>
            <div>previewAttached: {String(previewAttached)}</div>
            <div>streamId: {useConferenceStore.getState().localStream?.id?.slice(0,8) ?? '—'}</div>
          </div> */}
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