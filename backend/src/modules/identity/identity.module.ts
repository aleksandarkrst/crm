import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { TokenService } from './token.service';

@Module({
  controllers: [IdentityController, TeamController, SettingsController],
  providers: [TokenService, IdentityService, TeamService, SettingsService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [IdentityService],
})
export class IdentityModule {}
