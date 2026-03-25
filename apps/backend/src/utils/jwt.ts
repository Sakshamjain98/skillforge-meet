
import { UserRole } from '../types/prisma-enums';
import jwt from 'jsonwebtoken';

export interface JWTPayload {
  userId: string;
  orgId:  string;
  role:   UserRole;
  email:  string;
  name:   string;
}

export type RefreshPayload = Pick<JWTPayload, 'userId' | 'orgId'>;

export function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any,
  });
}

export function signRefreshToken(payload: RefreshPayload): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any,
  });
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
}

export function verifyRefreshToken(token: string): RefreshPayload {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as RefreshPayload;
}