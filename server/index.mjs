// AIT-TBC | index.mjs | Ramesh Konda | 2026-10-28 | Mail server: SMTP relay (dry run by default), .eml previews, template API, CORE save
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

// Mail relay for MassMailer Pro. The browser can't speak SMTP, so the app posts each
// personalised email here and this server hands it to your SMTP provider via nodemailer.
// Real delivery only happens when SEND_ENABLED=true; otherwise every request is a dry run.
import express from 'express';
import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, isAllowedRecipient, buildMailOptions, buildEml, safeName } from './mail.mjs';
import { createTemplateStore } from './templates.mjs';
import { createCoreArchiver } from './core.mjs';

const APP_ENV = loadConfig();

const env = process.env;
const PORT = Number(env.MAIL_SERVER_PORT || 3001);
const SEND_ENABLED = env.SEND_ENABLED === 'true';
const SEND_DELAY_MS = Number(env.SEND_DELAY_MS || 1000); // min gap between sends, keeps SMTP providers happy
const FROM = env.MAIL_FROM || env.SMTP_USER;
// Dry runs write each email as a real .eml (with attachments) here, one folder per batch
const PREVIEW_DIR = resolve(env.DRY_RUN_DIR || 'dry-run-output');
const core = createCoreArchiver(env);
const templates = createTemplateStore(resolve(env.TEMPLATES_FILE || 'data/templates.json'));

const transporter = SEND_ENABLED
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: env.SMTP_SECURE === 'true', // true for port 465, false for STARTTLS on 587
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let lastSendAt = 0;
const throttle = async () => {
  const wait = lastSendAt + SEND_DELAY_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastSendAt = Date.now();
};

const app = express();
app.use(express.json({ limit: '30mb' }));

app.get('/api/status', (_req, res) => {
  res.json({ appEnv: APP_ENV, sendEnabled: SEND_ENABLED, from: FROM || null, allowList: env.SEND_ALLOWLIST || null, core: core.info() });
});

app.post('/api/send', async (req, res) => {
  const { to, subject, text, html, attachments = [], campaign = 'campaign', batchId = 'batch', index = 0, mergeData = {} } = req.body || {};
  if (!emailRe.test(to || '')) return res.status(400).json({ status: 'failed', error: `Invalid recipient: ${to}` });
  if (!subject) return res.status(400).json({ status: 'failed', error: 'Subject is required' });
  // Live sends only: in dev/test the allow-list keeps real clients out
  if (SEND_ENABLED && !isAllowedRecipient(to)) {
    console.warn(`[BLOCKED] ${to} is not on SEND_ALLOWLIST (${APP_ENV})`);
    return res.status(403).json({ status: 'failed', error: `${to} is not on the ${APP_ENV.toUpperCase()} allow-list (SEND_ALLOWLIST)` });
  }

  // The .eml is built once and used for the preview, the actual send and the CORE copy,
  // so what is stored against the loan is byte-for-byte what the client received
  const options = buildMailOptions({ from: FROM || 'dry-run@localhost', to, subject, text, html, attachments });
  const fileName = `${String(index + 1).padStart(4, '0')}_${safeName(to)}.eml`;
  let eml;
  try { eml = await buildEml(options); } catch (err) { return res.status(500).json({ status: 'failed', error: err.message }); }

  let result;
  if (!SEND_ENABLED) {
    try {
      const batch = safeName(`${campaign}_${batchId}`);
      mkdirSync(join(PREVIEW_DIR, batch), { recursive: true });
      writeFileSync(join(PREVIEW_DIR, batch, fileName), eml);
      console.log(`[DRY RUN] ${to} | ${subject} | ${attachments.length} attachment(s) -> ${join(PREVIEW_DIR, batch, fileName)}`);
      result = { status: 'dry-run', preview: `/api/preview/${encodeURIComponent(batch)}/${encodeURIComponent(fileName)}` };
    } catch (err) {
      console.error(`[DRY RUN FAILED] ${to} | ${err.message}`);
      return res.status(500).json({ status: 'failed', error: err.message });
    }
  } else {
    try {
      await throttle();
      const info = await transporter.sendMail({ envelope: { from: FROM, to: [to] }, raw: eml });
      console.log(`[SENT] ${to} | ${info.messageId}`);
      result = { status: 'sent', messageId: info.messageId };
    } catch (err) {
      console.error(`[FAILED] ${to} | ${err.message}`);
      return res.status(502).json({ status: 'failed', error: err.message });
    }
  }

  // A CORE failure never undoes the send; it is reported per email so it can be followed up
  if (core.appliesTo(result.status)) {
    result.core = await core.archive({ mergeData, eml, fileName, to, subject, sendStatus: result.status, campaign });
    console.log(`[CORE ${result.core.status.toUpperCase()}] ${to} | ${result.core.error || result.core.message}`);
  }
  res.json(result);
});

