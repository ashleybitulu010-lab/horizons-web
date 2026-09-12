import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import routes from './routes/index.js';
import { errorMiddleware } from './middleware/error.js';
import { globalRateLimit } from './middleware/global-rate-limit.js';
import { BodyLimit } from './constants/common.js';

export function createApp() {
	const app = express();

	app.set('trust proxy', true);

	app.use(helmet());
	app.use(cors({
		origin: process.env.CORS_ORIGIN || false,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'QUERY'],
		allowedHeaders: ['Authorization', 'Content-Type', 'X-Ash-Internal-Key', 'X-Activity-Id'],
	}));
	app.use(morgan('combined'));
	app.use(globalRateLimit);
	app.use(express.json({ limit: BodyLimit }));
	app.use(express.urlencoded({ extended: true, limit: BodyLimit }));

	// Production nginx forwards the full /hcgi/api/* path; also mount at / for local dev.
	const apiRouter = routes();
	app.use('/hcgi/api', apiRouter);
	app.use('/', apiRouter);

	app.use(errorMiddleware);

	app.use((req, res) => {
		res.status(404).json({ error: 'Route not found' });
	});

	return app;
}

export default createApp;
