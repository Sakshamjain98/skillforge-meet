import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  PlainTransport,
} from 'mediasoup/node/lib/types';

export interface WorkerEntry {
  worker: Worker;
  load:   number;
}

export interface PeerState {
  socketId:       string;
  userId:         string;
  orgId:          string;
  name:           string;
  role:           string;
  roomId:         string;
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producers:      Map<string, Producer>;
  consumers:      Map<string, Consumer>;
  isHandRaised:   boolean;
  isMuted:        boolean;
  isCameraOff:    boolean;
}

export interface RoomState {
  id:                  string;
  orgId:               string;
  router:              Router;
  workerPid:           number;
  peers:               Map<string, PeerState>;
  recordingTransport?: PlainTransport;
  isRecording:         boolean;
  createdAt:           Date;
}

export interface ProducerInfo {
  producerId: string;
  userId:     string;
  kind:       string;
  socketId:   string;
}

export type TransportDirection = 'send' | 'recv';