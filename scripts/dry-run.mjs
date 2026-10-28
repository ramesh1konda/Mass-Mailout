// AIT-TBC | dry-run.mjs | Ramesh Konda | 2026-10-28 | Offline campaign preview: personalised .eml per recipient plus preview.html, sends nothing
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

// Dry run: personalises a campaign for every CSV recipient and writes a preview, including one real
// .eml per recipient with all attachments embedded (open it in Outlook to see exactly what would be sent).
// Sends nothing. Usage: node scripts/dry-run.mjs <recipients.csv> <campaign.json> [outDir]
// campaign.json "attachments" are file paths, relative to campaign.json. Optional "template" is a
// template name or id from the Admin tab (data/templates.json); "bodyIsHtml": true treats body as HTML.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { loadEnvLocal, buildMailOptions, buildEml, safeName } from '../server/mail.mjs';
import { createTemplateStore } from '../server/templates.mjs';
import { personalize, findMergeTags, renderEmailHtml } from '../shared/emailRender.mjs';

loadEnvLocal();

const [csvPath, campaignPath, outDir = 'dry-run-output'] = process.argv.slice(2);
if (!csvPath || !campaignPath) {
  console.error('Usage: node scripts/dry-run.mjs <recipients.csv> <campaign.json> [outDir]');
  process.exit(1);
}

// RFC 4180 parser: handles quoted fields, embedded commas, quotes and newlines
const parseCsv = (text) => {
  const rows = []; let row = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim()));
};

const campaign = JSON.parse(readFileSync(campaignPath, 'utf8'));
let template = null;
if (campaign.template) {
  template = createTemplateStore(resolve(process.env.TEMPLATES_FILE || 'data/templates.json')).get(campaign.template);
  if (!template) { console.error(`Template not found: ${campaign.template}`); process.exit(1); }
}
const isHtml = !!template || !!campaign.bodyIsHtml;
const from = campaign.from || process.env.MAIL_FROM || process.env.SMTP_USER || 'dry-run@localhost';

// Load attachments once; every recipient gets the same files
const attachmentFiles = (campaign.attachments ?? []).map(p => {
  const path = resolve(dirname(campaignPath), p);
  if (!existsSync(path)) { console.error(`Attachment not found: ${path}`); process.exit(1); }
  return { name: basename(path), size: statSync(path).size, base64: readFileSync(path).toString('base64') };
});
const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const [rawHeaders, ...dataRows] = parseCsv(readFileSync(csvPath, 'utf8').replace(/^﻿/, ''));
const headers = rawHeaders.map(h => h.trim());
const clean = headers.map(h => h.toLowerCase().replace(/\s+/g, '_'));
const emailIdx = clean.findIndex(h => h.includes('email'));
if (emailIdx === -1) { console.error('Email column not found.'); process.exit(1); }
const nameIdx = clean.findIndex(h => h.includes('name'));

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const seen = new Set();
const emails = []; const skipped = [];

dataRows.forEach((values, n) => {
  const r = {};
  headers.forEach((h, i) => { const v = (values[i] ?? '').trim(); r[h] = v; r[clean[i]] = v; });
  r.email = r[headers[emailIdx]];
  r.name = nameIdx !== -1 && r[headers[nameIdx]] ? r[headers[nameIdx]] : r.email;
  const line = n + 2;
  const key = r.email.toLowerCase();
  if (!emailRe.test(r.email)) return skipped.push({ line, email: r.email, reason: 'invalid email' });
  if (seen.has(key)) return skipped.push({ line, email: r.email, reason: 'duplicate' });
  seen.add(key);
  const subject = personalize(campaign.subject, r);
  const body = personalize(campaign.body, r);
  const html = isHtml ? renderEmailHtml({ template, body: campaign.body, bodyIsHtml: !!campaign.bodyIsHtml, data: r }) : undefined;
  const allText = [campaign.subject, campaign.body, template?.headerHtml, template?.footerHtml].join('\n');
  const unresolved = findMergeTags(`${subject}\n${html ?? body}`);
  const blank = findMergeTags(allText).filter(t => !unresolved.includes(t) && personalize(t, r) === '');
  emails.push({ to: r.email, name: r.name, subject, body, html, attachments: attachmentFiles.map(a => a.name), unresolved, blank });
});

mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'eml'), { recursive: true, force: true });
mkdirSync(join(outDir, 'eml'));
for (const [i, e] of emails.entries()) {
  e.eml = `eml/${String(i + 1).padStart(4, '0')}_${safeName(e.to)}.eml`;
  const eml = await buildEml(buildMailOptions({ from, to: `"${e.name.replace(/"/g, '')}" <${e.to}>`, subject: e.subject, text: e.html ? undefined : e.body, html: e.html, attachments: attachmentFiles }));
  writeFileSync(join(outDir, e.eml), eml);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const csvCell = s => `"${String(s).replace(/"/g, '""')}"`;

writeFileSync(join(outDir, 'emails.json'), JSON.stringify({ campaign: campaign.name, template: template?.name ?? null, generatedAt: new Date().toISOString(), emails, skipped }, null, 2));
writeFileSync(join(outDir, 'emails.csv'),
  ['to,name,subject,body,unresolved_tags', ...emails.map(e => [e.to, e.name, e.subject, e.body, e.unresolved.join(' ')].map(csvCell).join(','))].join('\n'));
writeFileSync(join(outDir, 'preview.html'), `<!doctype html><meta charset="utf-8"><title>${esc(campaign.name)} dry run</title>
<style>body{font-family:system-ui;max-width:800px;margin:2rem auto;padding:0 1rem}article{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}pre{white-space:pre-wrap;font-family:inherit}.warn{color:#b00}</style>
<h1>${esc(campaign.name)}: dry run</h1><p>${emails.length} emails ready, ${skipped.length} rows skipped. Nothing was sent.<br>From: ${esc(from)}${attachmentFiles.length ? `<br>Attachments on every email: ${esc(attachmentFiles.map(a => `${a.name} (${fmtSize(a.size)})`).join(', '))}` : ''}<br>Click "Open .eml" to see an email exactly as it would arrive, attachments included.</p>
${skipped.length ? `<ul class="warn">${skipped.map(s => `<li>Line ${s.line} (${esc(s.email || 'blank')}): ${s.reason}</li>`).join('')}</ul>` : ''}
${emails.map(e => `<article><b>To:</b> ${esc(e.name)} &lt;${esc(e.to)}&gt; &middot; <a href="${esc(e.eml)}" download>Open .eml</a><br><b>Subject:</b> ${esc(e.subject)}${e.attachments.length ? `<br><b>Attachments:</b> ${esc(e.attachments.join(', '))}` : ''}${e.unresolved.length ? `<p class="warn">Unresolved tags: ${esc(e.unresolved.join(' '))}</p>` : ''}${e.blank.length ? `<p class="warn">Blank values for: ${esc(e.blank.join(' '))}</p>` : ''}${e.html ? `<iframe sandbox="" style="width:100%;height:420px;border:1px solid #eee" srcdoc="${esc(e.html)}"></iframe>` : `<pre>${esc(e.body)}</pre>`}</article>`).join('')}`);

console.log(`Dry run complete: ${emails.length} emails (.eml with ${attachmentFiles.length} attachment(s) each), ${skipped.length} skipped -> ${outDir}/`);
skipped.forEach(s => console.log(`  skipped line ${s.line} (${s.email || 'blank'}): ${s.reason}`));
const unres = emails.filter(e => e.unresolved.length);
if (unres.length) console.log(`  ${unres.length} emails have unresolved tags, e.g. ${unres[0].unresolved.join(' ')}`);
emails.filter(e => e.blank.length).forEach(e => console.log(`  ${e.to}: blank value for ${e.blank.join(' ')}`));
