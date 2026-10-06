/**
 * Checks for fields that are saved when they are left (CD-224, B10): a company's domain and a
 * contact's LinkedIn. Each returns the value to save (cleaned up) and a hint about the cleanup, or
 * an error to show under the field; an invalid value is not saved. Empty is always fine (clears it).
 */
export type Checked = { ok: true; value: string; hint?: string } | { ok: false; error: string };

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * A domain is a host name: letters, digits, hyphens and dots, ending in a top-level domain
 * ("acme.com", "shop.acme.co.uk"). A pasted address keeps only its host: "https://www.acme.com/about"
 * becomes "www.acme.com", with a hint saying so.
 */
export function checkDomain(input: string): Checked {
  const raw = input.trim();
  if (!raw) return { ok: true, value: '' };
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!HOSTNAME.test(host)) return { ok: false, error: 'Enter a domain such as acme.com: letters, digits, hyphens and dots.' };
  return host === raw.toLowerCase() ? { ok: true, value: host } : { ok: true, value: host, hint: `Saved as ${host}` };
}

const LINKEDIN_URL = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/[^\s]+$/i;
const LINKEDIN_PATH = /^\/?(?:in|company|pub|school|showcase)\/[^\s/]+\/?$/i;

/**
 * A LinkedIn profile is a linkedin.com address ("linkedin.com/in/ana", "https://www.linkedin.com/company/acme")
 * or a profile path ("in/ana", which is saved as "linkedin.com/in/ana").
 */
export function checkLinkedin(input: string): Checked {
  const raw = input.trim();
  if (!raw) return { ok: true, value: '' };
  if (LINKEDIN_URL.test(raw)) return { ok: true, value: raw };
  if (LINKEDIN_PATH.test(raw)) {
    const value = 'linkedin.com/' + raw.replace(/^\//, '');
    return { ok: true, value, hint: `Saved as ${value}` };
  }
  return { ok: false, error: 'Enter a LinkedIn address such as linkedin.com/in/name.' };
}
