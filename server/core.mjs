// CORE (ARMNet) connector: after an email is sent, store its .eml against the loan by calling
// a stored procedure (default dbo.sp_AMAL_CORE_MassMailout_AttachEmail, see sql/).
// Off unless CORE_ATTACH_ENABLED=true. The proc runs with @DryRun = 1 unless CORE_DB_DRYRUN=false.
import sql from 'mssql';
import { personalize } from '../shared/emailRender.mjs';

export const createCoreArchiver = (env) => {
  const enabled = env.CORE_ATTACH_ENABLED === 'true';
  const config = {
    server: env.CORE_DB_SERVER,
    database: env.CORE_DB_NAME,
    proc: env.CORE_ATTACH_PROC || 'dbo.sp_AMAL_CORE_MassMailout_AttachEmail',
    procDryRun: env.CORE_DB_DRYRUN !== 'false',
    attachDryRuns: env.CORE_ATTACH_DRYRUNS === 'true', // also store dry-run emails (UAT testing)
    loanIdColumn: env.CORE_LOANID_COLUMN || 'Loanid',
    titleTemplate: env.CORE_DOC_TITLE || '{{Loanid}} - {{Clientname}}',
  };
  let pool = null;

  const connect = async () => {
    if (pool) return pool;
    const base = {
      server: config.server,
      database: config.database,
      options: {
        encrypt: env.CORE_DB_ENCRYPT !== 'false',
        trustServerCertificate: env.CORE_DB_TRUST_CERT === 'true',
      },
      pool: { max: 2 },
      requestTimeout: 60000,
    };
    if ((env.CORE_DB_AUTH || 'windows') === 'windows') {
      // Integrated security needs the native driver (Windows + ODBC Driver 17/18)
      const { default: winSql } = await import('mssql/msnodesqlv8.js');
      const driver = env.CORE_DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
      pool = await new winSql.ConnectionPool({
        ...base,
        driver: 'msnodesqlv8',
        connectionString: `Driver={${driver}};Server=${config.server};Database=${config.database};Trusted_Connection=yes;${base.options.trustServerCertificate ? 'TrustServerCertificate=yes;' : ''}`,
      }).connect();
      pool.__lib = winSql;
    } else {
      pool = await new sql.ConnectionPool({ ...base, user: env.CORE_DB_USER, password: env.CORE_DB_PASSWORD }).connect();
      pool.__lib = sql;
    }
    return pool;
  };

  // Called once at startup: refuse Prod unless explicitly allowed, check the proc exists
  const verify = async () => {
    if (!enabled) return;
    if (!config.server || !config.database) throw new Error('CORE_ATTACH_ENABLED=true needs CORE_DB_SERVER and CORE_DB_NAME.');
    if (/prod/i.test(`${config.server} ${config.database}`) && env.CORE_ALLOW_PROD !== 'true') {
      throw new Error(`${config.server}/${config.database} looks like production. Set CORE_ALLOW_PROD=true only once UAT is signed off.`);
    }
    const p = await connect();
    const r = await p.request().input('Proc', p.__lib.NVarChar(256), config.proc)
      .query('SELECT OBJECT_ID(@Proc) AS Id, DB_NAME() AS Db, @@SERVERNAME AS Srv');
    if (!r.recordset[0].Id) throw new Error(`Stored procedure ${config.proc} not found in ${r.recordset[0].Db}. Run the scripts in sql/ first.`);
    return r.recordset[0];
  };

  const appliesTo = (sendStatus) => enabled && (sendStatus === 'sent' || (sendStatus === 'dry-run' && config.attachDryRuns));

  // Returns { status: 'attached' | 'dry-run' | 'duplicate' | 'failed', archiveId?, message?, error? }
  const archive = async ({ mergeData = {}, eml, fileName, to, subject, sendStatus, campaign }) => {
    const loanKey = Object.keys(mergeData).find(k => k.toLowerCase() === config.loanIdColumn.toLowerCase());
    const loanId = loanKey ? String(mergeData[loanKey]).trim() : '';
    if (!loanId) return { status: 'failed', error: `No ${config.loanIdColumn} value for ${to}` };
    try {
      const p = await connect();
      const T = p.__lib;
      const r = await p.request()
        .input('LoanID', T.NVarChar(50), loanId)
        .input('DocumentTitle', T.NVarChar(255), personalize(config.titleTemplate, mergeData).slice(0, 255))
        .input('FileName', T.NVarChar(255), fileName)
        .input('FileContent', T.VarBinary(T.MAX), Buffer.from(eml))
        .input('RecipientEmail', T.NVarChar(320), to)
        .input('EmailSubject', T.NVarChar(500), String(subject).slice(0, 500))
        .input('SentAt', T.DateTime2(0), new Date())
        .input('SendMode', T.VarChar(10), sendStatus)
        .input('CampaignName', T.NVarChar(200), String(campaign || '').slice(0, 200))
        .input('DryRun', T.Bit, config.procDryRun)
        .execute(config.proc);
      const row = r.recordset?.[0] || {};
      const status = row.Action === 'Inserted' ? 'attached' : row.Action === 'Duplicate' ? 'duplicate' : 'dry-run';
      return { status, archiveId: row.ArchiveID ?? null, message: row.Message };
    } catch (err) {
      return { status: 'failed', error: err.message };
    }
  };

  return {
    enabled,
    info: () => ({ enabled, server: config.server || null, database: config.database || null, procDryRun: config.procDryRun, attachDryRuns: config.attachDryRuns }),
    verify,
    appliesTo,
    archive,
  };
};
