import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    res.status(400).json({
      error:   'Validation error',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  // Known operational errors with a status code attached
  const status = (err as any).status ?? (err as any).statusCode ?? 500;

  logger.error('Unhandled error', {
    message: err.message,
    stack:   err.stack,
    path:    req.path,
    method:  req.method,
  });

  res.status(status).json({
    error:
      process.env.NODE_ENV === 'production'
        ? status === 500
          ? 'Internal server error'
          : err.message
        : err.message,
  });
}