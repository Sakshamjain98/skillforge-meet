import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createSession,
  getSessionsByOrg,
  getSessionById,
  markSessionEnded,
} from '../services/session.service';
import { stopRecording, isRecording } from '../services/recording.service';
import { roomManager } from '../socket/room.manager';
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
    // Fetch session to obtain orgId (used for recording upload)
    const sessionBefore = await getSessionById(req.params.id);
    if (!sessionBefore) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // If a recording was active, we must ensure upload succeeded before ending the session
    let recordingUrl: string | null = null;
    const hadRecording = isRecording(req.params.id);
    if (hadRecording) {
      try {
        recordingUrl = await stopRecording(req.params.id, sessionBefore.orgId);
      } catch (err: any) {
        // Upload failed — do NOT mark session ended. Return an error to the client so they can retry.
        const message = err?.message ?? String(err);
        // eslint-disable-next-line no-console
        console.error('Recording upload failed, session will remain live', message);
        res.status(500).json({ error: 'Recording upload failed, session not ended', detail: message });
        return;
      }
    } else {
      // No active recording — nothing to stop
    }

    // Clear room recording flag (in-memory)
    try { roomManager.setRecording(req.params.id, false); } catch { /* ignore */ }

    const session = await markSessionEnded(req.params.id);
    // Fetch aggregated attendance to return to client
    const attendance = await getSessionAttendance(req.params.id);

    res.json({ session, attendance, recordingUrl });
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
