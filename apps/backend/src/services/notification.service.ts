import { logger } from '../utils/logger';

/**
 * Notification service — extensible shell.
 *
 * Currently logs every notification so you can verify the event
 * pipeline end-to-end without external email/SMS credentials.
 *
 * To wire real channels:
 *   Email  → install nodemailer, configure SMTP, call sendEmail()
 *   SMS    → install twilio, call sendSms()
 *   Push   → install web-push, store subscriptions in DB, call sendPush()
 */

export type NotificationChannel = 'in-app' | 'email' | 'sms' | 'push';

export interface NotificationPayload {
  userId?:     string;
  orgId?:      string;
  title:       string;
  body:        string;
  channels:    NotificationChannel[];
  metadata?:   Record<string, unknown>;
}

export async function sendNotification(
  payload: NotificationPayload
): Promise<void> {
  logger.info('Notification dispatched', {
    title:    payload.title,
    channels: payload.channels,
    userId:   payload.userId,
    orgId:    payload.orgId,
  });

  // ── Email channel ────────────────────────────────────────────────────────
  if (payload.channels.includes('email')) {
    await sendEmail(payload).catch((err) =>
      logger.error('Email send failed', { error: String(err) })
    );
  }

  // ── SMS channel ──────────────────────────────────────────────────────────
  if (payload.channels.includes('sms')) {
    await sendSms(payload).catch((err) =>
      logger.error('SMS send failed', { error: String(err) })
    );
  }
}

// ── Stubs — replace with real implementations ───────────────────────────────

async function sendEmail(payload: NotificationPayload): Promise<void> {
  // Example with nodemailer:
  // const transporter = nodemailer.createTransport({ ... });
  // await transporter.sendMail({ to: userEmail, subject: payload.title, text: payload.body });
  logger.debug('[Email stub]', { title: payload.title, userId: payload.userId });
}

async function sendSms(payload: NotificationPayload): Promise<void> {
  // Example with Twilio:
  // const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  // await client.messages.create({ to: userPhone, from: process.env.TWILIO_FROM, body: payload.body });
  logger.debug('[SMS stub]', { title: payload.title, userId: payload.userId });
}

// ── Convenience helpers ─────────────────────────────────────────────────────

export async function notifySessionStarted(
  orgId: string,
  sessionTitle: string
): Promise<void> {
  await sendNotification({
    orgId,
    title:    `Session starting: ${sessionTitle}`,
    body:     'Your live session is now starting. Join now!',
    channels: ['in-app', 'email'],
  });
}

export async function notifyRecordingReady(
  orgId: string,
  sessionTitle: string,
  recordingUrl: string
): Promise<void> {
  await sendNotification({
    orgId,
    title:    `Recording ready: ${sessionTitle}`,
    body:     `The recording of "${sessionTitle}" is now available.`,
    channels: ['in-app', 'email'],
    metadata: { recordingUrl },
  });
}

export async function notifyParticipantJoined(
  orgId: string,
  userName: string,
  sessionTitle: string
): Promise<void> {
  await sendNotification({
    orgId,
    title:    `${userName} joined`,
    body:     `${userName} joined "${sessionTitle}"`,
    channels: ['in-app'],
  });
}