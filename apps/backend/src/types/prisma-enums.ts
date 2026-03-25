// Fallback UserRole and SessionStatus types (since Prisma enums are not exported)
export type UserRole =
  | 'ORG_ADMIN'
  | 'MANAGER'
  | 'COURSE_DESIGNER'
  | 'COACH'
  | 'STAFF_WHITE'
  | 'STAFF_BLUE';

export type SessionStatus =
  | 'SCHEDULED'
  | 'LIVE'
  | 'COMPLETED'
  | 'CANCELLED';
