This is a large design. I'll build this as a layered explanation with diagrams at each critical section. Let me start with the architecture overview, then drill into each subsystem.

---

## 1. Requirements

**Functional:**
- Host/join meetings with audio, video, screen share
- Live text chat, hand raise, reactions, polls
- Breakout rooms, whiteboard
- Auto-recording → stored in Cloudinary as HLS
- Attendance auto-tracking (join/leave timestamps → PostgreSQL)
- Waiting room, mute/kick controls for coach

**Non-functional:**
- Latency: < 150ms one-way media (p95), < 1s signaling round-trip
- Scalability: 200 concurrent participants per room, 1000s of concurrent rooms
- Fault tolerance: media server crash → reconnect within 5s, zero data loss
- Bandwidth: adaptive bitrate 400kbps–5Mbps per stream
- Security: DTLS-SRTP for all media, JWT auth for every WebSocket connection
- Constraints: Cloudinary for recording storage, PostgreSQL for all session/attendance data

---

## 2. Architecture — SFU over MCU

**Why SFU (Selective Forwarding Unit) and not MCU:**

An MCU (Multipoint Control Unit) decodes every stream, mixes them into one, and sends each participant a single mixed stream. The mixing requires enormous CPU — a 20-person call means the server is doing 20 decode + 1 mix + 20 re-encode operations continuously. The latency from decode-mix-encode adds 200-500ms.

An SFU receives encoded streams from each sender and *forwards* selected streams to each receiver without decoding. The server never touches the media content — it just routes RTP packets. CPU cost is nearly zero per stream. Latency stays at network RTT only.

For an LMS with up to 200 participants in webinar mode (one coach broadcasting, learners mostly receiving), SFU is the only viable choice.---

## 3. Real-Time Communication Flow — Step by Step

This is the most important section to understand deeply. Here is exactly what happens from click to first frame of video.Now let me explain every step in implementation detail.

**Step 1 — WebSocket connection + JWT authentication:**
```js
// Client
const socket = io('wss://signal.skillforge.app', {
  auth: { token: localStorage.getItem('accessToken') }
});

// Server (Socket.IO middleware)
io.use(async (socket, next) => {
  const { token } = socket.handshake.auth;
  const payload = verifyJWT(token); // throws if invalid/expired
  socket.data.userId = payload.userId;
  socket.data.orgId  = payload.orgId;
  socket.data.role   = payload.role;
  next();
});
```
The JWT contains `orgId` — the same token used for all SkillForge API calls. No separate auth system.

**Step 2 — Join room, create MediaSoup Router:**
```js
socket.on('join-room', async ({ roomId }) => {
  // Validate user has access to this session (PostgreSQL check)
  const session = await db.liveSession.findFirst({
    where: { id: roomId, org_id: socket.data.orgId }
  });
  if (!session) return socket.emit('error', 'Unauthorized');

  // Get or create MediaSoup router for this room
  let router = roomRouters.get(roomId);
  if (!router) {
    const worker = getLeastLoadedWorker(); // round-robin
    router = await worker.createRouter({ mediaCodecs });
    roomRouters.set(roomId, router);
  }

  socket.join(roomId); // Socket.IO room for broadcasting
  socket.emit('router-rtp-capabilities', router.rtpCapabilities);
});
```

**Step 3 — RTP Capabilities exchange:**
The `rtpCapabilities` tell the client exactly what codecs the SFU supports (VP8, VP9, H.264, Opus). The client then tells the SFU its own capabilities. MediaSoup internally computes the intersection — the best common codec set.

**Steps 4-5 — Transport creation and DTLS handshake (the security layer):**

This is where DTLS-SRTP is established. DTLS is TLS for UDP — it runs the full certificate exchange over the same UDP port that media will flow on. Once the DTLS handshake completes, both sides have derived SRTP keys. All subsequent RTP packets are encrypted with AES-128-GCM.

