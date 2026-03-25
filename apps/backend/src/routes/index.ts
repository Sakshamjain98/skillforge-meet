import { Router } from 'express';
import authRoutes    from './auth.routes';
import sessionRoutes from './session.routes';
import turnRoutes    from './turn.routes';

const router = Router();

router.use('/auth',     authRoutes);
router.use('/sessions', sessionRoutes);
router.use('/turn',     turnRoutes);

export default router;