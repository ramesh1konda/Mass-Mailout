// AIT-TBC | core.mjs | Ramesh Konda | 2026-10-28 | CORE (ARMNet) connector: saves each sent .eml to the loan via dbo.sp_PublishSSRSDocs
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

// CORE (ARMNet) connector: after an email is sent, save its .eml to the loan's documents through
// ARMNet's dbo.sp_PublishSSRSDocs, the same proc the TransmitSMS CLR uses for SMS records
// (@ownerGUID, @documentName, @base64Doc, @createdBy). Uses its own connection, outside any transaction.
// Off unless CORE_ATTACH_ENABLED=true; nothing is written while CORE_DB_DRYRUN is not "false".
import sql from 'mssql';
import { personalize } from '../shared/emailRender.mjs';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pad = (n) => String(n).padStart(2, '0');
// Same stamp format as the SMS CLR: dd-MM-yyyy HHmmss
const stamp = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const findKey = (data, column) => Object.keys(data).find(k => k.toLowerCase() === String(column).toLowerCase());

export const createCoreArchiver = (env) => {
  const enabled = env.CORE_ATTACH_ENABLED === 'true';
  const config = {
    server: env.CORE_DB_SERVER,
    database: env.CORE_DB_NAME,
    proc: env.CORE_PUBLISH_PROC || 'dbo.sp_PublishSSRSDocs',
    dryRun: env.CORE_DB_DRYRUN !== 'false',
    attachDryRuns: env.CORE_ATTACH_DRYRUNS === 'true', // also save dry-run emails (UAT testing)
    guidColumn: env.CORE_LOANGUID_COLUMN || 'LoanGUID',
    loanIdColumn: env.CORE_LOANID_COLUMN || 'Loanid',
    // Optional: resolve the GUID from the loan number when the CSV has no LoanGUID column.
    // A single SELECT taking @LoanID and returning the GUID in the first column.
    guidLookupSql: env.CORE_LOANGUID_LOOKUP_SQL || '',
    titleTemplate: env.CORE_DOC_TITLE || '{{Loanid}} - {{Clientname}}',
    createdBy: env.CORE_CREATED_BY || (env.USERDOMAIN && env.USERNAME ? `${env.USERDOMAIN}\\${env.USERNAME}` : 'MassMailout'),
  };
  let pool = null;

  const connect = async () => {
    if (pool) return pool;
    const trustCert = env.CORE_DB_TRUST_CERT === 'true';
    if ((env.CORE_DB_AUTH || 'windows') === 'windows') {
      // Integrated security, like the CLR's ARMNet connection; needs ODBC Driver 17/18 on Windows
      const { default: winSql } = await import('mssql/msnodesqlv8.js');
      const driver = env.CORE_DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
      pool = await new winSql.ConnectionPool({
        driver: 'msnodesqlv8',
        connectionString: `Driver={${driver}};Server=${config.server};Database=${config.database};Trusted_Connection=yes;${trustCert ? 'TrustServerCertificate=yes;' : ''}`,
        pool: { max: 2 },
        requestTimeout: 60000,
      }).connect();
      pool.__lib = winSql;
    } else {
      pool = await new sql.ConnectionPool({
        server: config.server,
        database: config.database,
        user: env.CORE_DB_USER,
        password: env.CORE_DB_PASSWORD,
        options: { encrypt: env.CORE_DB_ENCRYPT !== 'false', trustServerCertificate: trustCert },
        pool: { max: 2 },
        requestTimeout: 60000,
      }).connect();
      pool.__lib = sql;
    }
    return pool;
  };

  // Called once at startup: refuse prod-looking targets unless allowed, check the proc exists
  const verify = async () => {
    if (!enabled) return;
    if (!config.server || !config.database) throw new Error('CORE_ATTACH_ENABLED=true needs CORE_DB_SERVER and CORE_DB_NAME.');
    // Production-looking targets need BOTH APP_ENV=prod and CORE_ALLOW_PROD=true
    if (/prod/i.test(`${config.server} ${config.database}`) && !(env.APP_ENV === 'prod' && env.CORE_ALLOW_PROD === 'true')) {
      throw new Error(`${config.server}/${config.database} looks like production. Only allowed with APP_ENV=prod and CORE_ALLOW_PROD=true.`);
    }
    const p = await connect();
    const r = await p.request().input('Proc', p.__lib.NVarChar(256), config.proc)
      .query('SELECT OBJECT_ID(@Proc) AS Id, DB_NAME() AS Db, @@SERVERNAME AS Srv');
    if (!r.recordset[0].Id) throw new Error(`Stored procedure ${config.proc} not found in ${r.recordset[0].Db}.`);
    return r.recordset[0];
  };

  const appliesTo = (sendStatus) => enabled && (sendStatus === 'sent' || (sendStatus === 'dry-run' && config.attachDryRuns));

  const resolveGuid = async (mergeData) => {
    const guidKey = findKey(mergeData, config.guidColumn);
    if (guidKey && String(mergeData[guidKey]).trim()) return String(mergeData[guidKey]).trim();
    const loanKey = findKey(mergeData, config.loanIdColumn);
    const loanId = loanKey ? String(mergeData[loanKey]).trim() : '';
    if (!loanId) throw new Error(`No ${config.guidColumn} or ${config.loanIdColumn} value`);
    if (!config.guidLookupSql) throw new Error(`No ${config.guidColumn} column in the CSV and CORE_LOANGUID_LOOKUP_SQL is not set`);
    const p = await connect();
    const r = await p.request().input('LoanID', p.__lib.NVarChar(50), loanId).query(config.guidLookupSql);
    const row = r.recordset?.[0];
    const guid = row ? String(Object.values(row)[0] ?? '').trim() : '';
    if (!guid) throw new Error(`Loan ${loanId} not found in CORE`);
    return guid;
  };

  // Returns { status: 'attached' | 'dry-run' | 'failed', documentName?, message?, error? }
  const archive = async ({ mergeData = {}, eml }) => {
    const title = personalize(config.titleTemplate, mergeData).replace(/[\\/:*?"<>|]+/g, '_').trim();
    const documentName = `${title} ${stamp(new Date())}.eml`.slice(0, 500);
    try {
      const ownerGuid = await resolveGuid(mergeData);
      if (!GUID_RE.test(ownerGuid)) throw new Error(`"${ownerGuid}" is not a valid loan GUID`);
      if (config.dryRun) return { status: 'dry-run', documentName, message: `Dry run: would save "${documentName}" to loan ${ownerGuid}` };

      const p = await connect();
      const T = p.__lib;
      await p.request()
        .input('ownerGUID', T.VarChar(50), ownerGuid)
        .input('documentName', T.VarChar(500), documentName)
        .input('base64Doc', T.VarChar(T.MAX), Buffer.from(eml).toString('base64'))
        .input('createdBy', T.VarChar(255), config.createdBy)
        .execute(config.proc);
      return { status: 'attached', documentName, message: `Saved "${documentName}" to loan ${ownerGuid}` };
    } catch (err) {
      return { status: 'failed', documentName, error: err.message };
    }
  };

  return {
    enabled,
    info: () => ({ enabled, server: config.server || null, database: config.database || null, procDryRun: config.dryRun, attachDryRuns: config.attachDryRuns }),
    verify,
    appliesTo,
    archive,
  };
};