```js
// Client sends createTransport request
socket.emit('create-transport', { direction: 'send' }, async (params) => {
  // params = { id, iceParameters, iceCandidates, dtlsParameters }
  const transport = await device.createSendTransport(params);

  transport.on('connect', ({ dtlsParameters }, callback) => {
    // Client sends its DTLS fingerprint to server
    socket.emit('connect-transport', { transportId: transport.id, dtlsParameters });
    callback();
  });
});

// Server
socket.on('create-transport', async ({ direction }, callback) => {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.SFU_PUBLIC_IP }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  });
  callback({
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  });
});
```

**Steps 6-7 — ICE and NAT traversal:**

ICE (Interactive Connectivity Establishment) is the process of finding the best network path between client and SFU. The client gathers *candidates* — possible network addresses:
- `host` candidate: the device's LAN IP (192.168.x.x)
- `srflx` (server-reflexive): the public IP learned from STUN
- `relay` candidate: a TURN server relay address (fallback for symmetric NAT)

```
Client: STUN Binding Request → Coturn STUN server (UDP 3478)
Coturn: response = { mapped: "203.0.113.45:54321" }  ← client's public IP:port
Client: sends this srflx candidate via signaling to SFU
SFU: tries to reach client at all candidates (host + srflx + relay)
ICE: connectivity checks with STUN binding requests on each candidate pair
ICE: best working pair selected → ICE "completed" state
```

**When TURN relay is needed:** Corporate firewalls and symmetric NAT block direct UDP. The client connects to Coturn's TURN allocation endpoint, gets a relayed address, and all media flows *through* Coturn. This adds 10-50ms latency but enables connectivity behind even the strictest firewalls.

```
TURN allocation:
Client → TURN server: Allocate request (TURN credentials: HMAC-SHA1, time-limited)
TURN → Client: 200 OK + relayedAddress = "203.0.113.100:50001"
Client sends this relay candidate via signaling
SFU sends media to relay → TURN forwards to client's NAT-mapped address
```

**Steps 8-9 — Producer/Consumer model (MediaSoup core):**

```js
// Client: start sending video
transport.on('produce', async ({ kind, rtpParameters }, callback) => {
  const { producerId } = await socket.emit('produce', { kind, rtpParameters });
  callback({ id: producerId });
});

const producer = await transport.produce({ track: videoTrack });

// Server: when a new producer is created, notify all consumers
socket.on('produce', async ({ kind, rtpParameters }, callback) => {
  const producer = await sendTransport.produce({ kind, rtpParameters });
  
  // Store producer
  producers.set(producer.id, { producer, socketId: socket.id, roomId });

  // Notify all other participants in the room
  socket.to(roomId).emit('new-producer', { 
    producerId: producer.id, 
    userId: socket.data.userId 
  });
  callback({ id: producer.id });
});

// When a learner receives 'new-producer', they create a consumer:
socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
  if (!router.canConsume({ producerId, rtpCapabilities })) return;
  
  const consumer = await recvTransport.consume({
    producerId,
    rtpCapabilities,
    paused: true, // start paused, resume after transport connected
  });
  
  callback({
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  });
});
```

The SFU never decodes `rtpParameters`. It just reads the SSRC and payload type headers to know which packets belong to which producer, then forwards those packets to all consumers that requested that producer's stream.

---

## 4. Technology Stack Deep Dive

### WebRTC Internals

WebRTC operates on three layers:

**Media capture and encoding:**
```js
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720, frameRate: 30 },
  audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 }
});
// Internally: OS → camera driver → YUV frames → libvpx (VP8/VP9) or openH264
// Audio: PCM samples → Opus encoder (48kHz, 20ms frames, ~32-128kbps)
```

**Bandwidth adaptation (TWCC — Transport-Wide Congestion Control):**
The SFU sends RTCP feedback (Transport-Wide Congestion Control reports) to each sender every 100ms. The sender's GCC (Google Congestion Control) algorithm adjusts the encoder bitrate based on packet loss and inter-packet delay. This is why video quality drops gracefully on a slow network instead of freezing.

**PeerConnection lifecycle:**
```
new RTCPeerConnection() → ICE gathering → DTLS negotiation → 
media flowing → (on renegotiate) → new offer/answer → updated streams
```

