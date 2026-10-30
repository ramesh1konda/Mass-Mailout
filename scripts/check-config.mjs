// AIT-TBC | check-config.mjs | Ramesh Konda | 2026-10-28 | CI check: per-environment config files exist, parse, and hold no secrets
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

// Usage: node scripts/check-config.mjs [env ...]   (default: dev test prod)
import { readFileSync, existsSync } from 'node:fs';

const SECRETS = ['SMTP_USER', 'SMTP_PASS', 'CORE_DB_USER', 'CORE_DB_PASSWORD', 'GEMINI_API_KEY', 'API_KEY'];
const known = new Set(readFileSync(".env.example", "utf8").split(/\r?\n/).map(l => l.match(/^\s*#?\s*([A-Z0-9_]+)\s*=/)?.[1]).filter(Boolean));
const envs = process.argv.slice(2).length ? process.argv.slice(2) : ['dev', 'test', 'prod'];
let failed = false;
const fail = (msg) => { console.error(`FAIL - ${msg}`); failed = true; };

for (const env of envs) {
  const file = `config/${env}.env`;
  if (!existsSync(file)) { fail(`${file} is missing`); continue; }
  const values = {};
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) return fail(`${file}:${i + 1} is not KEY=value`);
    values[m[1]] = m[2];
    if (SECRETS.includes(m[1]) && m[2]) fail(`${file}:${i + 1} sets secret ${m[1]}; secrets belong in .env.local or a secret pipeline variable`);
    if (!known.has(m[1])) fail(`${file}:${i + 1} unknown setting ${m[1]} (add it to .env.example)`);
  });
  if (env !== 'prod' && values.CORE_ALLOW_PROD === 'true') fail(`${file} must not set CORE_ALLOW_PROD=true`);
  if (env !== 'prod' && values.SEND_ENABLED === 'true' && !values.SEND_ALLOWLIST) fail(`${file} enables sending without SEND_ALLOWLIST`);
  if (!failed) console.log(`ok - ${file} (${Object.keys(values).length} settings, no secrets)`);
}
process.exit(failed ? 1 : 0);
