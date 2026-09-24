import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

/** Live updates (CD-20): the change-event stream of a workspace, fed by PostgreSQL LISTEN/NOTIFY. */
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