### Socket.IO Signaling Server Design

The signaling server does NOT handle media — it only handles control messages. Message types:

```js
// Namespace: /conference
// Events (client → server):
'join-room'         // { roomId, rtpCapabilities }
'create-transport'  // { direction: 'send'|'recv' }
'connect-transport' // { transportId, dtlsParameters }
'produce'           // { kind, rtpParameters, appData }
'consume'           // { producerId, rtpCapabilities }
'resume-consumer'   // { consumerId }
'pause-producer'    // { producerId }
'chat-message'      // { text, timestamp }
'raise-hand'        // {}
'poll-response'     // { pollId, answer }

// Events (server → client):
'router-rtp-capabilities' // { codecs, headerExtensions }
'transport-created'       // { id, iceParameters, iceCandidates, dtlsParameters }
'new-producer'            // { producerId, userId, kind }
'consumer-created'        // { consumerId, producerId, kind, rtpParameters }
'participant-joined'      // { userId, name, role }
'participant-left'        // { userId }
'chat-message'            // { userId, text, timestamp }
'producer-score'          // { producerId, score } (quality feedback)
```

**Scaling signaling with Redis Pub/Sub:**
When you run multiple signaling server instances behind a load balancer, a socket on server-1 cannot emit to a socket on server-2 directly. Socket.IO's Redis adapter solves this:

```js
import { createAdapter } from '@socket.io/redis-adapter';
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

// Now io.to(roomId).emit('...') works across ALL server instances
// Redis pub/sub broadcasts the message to all nodes
```

### MediaSoup — Deep Internals

MediaSoup's architecture:

```
Node.js process (your app) 
  ↕ IPC (Unix pipe, protobuf)
MediaSoup Worker (C++ process, one per CPU core)
  └─ Router (one per room)
       ├─ WebRtcTransport (one per participant direction)
       │    └─ Producer (one per media track being sent)
       └─ WebRtcTransport (recv side)
            └─ Consumer (one per remote producer being received)
```

The C++ worker runs in a tight event loop processing RTP packets. The Node.js process communicates via IPC to control it. This is why MediaSoup scales well — the heavy packet forwarding is in C++, not in your JavaScript event loop.

**Worker management:**
```js
const numWorkers = os.cpus().length; // one per core
const workers = [];

for (let i = 0; i < numWorkers; i++) {
  const worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn',
  });
  worker.on('died', () => replaceWorker(i)); // auto-restart
  workers.push({ worker, load: 0 });
}

function getLeastLoadedWorker() {
  return workers.sort((a, b) => a.load - b.load)[0].worker;
}
```

**Simulcast:** Producers can send 3 spatial layers (low/medium/high resolution) simultaneously. The SFU forwards only the layer appropriate for each consumer's bandwidth:
```js
const producer = await transport.produce({
  track: videoTrack,
  encodings: [
    { rid: 'r0', maxBitrate: 100_000 },  // 240p
    { rid: 'r1', maxBitrate: 500_000 },  // 480p
    { rid: 'r2', maxBitrate: 1_500_000 } // 720p
  ],
  codecOptions: { videoGoogleStartBitrate: 1000 }
});
```

### RabbitMQ — Why and How

HTTP requests are synchronous (client waits for response). Many conference events should NOT block the request. Examples: recording started, attendance logged, session ended → generate certificate. These go on a queue.

```
Exchange: session.events (topic type)
Routing keys:
  session.started          → consumers: attendance-service, notification-service
  session.ended            → consumers: recording-processor, analytics-service
  session.participant.joined  → consumers: attendance-service
  session.participant.left    → consumers: attendance-service
  session.recording.ready  → consumers: cloudinary-uploader, notification-service
```

```js
// Signaling server publishes event
channel.publish('session.events', 'session.participant.joined', Buffer.from(JSON.stringify({
  sessionId: roomId,
  userId: socket.data.userId,
  orgId: socket.data.orgId,
  joinedAt: new Date().toISOString(),
})));

// Attendance service consumes
channel.consume('attendance.queue', async (msg) => {
  const { sessionId, userId, orgId, joinedAt } = JSON.parse(msg.content);
  await db.$executeRaw`SET LOCAL app.org_id = ${orgId}`;
  await db.sessionAttendance.create({
    data: { session_id: sessionId, user_id: userId, joined_at: joinedAt }
  });
  channel.ack(msg);
});
```

