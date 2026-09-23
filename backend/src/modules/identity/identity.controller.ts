import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Public } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { IdentityService } from './identity.service';
import { TokenService } from './token.service';

const DevLoginBody = z.object({ email: z.email(), name: z.string().trim().min(1).max(100) });
const CreateTenantBody = z.object({ name: z.string().trim().min(1).max(100) });

@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
  ) {}

  /** Local development only (AUTH_MODE=dev): log in as any email, no password. */
  @Public()
  @Post('auth/dev-login')
  @HttpCode(200)
  async devLogin(@Body(new ZodPipe(DevLoginBody)) body: z.infer<typeof DevLoginBody>) {
    return { accessToken: await this.tokens.issueDevToken(body.email, body.name) };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user, tenants: await this.identity.listTenants(user.id) };
  }

  @Post('tenants')
  async createTenant(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateTenantBody)) body: z.infer<typeof CreateTenantBody>) {
    return this.identity.createTenant(user.id, body.name);
  }
}
