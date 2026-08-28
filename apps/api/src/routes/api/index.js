import { Router } from 'express';

import apiHealth from './health.js';
import supabaseStatus from './supabase-status.js';
import me from './me.js';
import ashyChat from './ashy-chat.js';
import requireInternalHealthKey from '../../middleware/internal-health-key.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

export default () => {
	router.get('/health', apiHealth);
	router.get('/supabase/status', requireInternalHealthKey, supabaseStatus);
	router.get('/me', requireAuth, me);
	router.post('/ashy/chat', requireAuth, ashyChat);

	return router;
};