---

## 5. Backend Design

**Microservices structure for the conference system:**

```
conference-api/
├── signaling-service/     # Socket.IO, WebRTC orchestration
├── session-service/       # REST: CRUD for sessions, schedules
├── attendance-service/    # Consumes RabbitMQ events, writes PostgreSQL
├── recording-service/     # FFmpeg + Cloudinary upload
└── notification-service/  # SSE + push + email triggers
```

**Session management in PostgreSQL:**
```sql
CREATE TABLE live_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id),
  course_id   UUID REFERENCES courses(id),
  coach_id    UUID NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  recording_url TEXT,          -- Cloudinary HLS URL after processing
  room_state   JSONB,          -- current participants, hand-raises (ephemeral)
  status       TEXT DEFAULT 'scheduled'
);

ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON live_sessions USING (org_id = current_setting('app.org_id')::uuid);

CREATE TABLE session_attendance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  session_id  UUID REFERENCES live_sessions(id),
  user_id     UUID REFERENCES users(id),
  joined_at   TIMESTAMPTZ NOT NULL,
  left_at     TIMESTAMPTZ,
  duration_seconds INT GENERATED ALWAYS AS 
    (EXTRACT(EPOCH FROM (left_at - joined_at))::INT) STORED
);
ALTER TABLE session_attendance ENABLE ROW LEVEL SECURITY;
```

---

## 6. Scaling Strategy**Room affinity — the critical constraint:**
All participants in the same room *must* connect to the same SFU node, because the Router (and its Producers/Consumers) live on that node. When a user joins room `room-abc`, the load balancer must always route them to the same SFU node. Use consistent hashing on `roomId`:

```js
// Nginx upstream with consistent hashing
upstream sfu_backends {
  hash $arg_roomId consistent;  // sticky routing by roomId query param
  server sfu-1.internal:40000;
  server sfu-2.internal:40000;
  server sfu-3.internal:40000;
}
```

For large webinars (200+ participants), a single SFU node may not be enough. MediaSoup supports *cascaded SFUs* — multiple SFU nodes where one acts as a hub, piping streams between nodes using `PipeTransport`. This is advanced but necessary at scale.

---

## 7. Detailed Data Flow — Full Sequence

```
T+0ms    User clicks "Join Session" button
T+0ms    Client fetches session details from REST API (GET /api/sessions/:id)
T+10ms   API validates JWT, queries PostgreSQL (sessions table, RLS applied)
T+25ms   Client receives session data (room token, TURN credentials)
T+25ms   TURN credentials generated: HMAC-SHA1(secret, expiry:userId)
T+30ms   Client opens WebSocket to wss://signal.skillforge.app?roomId=xyz
T+35ms   Socket.IO middleware: JWT verified, orgId/userId attached to socket
T+40ms   Client emits 'join-room' {roomId, name}
T+41ms   Server: PostgreSQL check → user enrolled in this session? (RLS)
T+45ms   Server: getLeastLoadedWorker() → Worker #2 (8 rooms)
T+46ms   Server: router = await worker.createRouter() [if room is new]
T+50ms   Server → Client: 'router-rtp-capabilities' {codecs: [VP8, VP9, H264, Opus]}
T+55ms   Client: device.load(rtpCapabilities) [MediaSoup Device]
T+60ms   Client emits 'create-transport' {direction: 'send'}
T+62ms   Server: transport = await router.createWebRtcTransport(...)
T+65ms   Server → Client: {id, iceParameters, iceCandidates, dtlsParameters}
T+70ms   Client: sendTransport = device.createSendTransport(params)
T+75ms   Client starts ICE gathering (STUN request to coturn:3478)
T+85ms   Coturn responds: srflx candidate 203.0.113.45:54321
T+90ms   Client emits 'connect-transport' {dtlsParameters} [its fingerprint]
T+91ms   Server: await sendTransport.connect({dtlsParameters})
T+95ms   DTLS handshake over UDP (4 round trips)
T+110ms  DTLS complete → SRTP keys derived → transport is CONNECTED
T+115ms  client.transport.emit('connect') fires → callback invoked
T+120ms  Client: getUserMedia() → video track ready
T+125ms  transport.emit('produce') fires
T+130ms  Client emits 'produce' {kind:'video', rtpParameters}
T+132ms  Server: producer = await transport.produce({rtpParameters})
T+135ms  Server: publishes to RabbitMQ 'session.participant.joined'
T+136ms  Server: io.to(roomId).emit('new-producer', {producerId, userId})
T+140ms  All other participants receive 'new-producer'
T+145ms  Each participant emits 'consume' {producerId, rtpCapabilities}
T+150ms  Server creates Consumer objects for each requesting participant
T+155ms  Clients create recv transports (same flow as send, ~40ms)
T+200ms  RTP video packets start flowing SFU → learner browsers
T+210ms  First video frame decoded and rendered 🎉

T+ongoing: Attendance service consumes RabbitMQ message, writes to PostgreSQL
T+ongoing: RTCP feedback loop adjusting bitrate every 100ms
T+ongoing: Recording service starts consuming from MediaSoup PlainTransport
```

