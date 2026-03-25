import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createSession,
  getSessionsByOrg,
  getSessionById,
  markSessionEnded,
} from '../services/session.service';
import { getSessionAttendance } from '../services/attendance.service';

// ── Validation schemas ────────────────────────────────────────────────────────

const CreateSessionSchema = z.object({
  title:            z.string().min(2).max(200),
  description:      z.string().max(2000).optional(),
  scheduledAt:      z.string().datetime().optional(),
  maxParticipants:  z.number().int().min(2).max(500).optional(),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function createSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body    = CreateSessionSchema.parse(req.body);
    const session = await createSession({
      orgId:   req.user!.orgId,
      coachId: req.user!.userId,
      ...body,
    });
    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
}

export async function getSessionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessions = await getSessionsByOrg(req.user!.orgId);
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
}

export async function getSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await getSessionById(req.params.id, req.user!.orgId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ session });
  } catch (err) {
    next(err);
  }
}

export async function endSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await markSessionEnded(req.params.id);
    res.json({ session });
  } catch (err) {
    next(err);
  }
}

export async function getAttendanceHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const attendance = await getSessionAttendance(req.params.id);
    res.json({ attendance });
  } catch (err) {
    next(err);
  }
}