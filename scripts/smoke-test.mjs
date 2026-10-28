// AIT-TBC | smoke-test.mjs | Ramesh Konda | 2026-10-28 | CI smoke test: starts the mail server in dry-run mode and checks its API
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

// Never sends email: SEND_ENABLED and CORE_ATTACH_ENABLED are forced off for the child server.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 3901;
const work = mkdtempSync(join(tmpdir(), 'massmailout-smoke-'));
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    SEND_ENABLED: 'false',
    CORE_ATTACH_ENABLED: 'false',
    MAIL_SERVER_PORT: String(port),
    MAIL_FROM: 'Smoke Test <smoke@example.com>',
    DRY_RUN_DIR: join(work, 'out'),
    TEMPLATES_FILE: join(work, 'templates.json'),
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const base = `http://localhost:${port}`;
const check = (cond, msg) => { if (!cond) throw new Error(msg); console.log(`ok - ${msg}`); };

try {
  for (let i = 0; ; i++) {
    try { await fetch(`${base}/api/status`); break; } catch { if (i > 50) throw new Error('server did not start'); await new Promise(r => setTimeout(r, 200)); }
  }
  const status = await (await fetch(`${base}/api/status`)).json();
  check(status.sendEnabled === false, 'status reports dry-run mode');

  const templates = await (await fetch(`${base}/api/templates`)).json();
  check(Array.isArray(templates) && templates.length > 0, 'templates endpoint returns the default template');

  const send = await (await fetch(`${base}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: 'client@example.com', subject: 'Smoke 560246', html: '<html><body><p>Dear Client</p></body></html>',
      attachments: [{ name: 'a.txt', base64: Buffer.from('hello').toString('base64') }],
      campaign: 'smoke', batchId: 'ci', mergeData: { Loanid: '560246', Clientname: 'Client' },
    }),
  })).json();
  check(send.status === 'dry-run' && send.preview, 'send returns dry-run with an .eml preview');

  const eml = await (await fetch(`${base}${send.preview}`)).text();
  check(/Subject: Smoke 560246/.test(eml) && /filename=a\.txt/.test(eml), 'preview .eml has the subject and attachment');

  const bad = await fetch(`${base}/api/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'nope', subject: 'x' }) });
  check(bad.status === 400, 'invalid recipient is rejected');
  console.log('Smoke test passed');
} catch (err) {
  console.error(`Smoke test FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