---

## 8. Failure Handling

**SFU node crashes:**
```js
worker.on('died', async (error) => {
  logger.error('MediaSoup worker died', error);
  
  // All rooms on this worker are now dead
  const affectedRooms = getWorkerRooms(worker.pid);
  
  for (const roomId of affectedRooms) {
    // Notify all participants
    io.to(roomId).emit('media-server-error', { 
      message: 'Reconnecting, please wait…' 
    });
  }
  
  // Spin up replacement worker
  const newWorker = await mediasoup.createWorker(workerSettings);
  replaceWorker(worker.pid, newWorker);
  
  // Clients handle 'media-server-error' by reconnecting after 2s
  // They will land on a new SFU node (room state rebuilt from scratch)
});
```

**Client-side reconnect strategy:**
```js
socket.on('disconnect', (reason) => {
  if (reason === 'transport close' || reason === 'ping timeout') {
    // Exponential backoff reconnect
    let attempt = 0;
    const reconnect = async () => {
      await delay(Math.min(1000 * 2 ** attempt, 30000));
      attempt++;
      try {
        await rejoinRoom(); // full re-join flow
      } catch (e) {
        reconnect();
      }
    };
    reconnect();
  }
});

// MediaSoup transport disconnect
transport.on('connectionstatechange', (state) => {
  if (state === 'disconnected' || state === 'failed') {
    // ICE restart
    transport.restartIce().then(iceParameters => {
      socket.emit('restart-ice', { transportId: transport.id, iceParameters });
    });
  }
});
```

**Network degradation (poor bandwidth):**
MediaSoup tracks each consumer's `score` — a 0-10 quality indicator based on packet loss and jitter. When score drops below 6, downgrade the simulcast layer:
```js
consumer.on('score', (score) => {
  if (score.score < 6) {
    consumer.setPreferredLayers({ spatialLayer: 0 }); // drop to lowest quality
  } else if (score.score > 8) {
    consumer.setPreferredLayers({ spatialLayer: 2 }); // restore to high quality
  }
});
```

---

## 9. Recording → Cloudinary Pipeline

Recording is the most complex pipeline because you need to capture server-side (not client-side), transcode to HLS, and store in Cloudinary.

