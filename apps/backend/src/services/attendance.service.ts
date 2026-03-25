import { prisma } from '../config/database';
import { logger } from '../utils/logger';

export interface JoinEvent {
  sessionId: string;
  userId:    string;
  orgId:     string;
  joinedAt:  string; // ISO string
}

export interface LeaveEvent {
  sessionId: string;
  userId:    string;
  orgId:     string;
  leftAt:    string; // ISO string
}

export async function recordJoin(event: JoinEvent): Promise<void> {
  await prisma.sessionAttendance.create({
    data: {
      orgId:     event.orgId,
      sessionId: event.sessionId,
      userId:    event.userId,
      joinedAt:  new Date(event.joinedAt),
    },
  });
  logger.debug('Attendance join recorded', {
    userId:    event.userId,
    sessionId: event.sessionId,
  });
}

export async function recordLeave(event: LeaveEvent): Promise<void> {
  // Find the most recent open attendance record for this user/session
  const record = await prisma.sessionAttendance.findFirst({
    where: {
      sessionId: event.sessionId,
      userId:    event.userId,
      leftAt:    null,
    },
    orderBy: { joinedAt: 'desc' },
  });

  if (!record) {
    logger.warn('No open attendance record found for leave event', event);
    return;
  }

  const leftAt         = new Date(event.leftAt);
  const durationSeconds = Math.floor(
    (leftAt.getTime() - record.joinedAt.getTime()) / 1000
  );

  await prisma.sessionAttendance.update({
    where: { id: record.id },
    data:  { leftAt, durationSeconds },
  });

  logger.debug('Attendance leave recorded', {
    userId:          event.userId,
    sessionId:       event.sessionId,
    durationSeconds,
  });
}

export async function getSessionAttendance(sessionId: string) {
  return prisma.sessionAttendance.findMany({
    where:   { sessionId },
    include: {
      user: { select: { id: true, name: true, email: true, avatar: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });
}