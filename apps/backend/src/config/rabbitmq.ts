import * as amqp from 'amqplib';
import { logger } from '../utils/logger';

let connection: amqp.ChannelModel | null = null;
let channel: amqp.Channel | null = null;

export const EXCHANGES = {
  SESSION_EVENTS: 'session.events',
} as const;

export const QUEUES = {
  ATTENDANCE:   'attendance.queue',
  NOTIFICATION: 'notification.queue',
  RECORDING:    'recording.queue',
} as const;

export const ROUTING_KEYS = {
  PARTICIPANT_JOINED: 'session.participant.joined',
  PARTICIPANT_LEFT:   'session.participant.left',
  SESSION_STARTED:    'session.started',
  SESSION_ENDED:      'session.ended',
  RECORDING_READY:    'session.recording.ready',
} as const;

export type RoutingKey = (typeof ROUTING_KEYS)[keyof typeof ROUTING_KEYS];

export async function connectRabbitMQ(): Promise<void> {
  const conn = await amqp.connect(process.env.RABBITMQ_URL!);
  connection = conn;
  channel = await connection.createChannel();

  // Durable topic exchange — survives broker restarts
  await channel.assertExchange(EXCHANGES.SESSION_EVENTS, 'topic', {
    durable: true,
  });

  // Declare all queues as durable (messages survive broker restarts)
  await channel.assertQueue(QUEUES.ATTENDANCE,   { durable: true });
  await channel.assertQueue(QUEUES.NOTIFICATION, { durable: true });
  await channel.assertQueue(QUEUES.RECORDING,    { durable: true });

  // Bind queues to exchange with routing key patterns
  await channel.bindQueue(
    QUEUES.ATTENDANCE,
    EXCHANGES.SESSION_EVENTS,
    'session.participant.*'
  );
  await channel.bindQueue(
    QUEUES.NOTIFICATION,
    EXCHANGES.SESSION_EVENTS,
    'session.*'
  );
  await channel.bindQueue(
    QUEUES.RECORDING,
    EXCHANGES.SESSION_EVENTS,
    'session.ended'
  );

  connection.on('error', (err) => {
    logger.error('RabbitMQ connection error', { message: err.message });
  });

  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed — reconnecting in 5s');
    setTimeout(connectRabbitMQ, 5000);
  });

  logger.info('RabbitMQ connected, exchange and queues ready');
}

export function publish(routingKey: RoutingKey, data: object): void {
  if (!channel) {
    logger.error('RabbitMQ channel not ready — cannot publish', { routingKey });
    return;
  }
  const buffer = Buffer.from(JSON.stringify(data));
  channel.publish(EXCHANGES.SESSION_EVENTS, routingKey, buffer, {
    persistent: true,      // messages survive broker restart
    contentType: 'application/json',
  });
}

export function getChannel(): amqp.Channel {
  if (!channel) throw new Error('RabbitMQ channel not initialised');
  return channel;
}

export async function consumeQueue(
  queue: string,
  handler: (msg: amqp.ConsumeMessage) => Promise<void>,
  prefetch = 10
): Promise<void> {
  const ch = getChannel();
  await ch.prefetch(prefetch);
  await ch.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      await handler(msg);
      ch.ack(msg);
    } catch (err) {
      logger.error(`Queue [${queue}] handler error`, { error: String(err) });
      // Reject without requeue → dead-letter
      ch.nack(msg, false, false);
    }
  });
}