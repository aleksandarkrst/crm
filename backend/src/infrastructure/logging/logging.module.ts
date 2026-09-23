import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from '../config/env';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          pinoHttp: {
            level: env.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
            transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
