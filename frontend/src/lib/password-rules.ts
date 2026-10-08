/**
 * The password rules of the sign-in provider (CD-114), as the backend reads them
 * (backend/src/modules/identity/password-policy.ts, which checks them the same way).
 */
export type CharacterType = 'lowercase' | 'uppercase' | 'number' | 'special';
const CHARACTER_TYPES: CharacterType[] = ['lowercase', 'uppercase', 'number', 'special'];

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  characterTypes: CharacterType[];
  characterTypeRule: 'all' | 'three_of_four';
  blockIdentical: boolean;
  blockSequential: boolean;
  dictionary: boolean;
  profileData: boolean;
  history: boolean;
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
