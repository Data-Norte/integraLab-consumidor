import './config/env.js';

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import env from './config/env.js';
import labApoioConsumerRoutes from './modules/labApoio/controllers/labApoio.consumer.routes.js';
import { logEvent } from './shared/logging/logger.js';

const app = express();

if (env.ALLOW_ORIGINS.length > 0) {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      return env.ALLOW_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error('Origin not allowed'));
    },
  }));
} else {
  app.use(cors({ origin: false }));
}

app.use(helmet());
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buffer) => {
    (req as Request).rawBody = buffer.toString('utf8');
  },
}));

app.use('/api/lab-apoio/v1/consumer', labApoioConsumerRoutes);

app.get('/', (_req: Request, res: Response) => {
  res.send('IntegraLab consumer is running!');
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'integralab-consumidor',
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
});

const server = app.listen(env.PORT, () => {
  logEvent('info', 'server_started', {
    port: env.PORT,
    ambiente: env.APP_ENV,
    apiBaseUrl: env.INTEGRALAB_API_BASE_URL,
  });
});

const shutdown = (signal: string) => {
  logEvent('info', 'server_shutdown_requested', { signal });
  server.close(() => {
    logEvent('info', 'server_stopped', { signal });
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
