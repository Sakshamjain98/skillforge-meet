import { Router } from 'express';
import { register, login, refreshToken, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/login',    authLimiter, login);
router.post('/refresh',  refreshToken);
router.get('/me',        authenticate, getMe);

export default router;