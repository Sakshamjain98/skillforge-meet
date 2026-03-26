'use client';
import { useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';

interface MediaStreamState {
  stream:      MediaStream | null;
  hasVideo:    boolean;
  hasAudio:    boolean;
  isLoading:   boolean;
  error:       string | null;
}

interface UseMediaStreamReturn extends MediaStreamState {
  startMedia:        (video?: boolean, audio?: boolean) => Promise<MediaStream | null>;
  stopMedia:         () => void;
  toggleVideo:       () => Promise<void>;
  toggleAudio:       () => void;
  startScreenShare:  () => Promise<MediaStream | null>;
  getVideoDevices:   () => Promise<MediaDeviceInfo[]>;
  getAudioDevices:   () => Promise<MediaDeviceInfo[]>;
  switchCamera:      (deviceId: string) => Promise<void>;
  switchMicrophone:  (deviceId: string) => Promise<void>;
}

export function useMediaStream(): UseMediaStreamReturn {
  const [state, setState] = useState<MediaStreamState>({
    stream:    null,
    hasVideo:  false,
    hasAudio:  false,
    isLoading: false,
    error:     null,
  });

  const streamRef = useRef<MediaStream | null>(null);

  // ── Start camera + mic ────────────────────────────────────────────────────
  const startMedia = useCallback(
    async (video = true, audio = true): Promise<MediaStream | null> => {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: video
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
            : false,
          audio: audio
            ? { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 }
            : false,
        });

        streamRef.current = stream;
        setState({
          stream,
          hasVideo:  stream.getVideoTracks().length > 0,
          hasAudio:  stream.getAudioTracks().length > 0,
          isLoading: false,
          error:     null,
        });
        return stream;
      } catch (err: any) {
        const msg =
          err.name === 'NotAllowedError'
            ? 'Camera/microphone permission denied'
            : err.name === 'NotFoundError'
            ? 'No camera or microphone found'
            : `Media error: ${err.message}`;

        setState((s) => ({ ...s, isLoading: false, error: msg }));
        toast.error(msg);
        return null;
      }
    },
    []
  );

  // ── Stop all tracks ───────────────────────────────────────────────────────
  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState({ stream: null, hasVideo: false, hasAudio: false, isLoading: false, error: null });
  }, []);

  // ── Toggle video track ────────────────────────────────────────────────────
  const toggleVideo = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      // Add a new video track
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
        newStream.getVideoTracks().forEach((t) => stream.addTrack(t));
        setState((s) => ({ ...s, hasVideo: true }));
      } catch {
        toast.error('Cannot access camera');
      }
    } else {
      // Toggle enabled state
      const enabled = videoTracks[0].enabled;
      videoTracks.forEach((t) => (t.enabled = !enabled));
      setState((s) => ({ ...s, hasVideo: !enabled }));
    }
  }, []);

  // ── Toggle audio track ────────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    const enabled = audioTracks[0]?.enabled ?? false;
    audioTracks.forEach((t) => (t.enabled = !enabled));
    setState((s) => ({ ...s, hasAudio: !enabled }));
  }, []);

  // ── Screen share ──────────────────────────────────────────────────────────
  const startScreenShare = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { displaySurface: 'monitor', frameRate: { ideal: 30 } },
        audio: true,
      });
      return screenStream;
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        toast.error('Screen share failed');
      }
      return null;
    }
  }, []);

  // ── Device enumeration ────────────────────────────────────────────────────
  const getVideoDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }, []);

  const getAudioDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }, []);

  // ── Switch devices ────────────────────────────────────────────────────────
  const switchCamera = useCallback(async (deviceId: string) => {
    const stream = streamRef.current;
    if (!stream) return;
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
    });
    const oldTrack = stream.getVideoTracks()[0];
    const newTrack = newStream.getVideoTracks()[0];
    if (oldTrack) { stream.removeTrack(oldTrack); oldTrack.stop(); }
    stream.addTrack(newTrack);
  }, []);

  const switchMicrophone = useCallback(async (deviceId: string) => {
    const stream = streamRef.current;
    if (!stream) return;
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    });
    const oldTrack = stream.getAudioTracks()[0];
    const newTrack = newStream.getAudioTracks()[0];
    if (oldTrack) { stream.removeTrack(oldTrack); oldTrack.stop(); }
    stream.addTrack(newTrack);
  }, []);

  return {
    ...state,
    startMedia,
    stopMedia,
    toggleVideo,
    toggleAudio,
    startScreenShare,
    getVideoDevices,
    getAudioDevices,
    switchCamera,
    switchMicrophone,
  };
}