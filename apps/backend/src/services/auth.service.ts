import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
import { signAccessToken, signRefreshToken } from '../utils/jwt';
import { UserRole } from '../types/prisma-enums';

export interface RegisterInput {
  orgName:  string;
  name:     string;
  email:    string;
  password: string;
}

export interface LoginInput {
  orgId:    string;
  email:    string;
  password: string;
}

export interface AuthResult {
  accessToken:  string;
  refreshToken: string;
  user: {
    id:    string;
    name:  string;
    email: string;
    role:  string;
    orgId: string;
  };
}

export async function registerOrg(input: RegisterInput): Promise<AuthResult> {
  const { orgName, name, email, password } = input;

  // Create a URL-safe slug with timestamp to guarantee uniqueness
  const baseSlug = orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = `${baseSlug}-${Date.now()}`;

  const hashedPassword = await bcrypt.hash(password, 12);

  const { org, user } = await prisma.$transaction(async (tx: { organization: { create: (arg0: { data: { name: string; slug: string; }; }) => any; }; user: { create: (arg0: { data: { orgId: any; email: string; password: string; name: string; role: any; }; }) => any; }; }) => {
    const org = await tx.organization.create({
      data: { name: orgName, slug },
    });

    const user = await tx.user.create({
      data: {
        orgId:    org.id,
        email,
        password: hashedPassword,
        name,
        role:     'ORG_ADMIN',
      },
    });

    return { org, user };
  });

  const payload = {
    userId: user.id,
    orgId:  org.id,
    role:   user.role,
    email:  user.email,
    name:   user.name,
  };

  return {
    accessToken:  signAccessToken(payload),
    refreshToken: signRefreshToken({ userId: user.id, orgId: org.id }),
    user: {
      id:    user.id,
      name:  user.name,
      email: user.email,
      role:  user.role,
      orgId: org.id,
    },
  };
}

export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const { orgId, email, password } = input;

  const user = await prisma.user.findFirst({
    where: { orgId, email },
  });

  if (!user) {
    const err = new Error('Invalid credentials') as any;
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    const err = new Error('Invalid credentials') as any;
    err.status = 401;
    throw err;
  }

  const payload = {
    userId: user.id,
    orgId:  user.orgId,
    role:   user.role,
    email:  user.email,
    name:   user.name,
  };

  return {
    accessToken:  signAccessToken(payload),
    refreshToken: signRefreshToken({ userId: user.id, orgId: user.orgId }),
    user: {
      id:    user.id,
      name:  user.name,
      email: user.email,
      role:  user.role,
      orgId: user.orgId,
    },
  };
}

export async function createUser(input: {
  orgId:    string;
  name:     string;
  email:    string;
  password: string;
  role:     UserRole;
}) {
  const hashedPassword = await bcrypt.hash(input.password, 12);
  return prisma.user.create({
    data: { ...input, password: hashedPassword },
    select: { id: true, name: true, email: true, role: true, orgId: true },
  });
}