import { Router } from 'express';

import apiHealth from './health.js';
import supabaseStatus from './supabase-status.js';
import requireInternalHealthKey from '../../middleware/internal-health-key.js';

const router = Router();

export default () => {
	router.get('/health', apiHealth);
	router.get('/supabase/status', requireInternalHealthKey, supabaseStatus);

	return router;
};
