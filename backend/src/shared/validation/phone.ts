/**
 * A phone number as people write it (CD-464): an optional leading +, at least five digits, and
 * spaces, dots, slashes, hyphens or brackets between them, optionally followed by an extension
 * ("+381 60 123 4567", "(011) 222-333", "021/456-789 ext. 12"). Letters elsewhere are refused, so
 * "abc123!!" never becomes a "tel:123" link. The frontend's checkPhone uses the same rule.
 */
const PHONE = /^\+?[\d\s()./-]+(?:\s*(?:ext\.?|x)\s*\d{1,6})?$/i;

export function phoneValid(phone: string): boolean {
  const main = phone.replace(/\s*(?:ext\.?|x)\s*\d{1,6}$/i, '');
  return PHONE.test(phone) && (main.match(/\d/g)?.length ?? 0) >= 5;
}

export const PHONE_MESSAGE = 'Enter a phone number such as +381 60 123 4567: digits, spaces and + ( ) - . /';
