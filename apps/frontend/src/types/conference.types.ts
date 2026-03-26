// ── Participant ───────────────────────────────────────────────────────────────

export interface Peer {
  userId:       string;
  name:         string;
  role:         string;
  socketId:     string;
  isHandRaised: boolean;
  isMuted:      boolean;
  isCameraOff:  boolean;
  videoStream?: MediaStream;
  audioStream?: MediaStream;
  // Optional consumer IDs for remote media so clients can request resume/reconnect
  videoConsumerId?: string;
  audioConsumerId?: string;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id:        string;
  userId:    string;
  name:      string;
  text:      string;
  timestamp: string;
}

// ── Polls ────────────────────────────────────────────────────────────────────

export interface Poll {
  pollId:    string;
  question:  string;
  options:   string[];
  createdBy: string;
  answers:   Record<string, string>; // userId → answer
}

// ── TURN credentials ─────────────────────────────────────────────────────────

export interface TurnCredentials {
  username: string;
  password: string;
  ttl:      number;
  uris:     string[];
}

// ── Producer / Consumer metadata ─────────────────────────────────────────────

export interface RemoteProducer {
  producerId: string;
  userId:     string;
  kind:       'audio' | 'video';
  socketId:   string;
}

// ── Conference store shape ────────────────────────────────────────────────────

export interface ConferenceState {
  roomId:           string | null;
  peers:            Map<string, Peer>;
  localStream:      MediaStream | null;   // camera / screen-share video + audio
  isMicOn:          boolean;
  isCameraOn:       boolean;
  localVideoLive:   boolean;
  isScreenSharing:  boolean;
  isHandRaised:     boolean;
  messages:         ChatMessage[];
  activePoll:       Poll | null;
  isConnected:      boolean;
  isJoined:         boolean;
  error:            string | null;
}

// ── UI store shape ────────────────────────────────────────────────────────────

export interface UIState {
  showChat:         boolean;
  showParticipants: boolean;
  showDeviceSelector: boolean;
  chatUnreadCount:  number;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface User {
  id:     string;
  name:   string;
  email:  string;
  role:   string;
  orgId:  string;
  avatar?: string;
}

export interface Session {
  id:             string;
  orgId?:         string;
  title:          string;
  description?:   string;
  status:         'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  scheduledAt?:   string;
  startedAt?:     string;
  endedAt?:       string;
  recordingUrl?:  string;
  maxParticipants: number;
  coachId:        string;
  coach:          { name: string; avatar?: string };
  createdAt:      string;
}