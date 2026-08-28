import { Router } from 'express';
import healthCheck from './health-check.js';
import apiRoutes from './api/index.js';
import chat from './chat.js';
import { signup, login, getAirtableId } from './auth.js';
import { getThread, saveMessage } from './thread.js';
import history from './history.js';

const router = Router();

export default () => {
    router.get('/health', healthCheck);
    router.use('/api', apiRoutes());
    router.post('/chat', chat);
    router.post('/history', history);
    router.post('/auth/signup', signup);
    router.post('/auth/login', login);
    router.post('/auth/airtable-id', getAirtableId);
    router.get('/thread/:userId', getThread);
    router.post('/thread/message', saveMessage);

    return router;
};

