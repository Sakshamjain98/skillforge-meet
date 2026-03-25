// Augment socket.io Socket with our custom data fields
import 'socket.io';
declare module 'socket.io' {
  interface SocketData {
    userId: string;
    orgId:  string;
    role:   string;
    name:   string;
    email:  string;
    roomId: string;
  }
}

// ── Event payload types ──────────────────────────────────────────────────────

export interface JoinRoomPayload {
  roomId: string;
}

export interface JoinRoomResponse {
  rtpCapabilities:   object;
  existingProducers: ExistingProducer[];
  peers:             PeerInfo[];
  error?:            string;
}

export interface ExistingProducer {
  producerId: string;
  userId:     string;
  kind:       'audio' | 'video';
  socketId:   string;
}

export interface PeerInfo {
  userId: string;
  name:   string;
  role:   string;
}

export interface CreateTransportPayload {
  direction: 'send' | 'recv';
}

export interface ConnectTransportPayload {
  transportId:    string;
  dtlsParameters: object;
  direction:      'send' | 'recv';
}

export interface ProducePayload {
  kind:          'audio' | 'video';
  rtpParameters: object;
  appData?:      object;
}

export interface ConsumePayload {
  producerId:      string;
  rtpCapabilities: object;
}

export interface ResumeConsumerPayload {
  consumerId: string;
}

export interface SendMessagePayload {
  text: string;
}

export interface RaiseHandPayload {
  raised: boolean;
}

export interface ReactionPayload {
  emoji: string;
}

export interface MutePeerPayload {
  targetUserId: string;
}

export interface KickPeerPayload {
  targetUserId: string;
}

export interface UpdatePeerStatePayload {
  isMuted?:    boolean;
  isCameraOff?: boolean;
}

export interface StartPollPayload {
  question: string;
  options:  string[];
}

export interface PollResponsePayload {
  pollId:  string;
  answer:  string;
}

export interface SetPreferredLayersPayload {
  consumerId:     string;
  spatialLayer:   number;
  temporalLayer?: number;
}