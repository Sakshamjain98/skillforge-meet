import crypto from 'crypto';

export interface TurnCredentials {
  username: string;
  password: string;
  ttl:      number;
  uris:     string[];
}

export function generateTurnCredentials(userId: string): TurnCredentials {
  const ttl      = 3600; // 1 hour
  const expiry   = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${userId}`;
  const password = crypto
    .createHmac('sha1', process.env.TURN_SECRET!)
    .update(username)
    .digest('base64');

  const host = process.env.TURN_SERVER_HOST || 'localhost';
  const port = process.env.TURN_SERVER_PORT || '3478';

  return {
    username,
    password,
    ttl,
    uris: [
      `stun:${host}:${port}`,
      `turn:${host}:${port}?transport=udp`,
      `turn:${host}:${port}?transport=tcp`,
    ],
  };
}