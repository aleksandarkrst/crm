import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public } from '../../shared/authorization';
import { RateLimit } from '../../shared/rate-limit';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { IdentityService } from './identity.service';
import { isIanaTimeZone } from './settings.schemas';
import { TokenService } from './token.service';
import { UserOnboardingService } from './user-onboarding.service';

const DevLoginBody = z.object({ email: z.email(), name: z.string().trim().min(1).max(100) });
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
/** A new workspace: its name, the main currency (ISO 4217) its reports use (CD-83), and its time zone. */
const CreateTenantBody = z.object({
  name: z.string().trim().min(1).max(100),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => /^[A-Z]{3}$/.test(c) && CURRENCIES.has(c), 'Must be an ISO 4217 currency code, e.g. EUR')
    .optional(),
  /** IANA time zone; onboarding (CD-115) sends the browser's. */
  timezone: z.string().trim().refine(isIanaTimeZone, 'Must be an IANA time zone, e.g. Europe/Belgrade').optional(),
});

@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
    private readonly onboarding: UserOnboardingService,
  ) {}

  /** Local development only (AUTH_MODE=dev): log in as any email, no password. */
  @Public()
  @RateLimit('signIn')
  @Post('auth/dev-login')
  @HttpCode(200)
  async devLogin(@Body(new ZodPipe(DevLoginBody)) body: z.infer<typeof DevLoginBody>) {
    return { accessToken: await this.tokens.issueDevToken(body.email, body.name) };
  }

  /** Who is signed in, their workspaces, and where they are in onboarding (CD-115). */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user, tenants: await this.identity.listTenants(user.id), onboarding: await this.onboarding.state(user) };
  }

  @Post('tenants')
  @RateLimit('heavy')
  async createTenant(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateTenantBody)) body: z.infer<typeof CreateTenantBody>) {
    const tenant = await this.identity.createTenant(user.id, body.name, body.currency, body.timezone);
    await this.onboarding.completeIfDone(user);
    return tenant;
  }
}
