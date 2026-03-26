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

/**
 * @openapi
 * /sessions:
 *   post:
 *     summary: Create a new live session
 *     tags:
 *       - Sessions
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Created session
 */

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

/**
 * @openapi
 * /sessions:
 *   get:
 *     summary: List sessions for the current org
 *     tags:
 *       - Sessions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of sessions
 */

export async function getSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await getSessionById(req.params.id); // allow any authenticated user to view session details
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ session });
  } catch (err) {
    next(err);
  }
}

/**
 * @openapi
 * /sessions/{id}:
 *   get:
 *     summary: Get a single session by id
 *     tags:
 *       - Sessions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session details
 */

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

/**
 * @openapi
 * /sessions/{id}/end:
 *   put:
 *     summary: Mark a session as ended
 *     tags:
 *       - Sessions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session ended
 */

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

/**
 * @openapi
 * /sessions/{id}/attendance:
 *   get:
 *     summary: Get attendance records for a session
 *     tags:
 *       - Sessions
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attendance list
 */