```js
// 1. Create a PlainTransport — a server-to-server RTP channel
const recordingTransport = await router.createPlainTransport({
  listenIp: '127.0.0.1',
  rtcpMux: false,
});

// 2. Pipe coach's producer into the recording transport
const recordingConsumer = await recordingTransport.consume({
  producerId: coachProducer.id,
  rtpCapabilities: router.rtpCapabilities,
  paused: false,
});

// 3. Spawn FFmpeg to receive RTP and transcode to HLS
const ffmpeg = spawn('ffmpeg', [
  '-protocol_whitelist', 'pipe,rtp,udp',
  '-i', sdpContent,           // SDP describing the RTP stream
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-c:a', 'aac',
  '-f', 'hls',
  '-hls_time', '4',
  '-hls_list_size', '0',
  '-hls_segment_filename', `/tmp/${sessionId}_%03d.ts`,
  `/tmp/${sessionId}.m3u8`
]);

// 4. On session end, upload to Cloudinary
const result = await cloudinary.uploader.upload(
  `/tmp/${sessionId}.m3u8`,
  {
    resource_type: 'video',
    public_id: `recordings/${orgId}/${sessionId}`,
    eager: [{ streaming_profile: 'hd', format: 'm3u8' }],
  }
);

// 5. Save Cloudinary URL to PostgreSQL
await db.liveSession.update({
  where: { id: sessionId },
  data: { recording_url: result.secure_url, status: 'completed' }
});

// 6. Notify via RabbitMQ
channel.publish('session.events', 'session.recording.ready', Buffer.from(JSON.stringify({
  sessionId, orgId, recordingUrl: result.secure_url
})));
```

---

## 10. Security

**DTLS-SRTP:** Every media packet is encrypted. The DTLS handshake (like TLS but over UDP) creates the SRTP session keys. A packet captured in transit is AES-128-GCM encrypted and useless without the session key.

**TURN credential security:** TURN credentials use HMAC-SHA1 time-based tokens. The shared secret never leaves the server. A credential `user=1735689600:userId, password=base64(HMAC-SHA1(secret, user))` is only valid until the expiry timestamp (typically 1 hour):
```js
function generateTurnCredentials(userId) {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const username = `${expiry}:${userId}`;
  const password = crypto.createHmac('sha1', process.env.TURN_SECRET)
    .update(username).digest('base64');
  return { username, password, ttl: 3600 };
}
```

**Room authorization:** Every Socket.IO event that touches a room verifies:
1. JWT is valid and not expired (15-min access tokens)
2. The user's `orgId` matches the session's `org_id` (PostgreSQL + RLS)
3. The user is enrolled in the course or is the assigned coach

```js
async function authorizeRoom(socket, roomId) {
  const { orgId, userId, role } = socket.data;
  await db.$executeRaw`SET LOCAL app.org_id = ${orgId}`;
  const session = await db.liveSession.findFirst({
    where: { id: roomId }  // RLS ensures org_id match automatically
  });
  if (!session) throw new Error('Not found');
  if (role === 'staff') {
    const enrolled = await db.enrollment.findFirst({
      where: { user_id: userId, course_id: session.course_id }
    });
    if (!enrolled) throw new Error('Not enrolled');
  }
  return session;
}
```

---

## 11. Deployment Architecture

```
Kubernetes cluster (Railway / AWS EKS):

Deployments:
  signaling-service   → 2-10 replicas (HPA: CPU > 60%)
  session-api         → 2-4 replicas
  attendance-service  → 2 replicas (RabbitMQ consumer)
  recording-service   → 1-3 replicas (CPU-heavy, FFmpeg)

StatefulSets:
  mediasoup-sfus      → 2-6 nodes (DaemonSet: one per high-CPU node)
                        hostNetwork: true (required for UDP port range access)

Services:
  nginx-ingress       → WebSocket upgrade for signaling (ws://)
  UDP NodePort        → 40000-49999 for MediaSoup RTP
  ClusterIP           → internal service mesh

ConfigMaps / Secrets:
  TURN_SECRET, CLOUDINARY_API_KEY, POSTGRES_URL, REDIS_URL, RABBITMQ_URL

PersistentVolumes:
  Recording temp storage: 50GB per SFU node (EBS gp3)
```

**Critical Kubernetes note for MediaSoup:** MediaSoup workers bind to a port range (40000-49999) for RTP. With Kubernetes' overlay network (CNI), UDP packets lose their source IP during SNAT, breaking ICE. The SFU pods must use `hostNetwork: true` so they bind directly to the node's real IP. The `announcedIp` in `createWebRtcTransport` must be the node's public IP:

