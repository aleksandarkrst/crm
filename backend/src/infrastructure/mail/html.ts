/** Small helpers for the plain HTML emails (inline styles only; mail clients ignore stylesheets). */

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A button-styled link. */
export function buttonHtml(label: string, href: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#14503C;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(label)}</a></p>`;
}

/** Wraps already-escaped body HTML in a minimal, readable page. */
export function layoutHtml(bodyHtml: string, footer: string): string {
  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;background:#F5F7F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F1B16;font-size:14px;line-height:1.55">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #E2E8E4;border-radius:10px;padding:28px">',
    bodyHtml,
    `<p style="margin:28px 0 0;color:#6B7B73;font-size:12px">${escapeHtml(footer)}</p>`,
    '</div></body></html>',
  ].join('\n');
}
