# SkillForge Meet — Full Stack Video Conferencing

## Project Structure
```
skillforge-meet/
├── apps/
│   ├── backend/      Node.js + Express + Socket.IO + MediaSoup
│   └── frontend/     Next.js 14 App Router + Tailwind + Zustand
```

## Prerequisites
- Node.js >= 20
- Docker + Docker Compose
- FFmpeg (for recording — optional for basic testing)

---

## 1. Backend Setup

```bash
cd apps/backend

# Copy and configure environment
cp .env .env.local        # edit values as needed
# Key vars to set:
#   JWT_SECRET            → random 64-char string
#   TURN_SECRET           → random 32-char string
#   CLOUDINARY_*          → from cloudinary.com dashboard
#   MEDIASOUP_ANNOUNCED_IP → your machine's LAN/public IP

# Start infrastructure (Postgres, Redis, RabbitMQ, Coturn)
docker-compose up -d

# Wait ~10s for services to be healthy, then:
npm install
npx prisma db push        # creates all database tables
npm run dev               # starts backend on :4000

# In a second terminal — attendance worker
npm run worker:attendance
```

Verify backend is running:
```bash
curl http://localhost:4000/health
# → {"status":"ok","timestamp":"..."}
```

---

## 2. Frontend Setup

```bash
cd apps/frontend

# .env.local already has correct localhost values for dev
npm install
npm run dev               # starts frontend on :3000
```

---

## 3. First Run Walkthrough

### Register your organization
1. Open http://localhost:3000/register
2. Fill in Organization Name, Your Name, Email, Password
3. Click **Create organization**
4. **IMPORTANT**: Copy and save the Organization ID shown on the success screen

### Create a session
1. You land on the dashboard automatically
2. Click **New session** → enter a title → **Create**
3. Click **Start** on the session card

### Join from a second device/browser
1. Open an incognito window → http://localhost:3000/login
2. Enter the **same Organization ID** from step 1
3. Register a second user OR log in as the same user
4. Click **Join** on the same session

### Test all features
- **Mute/unmute**: Click mic button or press `D`
- **Camera on/off**: Click camera button or press `E`
- **Screen share**: Click share button
- **Raise hand**: Click hand button or press `H`
- **Chat**: Click message icon → type → Enter to send
- **Reactions**: Click smile icon → pick an emoji
- **Participants**: Click users icon → see participant list
- **Device settings**: Click gear icon → switch camera/mic

---

## 4. Architecture at a Glance

```
Browser (Next.js PWA)
  │
  ├─ HTTP REST ──────────────→ Express /api/v1
  │                               ├── /auth (register/login/refresh)
  │                               ├── /sessions (CRUD)
  │                               └── /turn/credentials
  │
  ├─ WebSocket ──────────────→ Socket.IO
  │                               ├── join-room / leave-room
  │                               ├── create-transport / connect-transport
  │                               ├── produce / consume / resume-consumer
  │                               ├── send-message / get-chat-history
  │                               ├── raise-hand / send-reaction
  │                               └── mute-peer / kick-peer
  │
  └─ RTP/UDP (WebRTC) ───────→ MediaSoup SFU
                                  (video/audio packets, SRTP encrypted)

Backend services:
  PostgreSQL ← Prisma ORM (sessions, users, chat, attendance)
  Redis      ← Socket.IO adapter (horizontal scaling)
  RabbitMQ   ← attendance.queue (join/leave events)
  Cloudinary ← recording storage (HLS)
  Coturn     ← STUN/TURN (NAT traversal)
```

---

## 5. Socket Events Reference

### Client → Server
| Event | Payload | Response |
|-------|---------|----------|
| `join-room` | `{ roomId }` | `{ rtpCapabilities, existingProducers, peers }` |
| `create-transport` | `{ direction }` | `{ id, iceParameters, iceCandidates, dtlsParameters }` |
| `connect-transport` | `{ transportId, dtlsParameters, direction }` | `{}` |
| `produce` | `{ kind, rtpParameters }` | `{ id }` |
| `consume` | `{ producerId, rtpCapabilities }` | `{ id, producerId, kind, rtpParameters }` |
| `resume-consumer` | `{ consumerId }` | `{}` |
| `pause-producer` | `{ producerId }` | `{}` |
| `resume-producer` | `{ producerId }` | `{}` |
| `send-message` | `{ text }` | `{ id }` |
| `get-chat-history` | — | `{ messages[] }` |
| `raise-hand` | `{ raised }` | — |
| `send-reaction` | `{ emoji }` | — |
| `update-peer-state` | `{ isMuted?, isCameraOff? }` | — |
| `mute-peer` | `{ targetUserId }` | — |
| `kick-peer` | `{ targetUserId }` | — |
| `start-poll` | `{ question, options[] }` | — |
| `poll-response` | `{ pollId, answer }` | — |
| `restart-ice` | `{ transportId, direction }` | `{ iceParameters }` |
| `leave-room` | — | — |

### Server → Client
| Event | Payload |
|-------|---------|
| `peer-joined` | `{ userId, name, role, socketId }` |
| `peer-left` | `{ userId, socketId }` |
| `new-producer` | `{ producerId, socketId, userId, kind }` |
| `new-message` | `{ id, userId, name, text, timestamp }` |
| `hand-raised` | `{ userId, name, raised }` |
| `peer-state-changed` | `{ userId, isMuted, isCameraOff }` |
| `force-mute` | `{ targetUserId }` |
| `force-kick` | `{ targetUserId }` |
| `reaction` | `{ userId, name, emoji }` |
| `poll-started` | `{ pollId, question, options[], createdBy }` |
| `poll-answer` | `{ pollId, userId, answer }` |
| `producer-score` | `{ producerId, score }` |
| `consumer-score` | `{ consumerId, score }` |
| `consumer-paused` | `{ consumerId }` |
| `consumer-resumed` | `{ consumerId }` |
| `consumer-closed` | `{ consumerId }` |

---

## 6. REST API Reference

```
POST /api/v1/auth/register          { orgName, name, email, password }
POST /api/v1/auth/login             { orgId, email, password }
POST /api/v1/auth/refresh           { token }
GET  /api/v1/auth/me

POST /api/v1/sessions               { title, description?, scheduledAt?, maxParticipants? }
GET  /api/v1/sessions
GET  /api/v1/sessions/:id
PUT  /api/v1/sessions/:id/end
GET  /api/v1/sessions/:id/attendance

GET  /api/v1/turn/credentials

GET  /health
```

---

## 7. Keyboard Shortcuts (in-room)

| Key | Action |
|-----|--------|
| `D` | Toggle microphone |
| `E` | Toggle camera |
| `H` | Toggle hand raise |

---

## 8. Production Deployment Checklist

- [ ] Set strong `JWT_SECRET` (64+ chars random)
- [ ] Set strong `TURN_SECRET` (32+ chars random)
- [ ] Set `MEDIASOUP_ANNOUNCED_IP` to your server's public IP
- [ ] Set `CLIENT_URL` to your frontend domain
- [ ] Configure Cloudinary credentials
- [ ] Set `TURN_SERVER_HOST` to your TURN server's public domain/IP
- [ ] Enable TLS (HTTPS + WSS) via Nginx reverse proxy
- [ ] Open firewall ports: 80, 443, 3478/UDP, 40000-49999/UDP
- [ ] Set `NODE_ENV=production` on backend