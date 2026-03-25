import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { turnLimiter } from '../middleware/rateLimiter';
import { getTurnCredentials } from '../controllers/turn.controller';

const router = Router();

router.get('/credentials', authenticate, turnLimiter, getTurnCredentials);

export default router;