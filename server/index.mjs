// Mail relay for MassMailer Pro. The browser can't speak SMTP, so the app posts each
// personalised email here and this server hands it to your SMTP provider via nodemailer.
// Real delivery only happens when SEND_ENABLED=true; otherwise every request is a dry run.
import express from 'express';
import nodemailer from 'nodemailer';
import { readFileSync, existsSync } from 'node:fs';

// Minimal .env.local loader so the server shares the Vite env file
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = process.env;
const PORT = Number(env.MAIL_SERVER_PORT || 3001);
const SEND_ENABLED = env.SEND_ENABLED === 'true';
const SEND_DELAY_MS = Number(env.SEND_DELAY_MS || 1000); // min gap between sends, keeps SMTP providers happy
const FROM = env.MAIL_FROM || env.SMTP_USER;

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
  res.json({ sendEnabled: SEND_ENABLED, from: FROM || null });
});

app.post('/api/send', async (req, res) => {
  const { to, subject, text, attachments = [] } = req.body || {};
  if (!emailRe.test(to || '')) return res.status(400).json({ status: 'failed', error: `Invalid recipient: ${to}` });
  if (!subject) return res.status(400).json({ status: 'failed', error: 'Subject is required' });

  if (!SEND_ENABLED) {
    console.log(`[DRY RUN] ${to} | ${subject} | ${attachments.length} attachment(s)`);
    return res.json({ status: 'dry-run' });
  }

  try {
    await throttle();
    const info = await transporter.sendMail({
      from: FROM,
      to,
      subject,
      text,
      // App sends data URLs ("data:<mime>;base64,<data>"); nodemailer wants the raw base64
      attachments: attachments.map(a => ({
        filename: a.name,
        content: String(a.base64).replace(/^data:[^,]*,/, ''),
        encoding: 'base64',
      })),
    });
    console.log(`[SENT] ${to} | ${info.messageId}`);
    res.json({ status: 'sent', messageId: info.messageId });
  } catch (err) {
    console.error(`[FAILED] ${to} | ${err.message}`);
    res.status(502).json({ status: 'failed', error: err.message });
  }
});

const start = async () => {
  if (SEND_ENABLED) {
    if (!env.SMTP_HOST || !FROM) {
      console.error('SEND_ENABLED=true needs SMTP_HOST and MAIL_FROM (or SMTP_USER).');
      process.exit(1);
    }
    await transporter.verify();
    console.log(`SMTP OK (${env.SMTP_HOST}). REAL sending is ON from ${FROM}.`);
  } else {
    console.log('SEND_ENABLED is not "true": running in dry-run mode, no email will be sent.');
  }
  app.listen(PORT, () => console.log(`Mail server listening on http://localhost:${PORT}`));
};

start().catch(err => { console.error(`SMTP check failed: ${err.message}`); process.exit(1); });
