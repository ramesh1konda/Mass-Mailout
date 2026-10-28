-- AIT-TBC | AMAL_MassMailout_EmailArchive | Ramesh Konda | 2026-10-28 | Staging table for Mass Mailout emails (.eml) stored against a loan
-- Change log:
--   2026-10-28 RK AIT-TBC Created
-- Idempotent: creates the table only if it does not exist. Run on UAT first.
IF OBJECT_ID('dbo.AMAL_MassMailout_EmailArchive', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AMAL_MassMailout_EmailArchive
    (
        ArchiveID           INT IDENTITY(1,1)   NOT NULL CONSTRAINT PK_AMAL_MassMailout_EmailArchive PRIMARY KEY CLUSTERED,
        LoanID              NVARCHAR(50)        NOT NULL,   -- loan number as it appears in the campaign CSV (Loanid column)
        DocumentTitle       NVARCHAR(255)       NOT NULL,   -- e.g. '560246 - Ramesh Konda'
        FileName            NVARCHAR(255)       NOT NULL,   -- e.g. '0001_ramesh.konda@iqeq.com.eml'
        FileContent         VARBINARY(MAX)      NOT NULL,   -- full RFC 822 message incl. attachments
        FileHash            BINARY(32)          NOT NULL,   -- SHA2_256 of FileContent, dedup key
        RecipientEmail      NVARCHAR(320)       NOT NULL,
        EmailSubject        NVARCHAR(500)       NOT NULL,
        CampaignName        NVARCHAR(200)       NULL,
        SendMode            VARCHAR(10)         NOT NULL,   -- 'sent' or 'dry-run'
        SentAt              DATETIME2(0)        NOT NULL,
        LinkedToLoanDocument BIT                NOT NULL CONSTRAINT DF_AMAL_MassMailout_EmailArchive_Linked DEFAULT (0),
        LinkedAt            DATETIME2(0)        NULL,
        LinkError           NVARCHAR(2000)      NULL,
        CreatedAt           DATETIME2(0)        NOT NULL CONSTRAINT DF_AMAL_MassMailout_EmailArchive_CreatedAt DEFAULT (SYSDATETIME()),
        CreatedBy           NVARCHAR(128)       NOT NULL CONSTRAINT DF_AMAL_MassMailout_EmailArchive_CreatedBy DEFAULT (SUSER_SNAME())
    );

    CREATE UNIQUE NONCLUSTERED INDEX UX_AMAL_MassMailout_EmailArchive_Loan_Hash
        ON dbo.AMAL_MassMailout_EmailArchive (LoanID, FileHash);

    CREATE NONCLUSTERED INDEX IX_AMAL_MassMailout_EmailArchive_Unlinked
        ON dbo.AMAL_MassMailout_EmailArchive (LinkedToLoanDocument, ArchiveID)
        WHERE LinkedToLoanDocument = 0;
END;
GO

-- Verification
-- SELECT TOP (20) ArchiveID, LoanID, DocumentTitle, FileName, DATALENGTH(FileContent) AS Bytes, SendMode, SentAt, LinkedToLoanDocument
-- FROM dbo.AMAL_MassMailout_EmailArchive ORDER BY ArchiveID DESC;
