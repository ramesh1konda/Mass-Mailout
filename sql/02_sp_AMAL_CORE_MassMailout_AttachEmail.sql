-- AIT-TBC | sp_AMAL_CORE_MassMailout_AttachEmail | Ramesh Konda | 2026-10-28 | Store a Mass Mailout email (.eml) against a loan
-- Change log:
--   2026-10-28 RK AIT-TBC Created. Writes to AMAL_MassMailout_EmailArchive; linking into the CORE loan
--                         document store is a marked TODO until the document table/proc is confirmed.
-- Called by the Mass Mailout mail server (server/core.mjs) once per email.
-- @DryRun = 1 (default) validates and returns what would happen without writing anything.
-- Compat level 110 safe: no STRING_SPLIT / JSON / TRIM / CONCAT_WS.
CREATE OR ALTER PROCEDURE dbo.sp_AMAL_CORE_MassMailout_AttachEmail
    @LoanID          NVARCHAR(50),
    @DocumentTitle   NVARCHAR(255),
    @FileName        NVARCHAR(255),
    @FileContent     VARBINARY(MAX),
    @RecipientEmail  NVARCHAR(320),
    @EmailSubject    NVARCHAR(500),
    @SentAt          DATETIME2(0),
    @SendMode        VARCHAR(10),
    @CampaignName    NVARCHAR(200) = NULL,
    @Debug           BIT           = 0,
    @DryRun          BIT           = 1
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;

    DECLARE @FileHash BINARY(32), @ArchiveID INT, @Action VARCHAR(20), @Message NVARCHAR(500);

    -- 1. Validate input
    SET @LoanID = LTRIM(RTRIM(@LoanID));
    IF @LoanID IS NULL OR @LoanID = N''
        THROW 50001, 'AIT-TBC: @LoanID is required.', 1;
    IF @FileContent IS NULL OR DATALENGTH(@FileContent) = 0
        THROW 50002, 'AIT-TBC: @FileContent is empty.', 1;
    IF @SendMode NOT IN ('sent', 'dry-run')
        THROW 50003, 'AIT-TBC: @SendMode must be ''sent'' or ''dry-run''.', 1;

    -- TODO (AIT-TBC): confirm the loan exists in CORE before storing, e.g.
    --   IF NOT EXISTS (SELECT 1 FROM dbo.<LoanTable> WHERE <LoanNumberColumn> = @LoanID)
    --       THROW 50004, 'AIT-TBC: Loan not found in CORE.', 1;
    -- Left out until the loan table/column is confirmed rather than guessed.

    SET @FileHash = HASHBYTES('SHA2_256', @FileContent);

    -- 2. Idempotent: the same email for the same loan is stored once
    SELECT @ArchiveID = ArchiveID
    FROM dbo.AMAL_MassMailout_EmailArchive
    WHERE LoanID = @LoanID AND FileHash = @FileHash;

    IF @ArchiveID IS NOT NULL
    BEGIN
        SELECT @ArchiveID AS ArchiveID, 'Duplicate' AS Action, CAST(0 AS BIT) AS LoanDocumentLinked,
               N'Already stored for this loan.' AS Message;
        RETURN;
    END;

    IF @DryRun = 1
    BEGIN
        IF @Debug = 1 PRINT 'DryRun: would store ' + CAST(DATALENGTH(@FileContent) AS VARCHAR(20)) + ' bytes for loan ' + @LoanID;
        SELECT CAST(NULL AS INT) AS ArchiveID, 'DryRun' AS Action, CAST(0 AS BIT) AS LoanDocumentLinked,
               N'Dry run: would store "' + @DocumentTitle + N'" (' + CAST(DATALENGTH(@FileContent) AS NVARCHAR(20)) + N' bytes) for loan ' + @LoanID AS Message;
        RETURN;
    END;

    -- 3. Store
    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.AMAL_MassMailout_EmailArchive
            (LoanID, DocumentTitle, FileName, FileContent, FileHash, RecipientEmail, EmailSubject, CampaignName, SendMode, SentAt)
        VALUES
            (@LoanID, @DocumentTitle, @FileName, @FileContent, @FileHash, @RecipientEmail, @EmailSubject, @CampaignName, @SendMode, @SentAt);

        SET @ArchiveID = SCOPE_IDENTITY();

        -- TODO (AIT-TBC): link into the CORE loan document store here, using the existing document
        -- proc/table once confirmed (document type e.g. 'Email correspondence', title = @DocumentTitle,
        -- file = @FileContent or a file-share path). On success:
        --   UPDATE dbo.AMAL_MassMailout_EmailArchive SET LinkedToLoanDocument = 1, LinkedAt = SYSDATETIME() WHERE ArchiveID = @ArchiveID;

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH;

    -- 4. Result
    SELECT ArchiveID, 'Inserted' AS Action, LinkedToLoanDocument AS LoanDocumentLinked,
           N'Stored "' + DocumentTitle + N'" for loan ' + LoanID AS Message
    FROM dbo.AMAL_MassMailout_EmailArchive
    WHERE ArchiveID = @ArchiveID;
END;
GO

-- Verification (UAT)
-- 1. Dry run, writes nothing:
--    EXEC dbo.sp_AMAL_CORE_MassMailout_AttachEmail @LoanID = N'560246', @DocumentTitle = N'560246 - Ramesh Konda',
--         @FileName = N'test.eml', @FileContent = 0x48656C6C6F, @RecipientEmail = N'ramesh.konda@iqeq.com',
--         @EmailSubject = N'Test', @SentAt = '2026-10-28', @SendMode = 'dry-run', @DryRun = 1;
-- 2. Same call with @DryRun = 0 inserts one row; running it again returns Action = 'Duplicate'.
-- 3. Clean up UAT test rows:
--    DELETE FROM dbo.AMAL_MassMailout_EmailArchive WHERE FileName = N'test.eml';
-- Dependent apps: none. The proc only touches AMAL_MassMailout_EmailArchive (xChange, LIXI, EOD and reports are unaffected).
