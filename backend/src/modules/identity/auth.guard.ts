import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AppRequest, IS_PUBLIC, REQUIRED_ROLE, hasRole } from '../../shared/authorization';
import type { MembershipRole } from '../../shared/database/schema';
import { IdentityService } from './identity.service';
import { TokenService } from './token.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global guard. Every route requires a valid bearer token unless marked @Public().
 * Routes marked @RequireTenant(role) additionally require an X-Tenant-Id header naming a
 * tenant the user belongs to with at least that role.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');

    const verified = await this.tokens.verify(header.slice('Bearer '.length));
    req.user = await this.identity.resolveUser(verified);

    const requiredRole = this.reflector.getAllAndOverride<MembershipRole | undefined>(REQUIRED_ROLE, targets);
    if (!requiredRole) return true;

    const tenantId = req.headers['x-tenant-id'];
    if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) throw new ForbiddenException('Missing or invalid X-Tenant-Id');

    const role = await this.identity.getRole(req.user.id, tenantId);
    if (!role) throw new ForbiddenException('Not a member of this tenant');
    if (!hasRole(role, requiredRole)) throw new ForbiddenException(`Requires ${requiredRole} role`);

    req.tenant = { tenantId, userId: req.user.id, role };
    return true;
  }
}
