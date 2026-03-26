import { create } from 'zustand';
import type { Peer, ChatMessage, ConferenceState, Poll } from '@/types/conference.types';

interface ConferenceStore extends ConferenceState {
  // Room
  setRoomId:       (roomId: string) => void;
  setConnected:    (v: boolean) => void;
  setJoined:       (v: boolean) => void;
  setError:        (err: string | null) => void;

  // Peers
  addPeer:         (peer: Peer) => void;
  removePeer:      (userId: string) => void;
  updatePeer:      (userId: string, updates: Partial<Peer>) => void;
  setPeerVideoStream: (userId: string, stream: MediaStream) => void;
  setPeerAudioStream: (userId: string, stream: MediaStream) => void;

  // Local media
  setLocalStream:  (stream: MediaStream | null) => void;
  setMicOn:        (on: boolean) => void;
  setCameraOn:     (on: boolean) => void;
  setScreenSharing:(sharing: boolean) => void;
  setHandRaised:   (raised: boolean) => void;

  // Chat
  addMessage:      (msg: ChatMessage) => void;
  setMessages:     (msgs: ChatMessage[]) => void;

  // Polls
  setActivePoll:   (poll: Poll | null) => void;
  addPollAnswer:   (pollId: string, userId: string, answer: string) => void;

  // Reset entire state on leave
  reset:           () => void;
}

const INITIAL_STATE: ConferenceState = {
  roomId:          null,
  peers:           new Map(),
  localStream:     null,
  isMicOn:         true,
  isCameraOn:      true,
  isScreenSharing: false,
  isHandRaised:    false,
  messages:        [],
  activePoll:      null,
  isConnected:     false,
  isJoined:        false,
  error:           null,
};

export const useConferenceStore = create<ConferenceStore>((set) => ({
  ...INITIAL_STATE,

  setRoomId:    (roomId)    => set({ roomId }),
  setConnected: (isConnected) => set({ isConnected }),
  setJoined:    (isJoined)  => set({ isJoined }),
  setError:     (error)     => set({ error }),

  addPeer: (peer) =>
    set((s) => {
      const peers = new Map(s.peers);
      peers.set(peer.userId, peer);
      return { peers };
    }),

  removePeer: (userId) =>
    set((s) => {
      const peers = new Map(s.peers);
      peers.delete(userId);
      return { peers };
    }),

  updatePeer: (userId, updates) =>
    set((s) => {
      const peers = new Map(s.peers);
      const existing = peers.get(userId);
      if (existing) peers.set(userId, { ...existing, ...updates });
      return { peers };
    }),

  setPeerVideoStream: (userId, stream) =>
    set((s) => {
      const peers = new Map(s.peers);
      const peer  = peers.get(userId);
      if (peer) peers.set(userId, { ...peer, videoStream: stream });
      return { peers };
    }),

  setPeerAudioStream: (userId, stream) =>
    set((s) => {
      const peers = new Map(s.peers);
      const peer  = peers.get(userId);
      if (peer) peers.set(userId, { ...peer, audioStream: stream });
      return { peers };
    }),

  setLocalStream:   (localStream)     => set({ localStream }),
  setMicOn:         (isMicOn)         => set({ isMicOn }),
  setCameraOn:      (isCameraOn)      => set({ isCameraOn }),
  setScreenSharing: (isScreenSharing) => set({ isScreenSharing }),
  setHandRaised:    (isHandRaised)    => set({ isHandRaised }),

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  setMessages: (messages) => set({ messages }),

  setActivePoll: (activePoll) => set({ activePoll }),

  addPollAnswer: (pollId, userId, answer) =>
    set((s) => {
      if (!s.activePoll || s.activePoll.pollId !== pollId) return s;
      return {
        activePoll: {
          ...s.activePoll,
          answers: { ...s.activePoll.answers, [userId]: answer },
        },
      };
    }),

  reset: () => set({ ...INITIAL_STATE, peers: new Map() }),
}));