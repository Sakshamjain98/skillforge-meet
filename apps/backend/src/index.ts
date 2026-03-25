/// <reference path="./types/express.d.ts" />
import 'dotenv/config';
// Type augmentation for Express is handled automatically by TypeScript
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { connectDatabase, prisma } from './config/database';
import { connectRedis, redis, redisPub, redisSub } from './config/redis';
import { connectRabbitMQ } from './config/rabbitmq';
import { createWorkers } from './config/mediasoup';
import { createSocketServer } from './socket';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import { logger } from './utils/logger';

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// Security headers (disable COEP so WebRTC works in same-origin iframes)
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy:   false,
  })
);

// CORS — allow the Next.js frontend
app.use(
  cors({
    origin:      process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Request logging (skip in test env)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV,
  });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', routes);

// ── Global error handler (must be last middleware) ────────────────────────────
app.use(errorHandler);

// ── HTTP server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer(app);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  try {
    // 1. PostgreSQL
    await connectDatabase();

    // 2. Redis (3 clients: main + pub + sub)
    await connectRedis();

    // 3. RabbitMQ
    await connectRabbitMQ();

    // 4. MediaSoup workers (one per CPU core, capped at 2 in dev)
    await createWorkers();

    // 5. Socket.IO (attaches to the shared HTTP server)
    createSocketServer(httpServer);

    // 6. Start listening
    const PORT = parseInt(process.env.PORT || '4000', 10);
    httpServer.listen(PORT, () => {
      logger.info(`SkillForge Meet backend is running`, {
        port: PORT,
        env:  process.env.NODE_ENV,
        url:  `http://localhost:${PORT}`,
      });
    });
  } catch (err) {
    logger.error('Bootstrap failed — shutting down', { error: String(err) });
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down gracefully`);

  // Stop accepting new connections
  httpServer.close(() => logger.info('HTTP server closed'));

  // Disconnect clients
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  try { redis.disconnect(); }         catch { /* ignore */ }
  try { redisPub.disconnect(); }      catch { /* ignore */ }
  try { redisSub.disconnect(); }      catch { /* ignore */ }

  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

bootstrap();