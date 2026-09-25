import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Symmetric encryption for small secrets stored in the database (AES-256-GCM). The key is derived
 * from APP_SECRET and a purpose string, so one secret can serve several purposes without their
 * ciphertexts being interchangeable. Output: "v1.<iv>.<tag>.<ciphertext>", base64url parts.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string, purpose: string) {
    this.key = createHash('sha256').update(`${purpose}\0${secret}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  /** The plain text, or null when the value is malformed or was sealed with another key. */
  open(sealed: string): string | null {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
