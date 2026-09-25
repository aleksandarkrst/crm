import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseService } from './database.service';
import { RequestActorInterceptor } from './request-context';

@Global()
@Module({
  providers: [DatabaseService, { provide: APP_INTERCEPTOR, useClass: RequestActorInterceptor }],
  exports: [DatabaseService],
})
export class DatabaseModule {}
