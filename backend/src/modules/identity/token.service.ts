import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, type JWTPayload, jwtVerify, SignJWT } from 'jose';
import { ENV, type Env } from '../../infrastructure/config/config.module';

export interface VerifiedIdentity {
  subject: string; // "<issuer>|<sub>"
  email: string | null;
  name: string | null;
}

const DEV_ISSUER = 'crm-dev';
const DEV_AUDIENCE = 'crm-api';

/**
 * A string claim, plain (`email`) or namespaced the way Auth0 Actions add custom claims to access
 * tokens (`https://pultly.com/email`), so a tenant that adds one fills users.email lazily (CD-222).
 */
export function claim(payload: JWTPayload, name: string): string | null {
  const plain = payload[name];
  if (typeof plain === 'string' && plain.trim()) return plain.trim();
  for (const [key, value] of Object.entries(payload)) {
    if (key.endsWith(`/${name}`) && /^https?:\/\//.test(key) && typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Verifies bearer tokens.
 * - AUTH_MODE=oidc: tokens from an external identity provider, checked against its JWKS.
 * - AUTH_MODE=dev:  HS256 tokens minted by /api/auth/dev-login. Never enabled in production.
 */
@Injectable()
export class TokenService {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly devKey?: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.DEV_JWT_SECRET) this.devKey = new TextEncoder().encode(env.DEV_JWT_SECRET);
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    let payload: JWTPayload;
    try {
      payload = this.env.AUTH_MODE === 'oidc' ? await this.verifyOidc(token) : await this.verifyDev(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!payload.sub || !payload.iss) throw new UnauthorizedException('Token missing sub/iss');
    return {
      subject: `${payload.iss}|${payload.sub}`,
      email: claim(payload, 'email'),
      name: claim(payload, 'name'),
    };
  }

  async issueDevToken(email: string, name: string): Promise<string> {
    if (this.env.AUTH_MODE !== 'dev' || !this.devKey) throw new UnauthorizedException('Dev login disabled');
    return new SignJWT({ email, name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(email.toLowerCase())
      .setIssuer(DEV_ISSUER)
      .setAudience(DEV_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(this.devKey);
  }

  private async verifyDev(token: string): Promise<JWTPayload> {
    if (!this.devKey) throw new Error('dev key missing');
    const { payload } = await jwtVerify(token, this.devKey, { issuer: DEV_ISSUER, audience: DEV_AUDIENCE });
    return payload;
  }

  private async verifyOidc(token: string): Promise<JWTPayload> {
    const issuer = this.env.OIDC_ISSUER!;
    if (!this.jwks) {
      const discoveryUrl = new URL('.well-known/openid-configuration', issuer.endsWith('/') ? issuer : `${issuer}/`);
      const res = await fetch(discoveryUrl);
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
      const { jwks_uri } = (await res.json()) as { jwks_uri: string };
      this.jwks = createRemoteJWKSet(new URL(jwks_uri));
    }
    const { payload } = await jwtVerify(token, this.jwks, { issuer, audience: this.env.OIDC_AUDIENCE });
    return payload;
  }
}
