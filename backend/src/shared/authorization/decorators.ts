import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { MembershipRole } from '../database/schema';
import type { AuthUser, TenantContext } from './tenant-context';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_ROLE = 'auth:requiredRole';

/** Skips authentication (health checks, dev login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Requires the X-Tenant-Id header and a membership in that tenant with at least `role`.
 * Apply to a controller or a single route; the route-level value wins.
 */
export const RequireTenant = (role: MembershipRole = 'member') => SetMetadata(REQUIRED_ROLE, role);

export interface AppRequest extends Request {
  user?: AuthUser;
  tenant?: TenantContext;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});

export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<AppRequest>().tenant;
  if (!tenant) throw new Error('Tenant used on a route without @RequireTenant()');
  return tenant;
});
