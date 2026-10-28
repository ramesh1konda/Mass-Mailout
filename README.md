<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1uBIyc7k-FdY9VdJ4bQ2m9oskSMPRtx91

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Sending a campaign

The browser can't send email itself, so a small mail server (`server/index.mjs`, Express + nodemailer) relays each personalised email to your SMTP provider. The Vite dev server proxies `/api` to it.

1. Copy `.env.example` to `.env.local` and fill in the SMTP settings. For Gmail or Google Workspace, use an [App Password](https://myaccount.google.com/apppasswords).
2. Start the mail server: `npm run server`
3. In a second terminal, start the app: `npm run dev`

**Real sending is off by default.** With `SEND_ENABLED=false` (or unset) nothing is sent. Instead the server builds each email exactly as it would send it, attachments included, and saves it as a `.eml` file in `dry-run-output/<campaign>_<timestamp>/` (change the folder with `DRY_RUN_DIR`). In History, click **preview .eml** next to any email to download it, then double-click it to open it in Outlook or Mail. Set `SEND_ENABLED=true` and restart the server to send for real. The server checks the SMTP login at startup, the Review step shows a red "LIVE" banner, and both Launch and Test Send ask for confirmation before sending. `SEND_DELAY_MS` sets the minimum gap between sends (default 1000 ms).

CSV uploads skip rows with invalid or duplicate emails, and quoted fields (e.g. `"Acme, Inc."`) are parsed correctly. History shows each email's status: sent, dry-run, or failed.

### HTML email templates (Admin)

Click **Admin** in the header to design reusable email templates. Each one has:

- **Styles (CSS)**, e.g. `body { font-family: calibri, arial, sans-serif; }`
- **Header (HTML)**, e.g. a logo `<img src="https://...">`
- **Footer (HTML)**, e.g. "Regards," and a footer banner image

A live preview updates as you type. Templates are saved by the mail server in `data/templates.json`, which git ignores (change the path with `TEMPLATES_FILE`).

In the campaign's Template step, pick a **Design template** and tick **Body is HTML** if the body contains HTML. The email is sent as HTML with a plain-text fallback, and the CSS is inlined into each element so that Outlook and Gmail keep the styling. Images must use public `https://` URLs.

Merge fields work in the subject, body, header and footer, written as either `{{column}}` or `@Field(column)`. They are matched to CSV column names case-insensitively, and merged values are HTML-escaped.

### Storing sent emails against the loan in CORE

The mail server can save each email against its loan in CORE. The saved copy is the exact `.eml` the client received, attachments included, titled e.g. `560246 - Ramesh Konda` (set by `CORE_DOC_TITLE`). This is off by default.

1. Run `sql/01_AMAL_MassMailout_EmailArchive.sql` and `sql/02_sp_AMAL_CORE_MassMailout_AttachEmail.sql` on **UAT** first.
2. In `.env.local`, set `CORE_ATTACH_ENABLED=true`, `CORE_DB_SERVER` and `CORE_DB_NAME`.
   - `CORE_DB_AUTH=windows` uses your Windows login and needs ODBC Driver 17 or 18.
   - `CORE_DB_AUTH=sql` uses `CORE_DB_USER` and `CORE_DB_PASSWORD`.
3. Restart `npm run server`. It checks that the proc exists and refuses a server or database whose name contains "prod" unless `CORE_ALLOW_PROD=true`.

Safety switches:
- `CORE_DB_DRYRUN=true` (the default) calls the proc with `@DryRun = 1`, which writes nothing. Set it to `false` to store for real.
- Only real sends are stored unless `CORE_ATTACH_DRYRUNS=true`, which is meant for UAT testing.
- A CORE failure never undoes a send. History shows each email's CORE status.

The loan ID comes from the CSV column named in `CORE_LOANID_COLUMN` (default `Loanid`). For now the proc writes to `AMAL_MassMailout_EmailArchive`. Linking each row into the CORE loan document store is marked TODO in the proc, pending confirmation of the document table or proc.

### Previewing without the app

`npm run dry-run -- <recipients.csv> <campaign.json> [outDir]` writes `emails.json`, `emails.csv`, `preview.html` and one real `.eml` per recipient in `eml/` with every attachment embedded. It flags invalid or duplicate rows, unresolved `{{tags}}` and blank merge values. In `campaign.json`, `attachments` is a list of file paths relative to the JSON file, and `from` is optional (it defaults to `MAIL_FROM`). Try it with `npm run dry-run -- samples/recipients.csv samples/campaign.json`, which attaches a PDF and a CSV from `samples/attachments/`. Add `"template": "<name or id>"` and `"bodyIsHtml": true` to use an Admin template, as in `samples/campaign-html.json`.
