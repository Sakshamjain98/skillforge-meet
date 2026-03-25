import { JWTPayload } from '../utils/jwt';
import type { UserRole } from './prisma-enums';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        orgId: string;
        role: UserRole;
        email: string;
        name: string;
      };
    }
  }
}

export {};