import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';

/**
 * Sets PostgreSQL session variable `app.org_id` so that
 * Row-Level Security policies activate automatically for every
 * query executed within this request's transaction scope.
 *
 * Place this middleware AFTER authenticate() so req.user is available.
 */
export async function setTenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user?.orgId) {
    next();
    return;
  }

  try {
    // SET LOCAL only affects the current transaction/session
    await prisma.$executeRawUnsafe(
      `SET LOCAL app.org_id = '${req.user.orgId}'`
    );
    next();
  } catch (err) {
    next(err);
  }
}