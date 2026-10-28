// Shared by the mail server and the dry-run script so a preview is byte-for-byte the email that would be sent
import { readFileSync, existsSync } from 'node:fs';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import juice from 'juice';
import { htmlToText } from '../shared/emailRender.mjs';

// Minimal .env.local loader so Node tools share the Vite env file
export const loadEnvLocal = (file = '.env.local') => {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
};

// attachments: [{ name, base64 }] where base64 may be a data URL ("data:<mime>;base64,<data>")
// html (optional): full HTML document. Its <style> rules are inlined because Outlook and many
// webmail clients ignore or strip <head> styles; a plain-text part is derived when text is missing.
export const buildMailOptions = ({ from, to, subject, text, html, attachments = [] }) => ({
  from,
  to,
  subject,
  text: text || (html ? htmlToText(html) : ''),
  ...(html ? { html: juice(html) } : {}),
  attachments: attachments.map(a => ({
    filename: a.name,
    content: String(a.base64).replace(/^data:[^,]*,/, ''),
    encoding: 'base64',
  })),
});

// Full RFC 822 message (.eml) that Outlook, Thunderbird or Apple Mail can open
export const buildEml = (options) =>
  new Promise((resolve, reject) =>
    new MailComposer(options).compile().build((err, msg) => (err ? reject(err) : resolve(msg))));

// Safe file/folder name: keeps letters, digits, dot, dash, underscore and @
export const safeName = (s) => String(s).replace(/[^\w.@-]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'untitled';
