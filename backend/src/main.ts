import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadEnv } from './infrastructure/config/env';
import { ErrorReportingFilter, initErrorTracking } from './infrastructure/monitoring';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  initErrorTracking('api');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ErrorReportingFilter(app.get(HttpAdapterHost).httpAdapter));
  app.setGlobalPrefix('api');
  // Requests arrive via cloudflared; trust its X-Forwarded-* headers for client IP and protocol.
  app.set('trust proxy', true);
  app.use(helmet());
  // CSV import (CD-64) sends the file as JSON: allow up to 3 MB there (the service limits the file
  // to 2 MB) and keep the 100 kB default everywhere else. Registered before Nest's own JSON parser,
  // which then skips these already-parsed requests. A named wrapper, because Nest skips its parser
  // when it finds a middleware called "jsonParser".
  const importJson = json({ limit: '3mb' });
  app.use('/api/crm/import', function importBodyParser(req: Request, res: Response, next: NextFunction) {
    importJson(req, res, next);
  });
  app.enableShutdownHooks();

  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, credentials: true });

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
