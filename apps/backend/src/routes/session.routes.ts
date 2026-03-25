import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createSessionHandler,
  getSessionsHandler,
  getSessionHandler,
  endSessionHandler,
  getAttendanceHandler,
} from '../controllers/session.controller';

const router = Router();

// All session routes require authentication
router.use(authenticate);

router.post('/',                   createSessionHandler);
router.get('/',                    getSessionsHandler);
router.get('/:id',                 getSessionHandler);
router.put('/:id/end',             endSessionHandler);
router.get('/:id/attendance',      getAttendanceHandler);

export default router;