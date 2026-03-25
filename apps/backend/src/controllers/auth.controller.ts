import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { registerOrg, loginUser } from '../services/auth.service';
import { verifyRefreshToken, signAccessToken } from '../utils/jwt';
import { prisma } from '../config/database';

// ── Validation schemas ────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  orgName:  z.string().min(2).max(100),
  name:     z.string().min(2).max(100),
  email:    z.string().email(),
  password: z.string().min(8),
});

const LoginSchema = z.object({
  orgId:    z.string().uuid('orgId must be a valid UUID'),
  email:    z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  token: z.string().min(1),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body   = RegisterSchema.parse(req.body);
    const result = await registerOrg(body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body   = LoginSchema.parse(req.body);
    const result = await loginUser(body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function refreshToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token } = RefreshSchema.parse(req.body);
    const payload   = verifyRefreshToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const accessToken = signAccessToken({
      userId: user.id,
      orgId:  user.orgId,
      role:   user.role,
      email:  user.email,
      name:   user.name,
    });

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
}

export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user!.userId },
      select: {
        id:        true,
        name:      true,
        email:     true,
        role:      true,
        orgId:     true,
        avatar:    true,
        createdAt: true,
      },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
}