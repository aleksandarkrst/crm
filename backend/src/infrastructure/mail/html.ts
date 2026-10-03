/** Small helpers for the plain HTML emails (inline styles only; mail clients ignore stylesheets). */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A button-styled link. */
export function buttonHtml(label: string, href: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#14503C;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(label)}</a></p>`;
}

/**
 * The Pultly logo (CD-203) at the top of every email. A PNG served by the app (frontend/public),
 * because most mail clients don't show SVG; the alt text stands in when images are blocked.
 */
export function logoHtml(appUrl: string): string {
  const src = `${appUrl.replace(/\/+$/, '')}/email-logo.png`;
  return `<p style="margin:0 0 24px"><img src="${escapeHtml(src)}" width="92" height="28" alt="Pultly" style="display:block;border:0;color:#0D241C;font-weight:600;font-size:18px"></p>`;
}

/** The app's address, from a link into it (the emails that only carry a link). */
export const appOrigin = (link: string): string => new URL(link).origin;

/** Wraps already-escaped body HTML in a minimal, readable page, with the logo on top. */
export function layoutHtml(bodyHtml: string, footer: string, appUrl: string): string {
  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;background:#F5F7F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F1B16;font-size:14px;line-height:1.55">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #E2E8E4;border-radius:10px;padding:28px">',
    logoHtml(appUrl),
    bodyHtml,
    `<p style="margin:28px 0 0;color:#6B7B73;font-size:12px">${escapeHtml(footer)}</p>`,
    '</div></body></html>',
  ].join('\n');
}
