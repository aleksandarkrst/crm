import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadEnv } from './infrastructure/config/env';
import { ErrorReportingFilter, initErrorTracking } from './infrastructure/monitoring';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  initErrorTracking('api');
  // Our own body parsers below, not Nest's: they refuse compressed bodies (CD-468).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ErrorReportingFilter(app.get(HttpAdapterHost).httpAdapter));
  app.setGlobalPrefix('api');
  // Requests arrive via cloudflared; trust its X-Forwarded-* headers for client IP and protocol.
  app.set('trust proxy', true);
  app.use(helmet());
  // Body parsers. `inflate: false`: the app never sends compressed bodies, and decompressing them
  // is how body-parser 2.3.0 could be crashed by one unauthenticated request (CD-468,
  // GHSA-27r3-jxmh-p828); such a request gets 415. CSV import (CD-64) sends the file as JSON: up to
  // 3 MB there (the services limit the file to 2 MB), registered first so the 100 kB parser after it
  // skips those already-parsed requests.
  app.use('/api/crm/import', json({ limit: '3mb', inflate: false }));
  app.use(json({ inflate: false }));
  app.use(urlencoded({ extended: false, inflate: false }));
  app.enableShutdownHooks();

  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, credentials: true });

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
