/**
 * Attendance Worker
 *
 * Run as a separate process:
 *   npm run worker:attendance
 *
 * Consumes messages from the attendance.queue and writes
 * join / leave records to PostgreSQL via Prisma.
 */
import 'dotenv/config';
import * as amqp from 'amqplib';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const QUEUE  = 'attendance.queue';

interface JoinEvent {
  sessionId: string;
  userId:    string;
  orgId:     string;
  joinedAt:  string;
}

interface LeaveEvent {
  sessionId: string;
  userId:    string;
  orgId:     string;
  leftAt:    string;
}

type AttendanceEvent = JoinEvent | LeaveEvent;

async function handleEvent(event: AttendanceEvent): Promise<void> {
  if ('joinedAt' in event) {
    // ── Join event ──────────────────────────────────────────────────────────
    await prisma.sessionAttendance.create({
      data: {
        orgId:     event.orgId,
        sessionId: event.sessionId,
        userId:    event.userId,
        joinedAt:  new Date(event.joinedAt),
      },
    });
    console.log(
      `[Attendance] JOIN  session=${event.sessionId} user=${event.userId}`
    );
  } else {
    // ── Leave event ─────────────────────────────────────────────────────────
    const record = await prisma.sessionAttendance.findFirst({
      where: {
        sessionId: event.sessionId,
        userId:    event.userId,
        leftAt:    null,
      },
      orderBy: { joinedAt: 'desc' },
    });

    if (!record) {
      console.warn(
        `[Attendance] No open record for leave event — session=${event.sessionId} user=${event.userId}`
      );
      return;
    }

    const leftAt          = new Date(event.leftAt);
    const durationSeconds = Math.floor(
      (leftAt.getTime() - record.joinedAt.getTime()) / 1000
    );

    await prisma.sessionAttendance.update({
      where: { id: record.id },
      data:  { leftAt, durationSeconds },
    });

    console.log(
      `[Attendance] LEAVE session=${event.sessionId} user=${event.userId} duration=${durationSeconds}s`
    );
  }
}

async function start(): Promise<void> {
  // Retry connection on startup (RabbitMQ may still be booting)
  let conn: amqp.ChannelModel | null = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      conn = await amqp.connect(process.env.RABBITMQ_URL!);
      break;
    } catch {
      console.log(`[Attendance] RabbitMQ not ready — retry ${attempt}/10`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (!conn) {
    console.error('[Attendance] Could not connect to RabbitMQ after 10 attempts');
    process.exit(1);
  }

  const channel = await conn.createChannel();

  // Ensure queue exists (idempotent)
  await channel.assertQueue(QUEUE, { durable: true });

  // Process at most 10 messages concurrently
  channel.prefetch(10);

  console.log(`[Attendance Worker] Listening on queue: ${QUEUE}`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const event: AttendanceEvent = JSON.parse(msg.content.toString());
      await handleEvent(event);
      channel.ack(msg);
    } catch (err) {
      console.error('[Attendance] Error processing message', err);
      // Reject without requeue — goes to dead-letter queue if configured
      channel.nack(msg, false, false);
    }
  });

  conn.on('error', (err) => {
    console.error('[Attendance] RabbitMQ connection error', err.message);
  });

  conn.on('close', () => {
    console.warn('[Attendance] RabbitMQ connection closed — restarting in 5s');
    setTimeout(start, 5000);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Attendance] SIGTERM — shutting down');
    await channel.close();
    await conn!.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('[Attendance] Fatal startup error', err);
  process.exit(1);
});