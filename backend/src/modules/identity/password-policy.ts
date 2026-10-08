/**
 * The password rules of the Auth0 database connection (CD-114). Auth0 checks every new password
 * against them but only answers "Password is too weak", so Pultly reads the same rules, shows them
 * on the choose-password page and says which one a password misses. frontend/src/lib/password-rules.ts
 * checks them the same way while the person types.
 */
export type CharacterType = 'lowercase' | 'uppercase' | 'number' | 'special';
const CHARACTER_TYPES: CharacterType[] = ['lowercase', 'uppercase', 'number', 'special'];

export interface PasswordPolicy {
  minLength: number;
  /** Longer passwords are refused. 128 (the API's own cap) unless the provider refuses past 72. */
  maxLength: number;
  /** Required character types: every one ('all'), or any 3 of the 4 ('three_of_four'). */
  characterTypes: CharacterType[];
  characterTypeRule: 'all' | 'three_of_four';
  /** No three identical characters in a row ("aaa"). */
  blockIdentical: boolean;
  /** The rest only the provider can check: runs like "abc", common passwords, profile data, reuse. */
  blockSequential: boolean;
  dictionary: boolean;
  profileData: boolean;
  history: boolean;
}

/** When the rules can't be read (no read:connections), the length Pultly always asked for. */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  maxLength: 128,
  characterTypes: [],
  characterTypeRule: 'all',
  blockIdentical: false,
  blockSequential: false,
  dictionary: false,
  profileData: false,
  history: false,
};

/** The parts of an Auth0 connection's `options` that hold its password rules. */
export interface ConnectionOptions {
  /** Flexible Password Policy: when present, the legacy fields below don't apply. */
  password_options?: {
    complexity?: {
      min_length?: number;
      character_types?: string[];
      character_type_rule?: string;
      identical_characters?: string;
      sequential_characters?: string;
      max_length_exceeded?: string;
    };
    dictionary?: { active?: boolean };
    history?: { active?: boolean };
    profile_data?: { active?: boolean };
  };
  passwordPolicy?: string | null;
  password_complexity_options?: { min_length?: number } | null;
  password_dictionary?: { enable?: boolean } | null;
  password_history?: { enable?: boolean } | null;
  password_no_personal_info?: { enable?: boolean } | null;
}

/** Auth0's legacy strength levels (docs: "Password Strength in Auth0 Database Connections"). */
const LEGACY: Record<string, Pick<PasswordPolicy, 'minLength' | 'characterTypes' | 'characterTypeRule' | 'blockIdentical'>> = {
  none: { minLength: 1, characterTypes: [], characterTypeRule: 'all', blockIdentical: false },
  low: { minLength: 6, characterTypes: [], characterTypeRule: 'all', blockIdentical: false },
  fair: { minLength: 8, characterTypes: ['lowercase', 'uppercase', 'number'], characterTypeRule: 'all', blockIdentical: false },
  good: { minLength: 8, characterTypes: CHARACTER_TYPES, characterTypeRule: 'three_of_four', blockIdentical: false },
  excellent: { minLength: 10, characterTypes: CHARACTER_TYPES, characterTypeRule: 'three_of_four', blockIdentical: true },
};

export function policyFromConnection(options: ConnectionOptions): PasswordPolicy {
  const flexible = options.password_options;
  if (flexible) {
    const complexity = flexible.complexity ?? {};
    const types = CHARACTER_TYPES.filter((type) => complexity.character_types?.includes(type));
    return {
      minLength: complexity.min_length ?? 1,
      maxLength: complexity.max_length_exceeded === 'error' ? 72 : 128,
      characterTypes: types,
      // Auth0 allows 3 of 4 only with all four types chosen.
      characterTypeRule: complexity.character_type_rule === 'three_of_four' && types.length === 4 ? 'three_of_four' : 'all',
      blockIdentical: complexity.identical_characters === 'block',
      blockSequential: complexity.sequential_characters === 'block',
      dictionary: !!flexible.dictionary?.active,
      profileData: !!flexible.profile_data?.active,
      history: !!flexible.history?.active,
    };
  }
  const level = LEGACY[options.passwordPolicy ?? 'none'] ?? LEGACY.none!;
  return {
    ...level,
    minLength: options.password_complexity_options?.min_length ?? level.minLength,
    maxLength: 128,
    blockSequential: false,
    dictionary: !!options.password_dictionary?.enable,
    profileData: !!options.password_no_personal_info?.enable,
    history: !!options.password_history?.enable,
  };
}

const TYPE_TEST: Record<CharacterType, RegExp> = {
  lowercase: /\p{Ll}/u,
  uppercase: /\p{Lu}/u,
  number: /\p{N}/u,
  special: /[^\p{L}\p{N}]/u,
};
const TYPE_NAME: Record<CharacterType, string> = {
  lowercase: 'lowercase letter',
  uppercase: 'uppercase letter',
  number: 'number',
  special: 'special character (such as ! ? # @)',
};

/** One rule, and whether `password` meets it; `met: null` when only the provider can tell. */
export interface PasswordRule {
  text: string;
  met: boolean | null;
}

export function checkPassword(password: string, policy: PasswordPolicy): PasswordRule[] {
  const length = [...password].length;
  const has = (type: CharacterType) => TYPE_TEST[type].test(password);
  const rules: PasswordRule[] = [{ text: `At least ${policy.minLength} characters`, met: length >= policy.minLength }];
  if (policy.maxLength < 128) rules.push({ text: `At most ${policy.maxLength} characters`, met: length <= policy.maxLength });
  if (policy.characterTypeRule === 'three_of_four') {
    rules.push({ text: `At least 3 of these: ${CHARACTER_TYPES.map((type) => TYPE_NAME[type]).join(', ')}`, met: CHARACTER_TYPES.filter(has).length >= 3 });
  } else {
    for (const type of policy.characterTypes) rules.push({ text: `At least one ${TYPE_NAME[type]}`, met: has(type) });
  }
  if (policy.blockIdentical) rules.push({ text: 'No more than 2 identical characters in a row', met: !/(.)\1\1/u.test(password) });
  if (policy.blockSequential) rules.push({ text: 'No runs like abc or 123', met: null });
  if (policy.dictionary) rules.push({ text: 'Not a common password', met: null });
  if (policy.profileData) rules.push({ text: "Doesn't contain your name or email address", met: null });
  if (policy.history) rules.push({ text: 'Not one of your recent passwords', met: null });
  return rules;
}

/** What to tell the person when `password` misses rules Pultly can check; null when it meets them all. */
export function passwordProblem(password: string, policy: PasswordPolicy): string | null {
  const unmet = checkPassword(password, policy).filter((rule) => rule.met === false);
  if (!unmet.length) return null;
  return `The password doesn't meet ${unmet.length === 1 ? 'this rule' : 'these rules'}: ${unmet.map((rule) => lowerFirst(rule.text)).join('; ')}.`;
}

/** Every rule, for a refusal Pultly couldn't foresee. */
export function allRules(policy: PasswordPolicy): string {
  return checkPassword('', policy)
    .map((rule) => lowerFirst(rule.text))
    .join('; ');
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
