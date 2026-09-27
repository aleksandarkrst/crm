import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { initErrorTracking } from './infrastructure/monitoring';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  initErrorTracking('worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();
}

void bootstrap();
