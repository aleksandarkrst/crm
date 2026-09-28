import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV } from '../../infrastructure/config/config.module';
import { AccountDirectory, createAccountDirectory } from './accounts';
import { AuthGuard } from './auth.guard';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { TokenService } from './token.service';

@Module({
  controllers: [IdentityController, TeamController, SettingsController, SignupController],
  providers: [
    TokenService,
    IdentityService,
    TeamService,
    SettingsService,
    SignupService,
    { provide: AccountDirectory, inject: [ENV], useFactory: createAccountDirectory },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
