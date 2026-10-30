// AIT-TBC | mail.mjs | Ramesh Konda | 2026-10-28 | Builds the MIME message (.eml) with attachments and inlined CSS; config loader
// Change log:
//   2026-10-28 RK AIT-TBC Initial version
//   2026-10-28 RK AIT-TBC Per-environment config: config/<APP_ENV>.env under .env.local

// Shared by the mail server and the dry-run script so a preview is byte-for-byte the email that would be sent
import { readFileSync, existsSync } from 'node:fs';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import juice from 'juice';
import { htmlToText } from '../shared/emailRender.mjs';

// Minimal KEY=value loader; never overwrites a value that is already set
const loadEnvFile = (file) => {
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return true;
};

export const APP_ENVS = ['dev', 'test', 'prod'];

// Settings precedence, highest first:
//   1. real environment variables (pipeline variables, service settings)
//   2. .env.local on this machine (secrets and local overrides, never committed)
//   3. config/<APP_ENV>.env (committed, no secrets), APP_ENV = dev | test | prod
// APP_ENV comes from the environment, .env.local, config/active-env (build artifacts), else dev.
// Returns the resolved APP_ENV.
export const loadConfig = () => {
  loadEnvFile('.env.local');
  // Build artifacts carry config/active-env (written by the pipeline from the branch)
  const stamped = existsSync('config/active-env') ? readFileSync('config/active-env', 'utf8').trim() : '';
  const appEnv = (process.env.APP_ENV || stamped || 'dev').toLowerCase();
  if (!APP_ENVS.includes(appEnv)) throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')} (got "${appEnv}")`);
  process.env.APP_ENV = appEnv;
  loadEnvFile(`config/${appEnv}.env`);
  return appEnv;
};

// Recipient allow-list (dev/test): comma-separated addresses or @domains. Empty = everyone allowed.
export const isAllowedRecipient = (email, allowList = process.env.SEND_ALLOWLIST || '') => {
  const entries = allowList.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!entries.length) return true;
  const e = String(email).trim().toLowerCase();
  return entries.some(x => (x.startsWith('@') ? e.endsWith(x) : e === x));
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
