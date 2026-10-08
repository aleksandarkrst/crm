import { afterEach, describe, expect, it, vi } from 'vitest';
import { Auth0Accounts, type AccountError } from '../src/modules/identity/accounts';
import { checkPassword, DEFAULT_PASSWORD_POLICY, passwordProblem, policyFromConnection } from '../src/modules/identity/password-policy';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('password rules of the Auth0 connection (CD-114)', () => {
  it('reads the Flexible Password Policy', () => {
    const policy = policyFromConnection({
      password_options: {
        complexity: {
          min_length: 12,
          character_types: ['uppercase', 'lowercase', 'number', 'special'],
          character_type_rule: 'three_of_four',
          identical_characters: 'block',
          sequential_characters: 'block',
          max_length_exceeded: 'error',
        },
        dictionary: { active: true },
        history: { active: false },
        profile_data: { active: true },
      },
      // The legacy level no longer applies once password_options is there.
      passwordPolicy: 'excellent',
    });
    expect(policy).toEqual({
      minLength: 12,
      maxLength: 72,
      characterTypes: ['lowercase', 'uppercase', 'number', 'special'],
      characterTypeRule: 'three_of_four',
      blockIdentical: true,
      blockSequential: true,
      dictionary: true,
      profileData: true,
      history: false,
    });
  });

  it('a minimum length alone, as Auth0 sets it up today', () => {
    const policy = policyFromConnection({ password_options: { complexity: { min_length: 8, character_types: [], identical_characters: 'allow' } } });
    expect(checkPassword('kontakt1', policy)).toEqual([{ text: 'At least 8 characters', met: true }]);
    expect(passwordProblem('kontakt', policy)).toBe("The password doesn't meet this rule: at least 8 characters.");
  });

  it('maps the legacy strength levels', () => {
    expect(policyFromConnection({ passwordPolicy: 'fair' })).toMatchObject({ minLength: 8, characterTypes: ['lowercase', 'uppercase', 'number'], characterTypeRule: 'all' });
    expect(policyFromConnection({ passwordPolicy: 'good', password_complexity_options: { min_length: 9 } })).toMatchObject({ minLength: 9, characterTypeRule: 'three_of_four' });
    expect(policyFromConnection({ passwordPolicy: 'excellent', password_dictionary: { enable: true } })).toMatchObject({ minLength: 10, blockIdentical: true, dictionary: true });
    expect(policyFromConnection({ passwordPolicy: null })).toMatchObject({ minLength: 1, characterTypes: [] });
  });

  it('says which rules a password misses', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, characterTypes: ['uppercase' as const, 'number' as const], blockIdentical: true, dictionary: true };
    expect(checkPassword('mojasifraaa', policy)).toEqual([
      { text: 'At least 8 characters', met: true },
      { text: 'At least one uppercase letter', met: false },
      { text: 'At least one number', met: false },
      { text: 'No more than 2 identical characters in a row', met: false },
      { text: 'Not a common password', met: null },
    ]);
    expect(passwordProblem('mojasifraaa', policy)).toBe(
      "The password doesn't meet these rules: at least one uppercase letter; at least one number; no more than 2 identical characters in a row.",
    );
    // Letters beyond ASCII count as letters, and anything else as a special character.
    expect(passwordProblem('Šifra2024', policy)).toBeNull();
    const threeOfFour = policyFromConnection({ passwordPolicy: 'good' });
    expect(passwordProblem('sifra2024!', threeOfFour)).toBeNull();
    expect(passwordProblem('sifra2024', threeOfFour)).toContain('at least 3 of these');
  });

  it('counts characters, not bytes', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 4 };
    expect(passwordProblem('ššš😀', policy)).toBeNull();
  });
});

describe('Auth0Accounts.passwordPolicy (CD-114)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const auth0 = () => new Auth0Accounts('tenant.eu.auth0.com', 'client', 'secret', 'Username-Password-Authentication');
  const token = json(200, { access_token: 'mgmt', expires_in: 86_400 });

  it("reads the connection's options once and keeps them", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('/oauth/token') ? token.clone() : json(200, [{ options: { password_options: { complexity: { min_length: 10 } } } }]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const accounts = auth0();
    expect(await accounts.passwordPolicy()).toMatchObject({ minLength: 10 });
    expect(await accounts.passwordPolicy()).toMatchObject({ minLength: 10 });

    const reads = fetchMock.mock.calls.filter(([url]) => String(url).includes('/connections'));
    expect(reads).toHaveLength(1);
    const [url, init] = reads[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://tenant.eu.auth0.com/api/v2/connections?strategy=auth0&name=Username-Password-Authentication&fields=options&include_fields=true');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('falls back to the default rule without read:connections, and tries again later', async () => {
    vi.useFakeTimers();
    let allowed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/oauth/token')) return token.clone();
        return allowed ? json(200, [{ options: { passwordPolicy: 'excellent' } }]) : json(403, { message: 'Insufficient scope, expected any of: read:connections' });
      }),
    );
    const accounts = auth0();
    expect(await accounts.passwordPolicy()).toEqual(DEFAULT_PASSWORD_POLICY);
    allowed = true;
    expect(await accounts.passwordPolicy()).toEqual(DEFAULT_PASSWORD_POLICY);
    vi.advanceTimersByTime(61_000);
    expect(await accounts.passwordPolicy()).toMatchObject({ minLength: 10 });
  });

  it('names the missing rules when Auth0 says only "too weak"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/oauth/token')) return token.clone();
        if (String(url).includes('/connections')) return json(200, [{ options: { passwordPolicy: 'fair' } }]);
        return json(400, { message: 'PasswordStrengthError: Password is too weak' });
      }),
    );
    const refusal = (password: string) => auth0().createPasswordUser('ana@example.test', password).then(() => null, (err: AccountError) => err.message);
    expect(await refusal('mojasifra1')).toBe("The password doesn't meet this rule: at least one uppercase letter.");
    // A rule only Auth0 knows: every rule, so the person can tell what to change.
    expect(await refusal('Mojasifra1')).toBe('That password is too weak. The rules: at least 8 characters; at least one lowercase letter; at least one uppercase letter; at least one number.');
  });
});
