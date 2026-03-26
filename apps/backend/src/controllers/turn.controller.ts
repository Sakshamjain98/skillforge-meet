import { Request, Response, NextFunction } from 'express';
import { generateTurnCredentials } from '../utils/turn-credentials';

export function getTurnCredentials(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const credentials = generateTurnCredentials(req.user!.userId);
    res.json(credentials);
  } catch (err) {
    next(err);
  }
}

/**
 * @openapi
 * /turn/credentials:
 *   get:
 *     summary: Get TURN credentials for the current user
 *     tags:
 *       - TURN
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: TURN credentials
 */