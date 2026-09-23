import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { TokenService } from './token.service';

@Module({
  controllers: [IdentityController, TeamController],
  providers: [TokenService, IdentityService, TeamService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [IdentityService],
})
export class IdentityModule {}