```yaml
# mediasoup-sfu DaemonSet
spec:
  template:
    spec:
      hostNetwork: true
      containers:
      - name: mediasoup
        env:
        - name: SFU_PUBLIC_IP
          valueFrom:
            fieldRef:
              fieldPath: status.hostIP  # node's public IP
```

---

## 12. Code-Level Structure

**Complete signaling server skeleton:**
```js
// signaling-service/src/index.ts
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import * as mediasoup from 'mediasoup';
import { verifyJWT } from './auth';
import { authorizeRoom } from './authorization';
import { RoomManager } from './rooms';

const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL } });
io.adapter(createAdapter(pubClient, subClient));

const roomManager = new RoomManager();

io.use((socket, next) => {
  try {
    socket.data = verifyJWT(socket.handshake.auth.token);
    next();
  } catch { next(new Error('Unauthorized')); }
});

io.on('connection', (socket) => {
  
  socket.on('join-room', async ({ roomId }, cb) => {
    const session = await authorizeRoom(socket, roomId);
    const router = await roomManager.getOrCreateRouter(roomId);
    socket.join(roomId);
    
    // Notify others
    socket.to(roomId).emit('participant-joined', {
      userId: socket.data.userId, name: socket.data.name
    });
    
    // Send existing producers to new participant
    const existingProducers = roomManager.getProducers(roomId);
    cb({ rtpCapabilities: router.rtpCapabilities, existingProducers });
  });

  socket.on('create-transport', async ({ direction }, cb) => {
    const router = roomManager.getRouter(/* roomId from socket */);
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.SFU_PUBLIC_IP }],
      enableUdp: true, enableTcp: true, preferUdp: true,
      initialAvailableOutgoingBitrate: 800_000,
    });
    roomManager.addTransport(socket.id, direction, transport);
    cb({
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  });

  socket.on('connect-transport', async ({ transportId, dtlsParameters }) => {
    const transport = roomManager.getTransport(socket.id, transportId);
    await transport.connect({ dtlsParameters });
  });

  socket.on('produce', async ({ kind, rtpParameters, appData }, cb) => {
    const transport = roomManager.getSendTransport(socket.id);
    const producer = await transport.produce({ kind, rtpParameters, appData });
    roomManager.addProducer(socket.id, producer);
    
    // Notify all other participants
    socket.to(socket.data.roomId).emit('new-producer', {
      producerId: producer.id,
      userId: socket.data.userId,
      kind
    });
    
    // Publish attendance event
    rabbitmq.publish('session.events', 'session.participant.joined', {
      sessionId: socket.data.roomId,
      userId: socket.data.userId,
      orgId: socket.data.orgId,
      joinedAt: new Date().toISOString()
    });
    
    cb({ id: producer.id });
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, cb) => {
    const router = roomManager.getRouter(socket.data.roomId);
    if (!router.canConsume({ producerId, rtpCapabilities })) return cb({ error: 'Cannot consume' });
    
    const transport = roomManager.getRecvTransport(socket.id);
    const consumer = await transport.consume({
      producerId, rtpCapabilities, paused: true
    });
    
    consumer.on('score', (score) => {
      if (score.score < 6) consumer.setPreferredLayers({ spatialLayer: 0 });
    });
    
    cb({
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  });

  socket.on('resume-consumer', async ({ consumerId }) => {
    const consumer = roomManager.getConsumer(socket.id, consumerId);
    await consumer.resume();
  });

  socket.on('chat-message', async ({ text }) => {
    const message = { 
      userId: socket.data.userId, 
      name: socket.data.name, 
      text, 
      timestamp: new Date().toISOString() 
    };
    io.to(socket.data.roomId).emit('chat-message', message);
    // Persist to PostgreSQL
    await db.sessionChat.create({ data: { session_id: socket.data.roomId, ...message } });
  });

  socket.on('disconnect', async () => {
    roomManager.cleanup(socket.id);
    socket.to(socket.data.roomId).emit('participant-left', { userId: socket.data.userId });
    rabbitmq.publish('session.events', 'session.participant.left', {
      sessionId: socket.data.roomId,
      userId: socket.data.userId,
      orgId: socket.data.orgId,
      leftAt: new Date().toISOString()
    });
  });
});
```

