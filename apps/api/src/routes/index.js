import { Router } from 'express';
import healthCheck from './health-check.js';
import apiRoutes from './api/index.js';
import chat from './chat.js';
import { signup, login, getAirtableId } from './auth.js';
import { getThread, saveMessage } from './thread.js';
import history from './history.js';
import { requireAuth, rejectForeignIdentity, rejectForeignScope, assertParamUserIsSelf } from '../middleware/auth.js';
import { resolveActivityScope } from '../middleware/activity-scope.js';

const router = Router();

export default () => {
    router.get('/health', healthCheck);
    router.use('/api', apiRoutes());
    router.post('/auth/signup', signup);
    router.post('/auth/login', login);
    router.post('/auth/airtable-id', requireAuth, resolveActivityScope, getAirtableId);
    router.post('/chat', requireAuth, resolveActivityScope, rejectForeignIdentity, rejectForeignScope, chat);
    router.post('/history', requireAuth, resolveActivityScope, rejectForeignIdentity, rejectForeignScope, history);
    router.get('/thread/:userId', requireAuth, resolveActivityScope, assertParamUserIsSelf('userId'), getThread);
    router.post('/thread/message', requireAuth, resolveActivityScope, rejectForeignIdentity, rejectForeignScope, saveMessage);

    return router;
};

