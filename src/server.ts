import './config/env.js';

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import env, { withPublicBasePath } from './config/env.js';
import labApoioConsumerRoutes from './modules/labApoio/controllers/labApoio.consumer.routes.js';
import labApoioQaRoutes from './modules/labApoio/controllers/labApoio.qa.routes.js';
import { logEvent } from './shared/logging/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');
const qaPagePath = path.join(docsDir, 'public-qa-dashboard.html');

const app = express();
const routePrefixes = env.PUBLIC_BASE_PATH ? ['', env.PUBLIC_BASE_PATH] : [''];

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

for (const prefix of routePrefixes) {
  const resolveRoutePath = (targetPath: string) => `${prefix}${targetPath}` || targetPath;

  app.use(resolveRoutePath('/api/lab-apoio/v1/consumer'), labApoioConsumerRoutes);
  app.use(resolveRoutePath('/api/lab-apoio/v1/consumer/qa'), labApoioQaRoutes);
  app.use(resolveRoutePath('/docs'), express.static(docsDir, {
    extensions: ['html'],
  }));
}

app.get('/', (_req: Request, res: Response) => {
  res.redirect(withPublicBasePath('/qa'));
});

const sendQaPage = (_req: Request, res: Response) => {
  res.sendFile(qaPagePath);
};

app.get('/qa', sendQaPage);
if (env.PUBLIC_BASE_PATH) {
  app.get(env.PUBLIC_BASE_PATH, (_req: Request, res: Response) => {
    res.redirect(withPublicBasePath('/qa'));
  });
  app.get(withPublicBasePath('/qa'), sendQaPage);
}

const sendHealth = (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'integralab-consumidor',
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
};

app.get('/health', sendHealth);
if (env.PUBLIC_BASE_PATH) {
  app.get(withPublicBasePath('/health'), sendHealth);
}

const server = app.listen(env.PORT, () => {
  logEvent('info', 'server_started', {
    port: env.PORT,
    ambiente: env.APP_ENV,
    apiBaseUrl: env.INTEGRALAB_API_BASE_URL,
    publicBasePath: env.PUBLIC_BASE_PATH,
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
