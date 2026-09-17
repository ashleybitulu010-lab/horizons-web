import { Router } from 'express';

import apiHealth from './health.js';
import supabaseStatus from './supabase-status.js';
import me from './me.js';
import ashyChat from './ashy-chat.js';
import readRoutingMetrics from './read-routing-metrics.js';
import requireInternalHealthKey from '../../middleware/internal-health-key.js';
import { requireAuth, rejectForeignScope } from '../../middleware/auth.js';
import { resolveActivityScope } from '../../middleware/activity-scope.js';

const router = Router();

export default () => {
	router.get('/health', apiHealth);
	router.get('/supabase/status', requireInternalHealthKey, supabaseStatus);
	router.get('/me', requireAuth, resolveActivityScope, rejectForeignScope, me);
	router.post('/ashy/chat', requireAuth, resolveActivityScope, rejectForeignScope, ashyChat);
	router.get('/read-routing/metrics', requireInternalHealthKey, readRoutingMetrics);

	return router;
};
