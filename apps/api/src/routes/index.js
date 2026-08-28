import { Router } from 'express';
import healthCheck from './health-check.js';
import apiRoutes from './api/index.js';
import chat from './chat.js';
import { signup, login, getAirtableId } from './auth.js';
import { getThread, saveMessage } from './thread.js';
import history from './history.js';
import { requireAuth, rejectForeignIdentity, assertParamUserIsSelf } from '../middleware/auth.js';

const router = Router();

export default () => {
    router.get('/health', healthCheck);
    router.use('/api', apiRoutes());
    router.post('/auth/signup', signup);
    router.post('/auth/login', login);
    router.post('/auth/airtable-id', requireAuth, getAirtableId);
    router.post('/chat', requireAuth, rejectForeignIdentity, chat);
    router.post('/history', requireAuth, rejectForeignIdentity, history);
    router.get('/thread/:userId', requireAuth, assertParamUserIsSelf('userId'), getThread);
    router.post('/thread/message', requireAuth, rejectForeignIdentity, saveMessage);

    return router;
};

