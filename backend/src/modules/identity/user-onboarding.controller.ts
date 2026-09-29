import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { type AuthUser, CurrentUser } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { OnboardingProfile, UserOnboardingService } from './user-onboarding.service';

/**
 * Onboarding after the first sign-up (CD-115). Per user and before any workspace exists, so these
 * routes need a signed-in user but no X-Tenant-Id. Joining a workspace from the list of pending
 * invitations is `POST /api/me/invitations/:id/accept` (TeamController).
 */
@Controller('me/onboarding')
export class UserOnboardingController {
  constructor(private readonly onboarding: UserOnboardingService) {}

  @Get()
  state(@CurrentUser() user: AuthUser) {
    return this.onboarding.state(user);
  }

  @Put('profile')
  saveProfile(@CurrentUser() user: AuthUser, @Body(new ZodPipe(OnboardingProfile)) body: OnboardingProfile) {
    return this.onboarding.saveProfile(user, body);
  }

  /** Finishes (or skips) "Invite your team"; the invitations themselves go through POST /api/team/invitations. */
  @Post('team')
  @HttpCode(200)
  finishTeam(@CurrentUser() user: AuthUser) {
    return this.onboarding.finishTeam(user);
  }
}
