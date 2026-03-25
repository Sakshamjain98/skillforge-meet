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