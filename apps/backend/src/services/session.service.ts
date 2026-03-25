import { prisma } from '../config/database';
import { SessionStatus } from '../types/prisma-enums';

export interface CreateSessionInput {
  orgId:           string;
  coachId:         string;
  title:           string;
  description?:    string;
  scheduledAt?:    string;
  maxParticipants?: number;
}

export async function createSession(input: CreateSessionInput) {
  return prisma.liveSession.create({
    data: {
      orgId:           input.orgId,
      coachId:         input.coachId,
      title:           input.title,
      description:     input.description,
      scheduledAt:     input.scheduledAt ? new Date(input.scheduledAt) : null,
      maxParticipants: input.maxParticipants ?? 50,
      status:          'SCHEDULED',
    },
    include: {
      coach: { select: { name: true, avatar: true } },
    },
  });
}

export async function getSessionsByOrg(orgId: string) {
  return prisma.liveSession.findMany({
    where:   { orgId },
    include: { coach: { select: { name: true, avatar: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getSessionById(id: string, orgId: string) {
  return prisma.liveSession.findFirst({
    where:   { id, orgId },
    include: {
      coach:      { select: { id: true, name: true, avatar: true } },
      attendance: {
        include: { user: { select: { id: true, name: true, avatar: true } } },
      },
      chatMessages: {
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take:    200,
      },
    },
  });
}

export async function markSessionLive(id: string) {
  return prisma.liveSession.update({
    where: { id },
    data:  { status: 'LIVE', startedAt: new Date() },
  });
}

export async function markSessionEnded(id: string) {
  return prisma.liveSession.update({
    where: { id },
    data:  { status: 'COMPLETED', endedAt: new Date() },
  });
}

export async function updateRecordingUrl(id: string, recordingUrl: string) {
  return prisma.liveSession.update({
    where: { id },
    data:  { recordingUrl },
  });
}