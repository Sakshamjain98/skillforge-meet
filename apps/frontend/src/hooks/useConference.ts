'use client';
import { useEffect, useRef, useCallback } from 'react';
import type { Transport, Producer, Consumer } from 'mediasoup-client/types';
import type { Device } from 'mediasoup-client';
import { getDevice, resetDevice } from '@/lib/mediasoup-device';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { useConferenceStore } from '@/store/conference.store';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import type { TurnCredentials, RemoteProducer } from '@/types/conference.types';
import toast from 'react-hot-toast';

// ── Helpers ───────────────────────────────────────────────────────────────────

function emitWithPromise<T = any>(
  socket: ReturnType<typeof getSocket>,
  event: string,
  data?: any
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (res: T & { error?: string }) => {
      if (res && (res as any).error) reject(new Error((res as any).error));
      else resolve(res);
    };
    if (data !== undefined) socket.emit(event, data, handler);
    else socket.emit(event, handler);
  });
}

function buildIceServers(turn: TurnCredentials) {
  return turn.uris.map((uri) => ({
    urls:       uri,
    username:   turn.username,
    credential: turn.password,
  }));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useConference(roomId: string) {
  const store = useConferenceStore();
  const ui    = useUIStore();
  const { user, accessToken } = useAuthStore.getState();

  // Refs hold mutable mediasoup state that should NOT trigger re-renders
  const sendTransportRef  = useRef<Transport | null>(null);
  const recvTransportRef  = useRef<Transport | null>(null);
  const audioProducerRef  = useRef<Producer | null>(null);
  const videoProducerRef  = useRef<Producer | null>(null);
  const consumersRef      = useRef<Map<string, Consumer>>(new Map());
  const turnRef           = useRef<TurnCredentials | null>(null);

  // ── Create a WebRTC transport (send or recv) ────────────────────────────
  const createTransport = useCallback(
    async (direction: 'send' | 'recv'): Promise<Transport> => {
      const socket = getSocket();
      const params = await emitWithPromise(socket, 'create-transport', { direction });

      const iceServers = turnRef.current ? buildIceServers(turnRef.current) : [];
      const device     = getDevice();

      const transport =
        direction === 'send'
          ? device.createSendTransport({ ...params, iceServers })
          : device.createRecvTransport({ ...params, iceServers });

      // ── DTLS connect ───────────────────────────────────────────────────
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        emitWithPromise(socket, 'connect-transport', {
          transportId: transport.id,
          dtlsParameters,
          direction,
        })
          .then(callback)
          .catch(errback);
      });

      // ── Produce (send only) ────────────────────────────────────────────
      if (direction === 'send') {
        transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
          emitWithPromise<{ id: string }>(socket, 'produce', {
            kind,
            rtpParameters,
            appData,
          })
            .then(({ id }) => callback({ id }))
            .catch(errback);
        });
      }

      // ── ICE restart on failure ─────────────────────────────────────────
      transport.on('connectionstatechange', async (state) => {
        if (state === 'failed') {
          try {
            // Ask server to restart ICE for this transport — server will return
            // new iceParameters which the client must pass to transport.restartIce().
            const res = await emitWithPromise<{ iceParameters: any }>(socket, 'restart-ice', {
              transportId: transport.id,
              direction,
            });

            await transport.restartIce({ iceParameters: res.iceParameters });
          } catch (err) {
            console.error('restart-ice failed', err);
          }
        }
      });

      return transport;
    },
    []
  );

  // ── Consume a remote producer ───────────────────────────────────────────
  const consumeProducer = useCallback(
    async (producerId: string, userId: string, kind: 'audio' | 'video') => {
      const socket = getSocket();
      const device = getDevice();
      const recvTransport = recvTransportRef.current;
      if (!recvTransport || !device.loaded) return;

      try {
        console.debug('[consume] requesting params', { producerId });
        const params = await emitWithPromise(socket, 'consume', {
          producerId,
          rtpCapabilities: device.rtpCapabilities,
        });
        console.debug('[consume] params received', { producerId, params });

        const consumer = await recvTransport.consume(params);
        consumersRef.current.set(consumer.id, consumer);

        const stream = new MediaStream([consumer.track]);

        if (kind === 'video') {
          store.setPeerVideoStream(userId, stream);
        } else {
          store.setPeerAudioStream(userId, stream);
        }

        // Resume — consumer starts paused by default
        await emitWithPromise(socket, 'resume-consumer', { consumerId: consumer.id });

        consumer.on('trackended', () => {
          store.updatePeer(userId, kind === 'video' ? { videoStream: undefined } : { audioStream: undefined });
        });

        consumer.on('transportclose', () => {
          consumersRef.current.delete(consumer.id);
        });
      } catch (err: any) {
        console.error(`[consume] ${kind} from ${userId}:`, err.message);
      }
    },
    []
  );

  // ── JOIN ────────────────────────────────────────────────────────────────
  const joinRoom = useCallback(async () => {
    if (!accessToken || !user) throw new Error('Not authenticated');

    store.setRoomId(roomId);
    store.setError(null);

    // 1. TURN credentials
    try {
      const { data } = await api.get<TurnCredentials>('/turn/credentials');
      turnRef.current = data;
    } catch {
      console.warn('[TURN] Could not fetch credentials — continuing without TURN');
    }

    // 2. Connect socket
    const socket = connectSocket(accessToken);
    await new Promise<void>((resolve, reject) => {
      if (socket.connected) return resolve();
      socket.once('connect', resolve);
      socket.once('connect_error', (err) => reject(err));
    });
    store.setConnected(true);

    // 3. Get local media (gracefully degrade to audio-only)
    let localStream: MediaStream | null = null;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        store.setCameraOn(false);
        toast('Camera unavailable — joining audio only', { icon: '🎙️' });
      } catch {
        toast.error('Cannot access microphone. Joining without media.');
      }
    }
    if (localStream) store.setLocalStream(localStream);

    // 4. Join room → receive router capabilities + existing producers
    const joinData = await emitWithPromise<{
      rtpCapabilities: any;
      existingProducers: RemoteProducer[];
      peers: Array<{ userId: string; name: string; role: string }>;
    }>(socket, 'join-room', { roomId });

    // Add existing peers to store
    for (const p of joinData.peers) {
      store.addPeer({
        ...p,
        socketId:    '',
        isHandRaised: false,
        isMuted:     false,
        isCameraOff: false,
      });
    }

    // 5. Load mediasoup Device
    const device = getDevice();
    if (!device.loaded) {
      await device.load({ routerRtpCapabilities: joinData.rtpCapabilities });
    }

    // 6. Create send transport
    const sendTransport = await createTransport('send');
    sendTransportRef.current = sendTransport;

    // 7. Create recv transport
    const recvTransport = await createTransport('recv');
    recvTransportRef.current = recvTransport;

    // 8. Produce local tracks
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioProducerRef.current = await sendTransport.produce({
          track:     audioTrack,
          codecOptions: { opusStereo: true, opusDtx: true },
        });
      }

      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoProducerRef.current = await sendTransport.produce({
          track: videoTrack,
          encodings: [
            { rid: 'r0', maxBitrate:   100_000, scalabilityMode: 'S1T3' },
            { rid: 'r1', maxBitrate:   500_000, scalabilityMode: 'S1T3' },
            { rid: 'r2', maxBitrate: 1_500_000, scalabilityMode: 'S1T3' },
          ],
          codecOptions: { videoGoogleStartBitrate: 1000 },
        });
      }
    }

    // 9. Consume existing streams
    for (const { producerId, userId, kind } of joinData.existingProducers) {
      await consumeProducer(producerId, userId, kind);
    }

    // 10. Pre-load chat history
    const chatData = await emitWithPromise<{ messages: any[] }>(
      socket,
      'get-chat-history'
    );
    store.setMessages(chatData.messages ?? []);

    store.setJoined(true);
    toast.success('Joined session');
  }, [roomId, accessToken, user]);

  // ── Socket event listeners ────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    socket.on('connect', () => console.debug('[socket] connected', socket.id));
    socket.on('connect_error', (err) => console.error('[socket] connect_error', err));

    const onPeerJoined = (data: { userId: string; name: string; role: string; socketId: string }) => {
      store.addPeer({
        ...data,
        isHandRaised: false,
        isMuted:      false,
        isCameraOff:  false,
      });
      toast(`${data.name} joined`, { icon: '👋', duration: 3000 });
    };

    const onPeerLeft = ({ userId }: { userId: string }) => {
      // Stop and clean up consumer tracks for this user
      const peer = useConferenceStore.getState().peers.get(userId);
      if (peer?.videoStream) peer.videoStream.getTracks().forEach((t) => t.stop());
      if (peer?.audioStream) peer.audioStream.getTracks().forEach((t) => t.stop());
      store.removePeer(userId);
    };

    const onNewProducer = async ({
      producerId,
      userId,
      kind,
    }: {
      producerId: string;
      userId:     string;
      kind:       'audio' | 'video';
    }) => {
      console.debug('[socket] new-producer', { producerId, userId, kind });
      try {
        await consumeProducer(producerId, userId, kind);
        console.debug('[consume] success', { producerId, userId, kind });
      } catch (err: any) {
        console.error('[consume] failed', { producerId, userId, kind, error: err?.message ?? err });
      }
    };

    const onNewMessage = (msg: any) => {
      store.addMessage(msg);
      if (!useUIStore.getState().showChat) {
        ui.incrementUnread();
      }
    };

    const onHandRaised = ({ userId, raised }: { userId: string; raised: boolean }) => {
      store.updatePeer(userId, { isHandRaised: raised });
    };

    const onPeerStateChanged = ({
      userId,
      isMuted,
      isCameraOff,
    }: {
      userId:      string;
      isMuted:     boolean;
      isCameraOff: boolean;
    }) => {
      store.updatePeer(userId, { isMuted, isCameraOff });
    };

    const onForceMute = ({ targetUserId }: { targetUserId: string }) => {
      if (targetUserId === user?.id) {
        toggleMic();
        toast('You were muted by the host', { icon: '🔇' });
      }
    };

    const onForceKick = ({ targetUserId }: { targetUserId: string }) => {
      if (targetUserId === user?.id) {
        toast.error('You were removed from the session');
        leaveRoom();
      }
    };

    const onReaction = ({ name, emoji }: { name: string; emoji: string }) => {
      toast(`${name}: ${emoji}`, { duration: 2000 });
    };

    const onPollStarted = (poll: any) => {
      store.setActivePoll({ ...poll, answers: {} });
      toast('A poll has started!', { icon: '📊' });
    };

    const onPollAnswer = ({
      pollId,
      userId,
      answer,
    }: {
      pollId:  string;
      userId:  string;
      answer:  string;
    }) => {
      store.addPollAnswer(pollId, userId, answer);
    };

    const onConsumerClosed = ({ consumerId }: { consumerId: string }) => {
      const c = consumersRef.current.get(consumerId);
      if (c) { try { c.close(); } catch { /* ignore */ } consumersRef.current.delete(consumerId); }
      console.debug('[socket] consumer-closed', { consumerId });
    };

    socket.on('peer-joined',        onPeerJoined);
    socket.on('peer-left',          onPeerLeft);
    socket.on('new-producer',       onNewProducer);
    socket.on('new-message',        onNewMessage);
    socket.on('hand-raised',        onHandRaised);
    socket.on('peer-state-changed', onPeerStateChanged);
    socket.on('force-mute',         onForceMute);
    socket.on('force-kick',         onForceKick);
    socket.on('reaction',           onReaction);
    socket.on('poll-started',       onPollStarted);
    socket.on('poll-answer',        onPollAnswer);
    socket.on('consumer-closed',    onConsumerClosed);

    return () => {
      socket.off('peer-joined',        onPeerJoined);
      socket.off('peer-left',          onPeerLeft);
      socket.off('new-producer',       onNewProducer);
      socket.off('new-message',        onNewMessage);
      socket.off('hand-raised',        onHandRaised);
      socket.off('peer-state-changed', onPeerStateChanged);
      socket.off('force-mute',         onForceMute);
      socket.off('force-kick',         onForceKick);
      socket.off('reaction',           onReaction);
      socket.off('poll-started',       onPollStarted);
      socket.off('poll-answer',        onPollAnswer);
      socket.off('consumer-closed',    onConsumerClosed);
    };
  }, [user?.id]);

  // ── Controls ─────────────────────────────────────────────────────────────

  const toggleMic = useCallback(async () => {
    const producer = audioProducerRef.current;
    const socket   = getSocket();
    if (!producer) return;

    const nowOn = store.isMicOn;
    if (nowOn) {
      await producer.pause();
      socket.emit('pause-producer', { producerId: producer.id }, () => {});
    } else {
      await producer.resume();
      socket.emit('resume-producer', { producerId: producer.id }, () => {});
    }
    store.setMicOn(!nowOn);
    socket.emit('update-peer-state', { isMuted: nowOn });
  }, [store.isMicOn]);

  const toggleCamera = useCallback(async () => {
    const producer = videoProducerRef.current;
    const socket   = getSocket();
    if (!producer) return;

    const nowOn = store.isCameraOn;
    if (nowOn) {
      await producer.pause();
      socket.emit('pause-producer', { producerId: producer.id }, () => {});
    } else {
      await producer.resume();
      socket.emit('resume-producer', { producerId: producer.id }, () => {});
    }
    store.setCameraOn(!nowOn);
    socket.emit('update-peer-state', { isCameraOff: nowOn });
  }, [store.isCameraOn]);

  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { displaySurface: 'monitor', frameRate: { ideal: 30 } },
        audio: false,
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      if (videoProducerRef.current) {
        await videoProducerRef.current.replaceTrack({ track: screenTrack });
      }

      store.setLocalStream(screenStream);
      store.setScreenSharing(true);

      screenTrack.addEventListener('ended', () => {
        stopScreenShare();
      }, { once: true });
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') toast.error('Screen share failed');
    }
  }, []);

  const stopScreenShare = useCallback(async () => {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const camTrack = camStream.getVideoTracks()[0];
      if (videoProducerRef.current) {
        await videoProducerRef.current.replaceTrack({ track: camTrack });
      }
      // Stop old screen share tracks
      store.localStream?.getTracks().forEach((t) => t.stop());
      store.setLocalStream(camStream);
      store.setScreenSharing(false);
    } catch {
      toast.error('Could not restore camera');
    }
  }, [store.localStream]);

  const toggleHand = useCallback(() => {
    const raised = !store.isHandRaised;
    store.setHandRaised(raised);
    getSocket().emit('raise-hand', { raised });
  }, [store.isHandRaised]);

  const sendReaction = useCallback((emoji: string) => {
    getSocket().emit('send-reaction', { emoji });
  }, []);

  const sendMessage = useCallback((text: string) => {
    getSocket().emit('send-message', { text }, (res: any) => {
      if (res && (res as any).error) {
        console.error('[send-message] error', res.error);
        toast.error(res.error);
      }
    });
  }, []);

  const mutePeer = useCallback((targetUserId: string) => {
    getSocket().emit('mute-peer', { targetUserId });
  }, []);

  const kickPeer = useCallback((targetUserId: string) => {
    getSocket().emit('kick-peer', { targetUserId });
  }, []);

  // ── LEAVE ─────────────────────────────────────────────────────────────────
  const leaveRoom = useCallback(async () => {
    // Stop local tracks
    store.localStream?.getTracks().forEach((t) => t.stop());

    // Close producers
    try { audioProducerRef.current?.close(); } catch { /* ignore */ }
    try { videoProducerRef.current?.close(); } catch { /* ignore */ }

    // Close transports
    try { sendTransportRef.current?.close(); } catch { /* ignore */ }
    try { recvTransportRef.current?.close(); } catch { /* ignore */ }

    // Close all consumers
    for (const c of consumersRef.current.values()) {
      try { c.close(); } catch { /* ignore */ }
    }
    consumersRef.current.clear();

    // Notify server
    getSocket().emit('leave-room');
    disconnectSocket();

    // Reset mediasoup device for next session
    resetDevice();

    // Reset store
    store.reset();
    ui.closeSidePanels();
  }, [store.localStream]);

  return {
    // Actions
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
    // Reactive state (from store — components subscribe directly)
  };
}