**Client-side WebRTC setup:**
```js
// conference-client/src/useConference.ts
import * as mediasoupClient from 'mediasoup-client';

export function useConference(roomId: string) {
  const device = new mediasoupClient.Device();
  let sendTransport, recvTransport;

  async function join() {
    // 1. Connect WebSocket
    socket.emit('join-room', { roomId }, async ({ rtpCapabilities, existingProducers }) => {
      
      // 2. Load device with router capabilities
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      
      // 3. Create send transport
      socket.emit('create-transport', { direction: 'send' }, async (params) => {
        sendTransport = device.createSendTransport(params);
        
        sendTransport.on('connect', ({ dtlsParameters }, cb) => {
          socket.emit('connect-transport', { transportId: sendTransport.id, dtlsParameters });
          cb();
        });
        sendTransport.on('produce', ({ kind, rtpParameters }, cb) => {
          socket.emit('produce', { kind, rtpParameters }, ({ id }) => cb({ id }));
        });
        
        // 4. Get camera/mic and produce
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const videoProducer = await sendTransport.produce({ 
          track: stream.getVideoTracks()[0],
          encodings: [
            { rid: 'r0', maxBitrate: 100_000, scalabilityMode: 'S1T3' },
            { rid: 'r1', maxBitrate: 500_000, scalabilityMode: 'S1T3' },
            { rid: 'r2', maxBitrate: 1_500_000, scalabilityMode: 'S1T3' },
          ]
        });
      });
      
      // 5. Create recv transport and consume existing producers
      socket.emit('create-transport', { direction: 'recv' }, async (params) => {
        recvTransport = device.createRecvTransport(params);
        recvTransport.on('connect', ({ dtlsParameters }, cb) => {
          socket.emit('connect-transport', { transportId: recvTransport.id, dtlsParameters });
          cb();
        });
        
        for (const { producerId, userId, kind } of existingProducers) {
          await consumeProducer(producerId, userId, kind);
        }
      });
    });
  }

  // Handle new producers joining after us
  socket.on('new-producer', ({ producerId, userId, kind }) => {
    consumeProducer(producerId, userId, kind);
  });

  async function consumeProducer(producerId, userId, kind) {
    socket.emit('consume', { producerId, rtpCapabilities: device.rtpCapabilities }, async (params) => {
      const consumer = await recvTransport.consume(params);
      socket.emit('resume-consumer', { consumerId: consumer.id });
      // Attach consumer.track to a <video> or <audio> element in the UI
      addParticipantStream(userId, consumer.track, kind);
    });
  }
}
```

---

## Observability

Three pillars for production:

**Metrics (Prometheus):** Instrument every MediaSoup worker with gauges: `mediasoup_active_rooms`, `mediasoup_producers_total`, `mediasoup_consumers_total`, `mediasoup_transport_bitrate_sent`, `mediasoup_worker_cpu_percent`. Alert when any worker's CPU > 80% or when router creation fails.

**Distributed tracing (OpenTelemetry → Jaeger):** Every `join-room` request gets a `traceId` that flows through signaling → MediaSoup RPC → RabbitMQ → attendance service. You can see end-to-end latency for the full join flow.

**Logging (Winston → Loki → Grafana):** Structured JSON logs with `{roomId, userId, orgId, event, duration_ms}`. Query `event=join-room | avg(duration_ms)` to track join latency by percentile.

---

This gives you a complete, production-grade blueprint for SkillForge Meet. The hardest implementation challenges in order: (1) `hostNetwork` Kubernetes configuration for MediaSoup UDP, (2) simulcast layer selection under varying network conditions, (3) cascaded SFUs for 200+ participant rooms, and (4) reliable recording via FFmpeg without dropping packets under load. Start with a single-server MediaSoup setup, validate the full flow end-to-end, then introduce the cluster layer once the room lifecycle is solid.