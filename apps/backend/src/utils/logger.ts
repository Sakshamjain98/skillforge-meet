import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logsDir = path.join(process.cwd(), 'logs');
// Create logs directory asynchronously to avoid blocking the event loop.
fs.promises
  .mkdir(logsDir, { recursive: true })
  .catch(() => {
    // If directory creation fails, ignore — winston will attempt to create files.
  });

const { combine, timestamp, colorize, printf, json } = winston.format;

const devFormat = combine(
  timestamp({ format: 'HH:mm:ss' }),
  colorize(),
  printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? ' ' + JSON.stringify(meta)
      : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

const prodFormat = combine(timestamp(), json());

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: combine(timestamp(), json()),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: combine(timestamp(), json()),
    }),
  ],
});