// Email templates (Admin tab)
app.get('/api/templates', (_req, res) => res.json(templates.list()));
app.post('/api/templates', (req, res) => res.status(201).json(templates.create(req.body || {})));
app.put('/api/templates/:id', (req, res) => {
  const t = templates.update(req.params.id, req.body || {});
  t ? res.json(t) : res.status(404).json({ error: 'Template not found' });
});
app.delete('/api/templates/:id', (req, res) => {
  templates.remove(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'Template not found' });
});

// Download a dry-run .eml; double-click it to open in Outlook/Mail exactly as the recipient would see it
app.get('/api/preview/:batch/:file', (req, res) => {
  const batch = safeName(req.params.batch);
  const file = safeName(req.params.file);
  const path = join(PREVIEW_DIR, batch, file);
  if (!file.endsWith('.eml') || !existsSync(path)) return res.status(404).send('Preview not found');
  res.download(path, file, { headers: { 'Content-Type': 'message/rfc822' } });
});

const start = async () => {
  console.log(`Environment: ${APP_ENV.toUpperCase()} (config/${APP_ENV}.env + .env.local)`);
  if (APP_ENV !== 'prod' && SEND_ENABLED && !env.SEND_ALLOWLIST) {
    console.error(`SEND_ENABLED=true in ${APP_ENV.toUpperCase()} needs SEND_ALLOWLIST (e.g. @iqeq.com) so real clients can't be emailed from a non-prod environment.`);
    process.exit(1);
  }
  if (SEND_ENABLED) {
    if (!env.SMTP_HOST || !FROM) {
      console.error('SEND_ENABLED=true needs SMTP_HOST and MAIL_FROM (or SMTP_USER).');
      process.exit(1);
    }
    if (!/[^\s@<>]+@[^\s@<>]+/.test(FROM)) {
      console.error(`MAIL_FROM "${FROM}" has no email address. Use e.g. MAIL_FROM="Your Name <you@example.com>".`);
      process.exit(1);
    }
    await transporter.verify();
    console.log(`SMTP OK (${env.SMTP_HOST}). REAL sending is ON from ${FROM}.`);
  } else {
    if (FROM && !/[^\s@<>]+@[^\s@<>]+/.test(FROM)) console.warn(`WARNING: MAIL_FROM "${FROM}" has no email address, so previews will have no From line and a real send would fail.`);
    console.log(`SEND_ENABLED is not "true": dry-run mode, no email will be sent. Previews (.eml) go to ${PREVIEW_DIR}`);
  }
  if (core.enabled) {
    const db = await core.verify();
    const { procDryRun, attachDryRuns } = core.info();
    console.log(`CORE attach ON: ${db.Srv}/${db.Db}${procDryRun ? ' (dry run: nothing is written)' : ' (WRITING loan documents)'}${attachDryRuns ? ', including dry-run emails' : ', live sends only'}`);
  }
  app.listen(PORT, () => console.log(`Mail server listening on http://localhost:${PORT}`));
};

start().catch(err => { console.error(`Startup check failed: ${err.message}`); process.exit(1); });
