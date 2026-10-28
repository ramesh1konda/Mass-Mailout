// Shared by the browser app, the mail server and the dry-run script so previews match what is sent.
// Plain JS (not TS) so Node can import it without a build step.

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Merge tags: {{column}} and ARMNet-style @Field(column). Column match is case-insensitive.
// Unknown tags are left as-is so they show up in previews.
const TAG_RE = /\{\{\s*([^}]+?)\s*\}\}|@Field\(\s*([^)]+?)\s*\)/gi;

const merge = (text, data, encode) =>
  String(text ?? '').replace(TAG_RE, (tag, a, b) => {
    const key = (a ?? b).toLowerCase();
    const k = Object.keys(data || {}).find(r => r.toLowerCase() === key);
    return k !== undefined ? encode(data[k]) : tag;
  });

export const personalize = (text, data) => merge(text, data, v => String(v ?? ''));
// For HTML: merged values are escaped so a "<" or "&" in the CSV can't break the markup
export const personalizeHtml = (html, data) => merge(html, data, escapeHtml);

export const findMergeTags = (text) => [...new Set(String(text ?? '').match(TAG_RE) ?? [])];

// Plain-text body -> paragraphs, line breaks kept
export const textToHtml = (text) =>
  String(text ?? '').split(/\r?\n\s*\r?\n/).filter(p => p.trim())
    .map(p => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`).join('\n');

// Rough HTML -> text for the plain-text alternative part
export const htmlToText = (html) =>
  String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a\s[^>]*href="mailto:([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();

export const DEFAULT_TEMPLATE = {
  id: 'default',
  name: 'Default',
  css: `body { font-family: calibri, arial, sans-serif; font-size: 14px; color: #1f2937; }
p { margin: 0 0 12px; }
.header { padding: 16px 0; border-bottom: 3px solid #2563eb; margin-bottom: 20px; }
.footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
a { color: #2563eb; }`,
  headerHtml: `<div class="header"><strong style="font-size:20px">Your Company</strong></div>`,
  footerHtml: `<div class="footer">
  <p>Regards,<br>Your Company</p>
  <p>This email was sent to {{email}}.</p>
</div>`,
};

// Full HTML document for one recipient. template may be null (body only).
export const renderEmailHtml = ({ template, body, bodyIsHtml, data }) => {
  const bodyHtml = bodyIsHtml ? personalizeHtml(body, data) : textToHtml(personalize(body, data));
  const t = template || {};
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${t.css ? `<style>\n${t.css}\n</style>` : ''}
</head>
<body>
${personalizeHtml(t.headerHtml || '', data)}
${bodyHtml}
${personalizeHtml(t.footerHtml || '', data)}
</body>
</html>`;
};
