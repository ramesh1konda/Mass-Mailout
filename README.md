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

### Previewing without the app

`npm run dry-run -- <recipients.csv> <campaign.json> [outDir]` writes `emails.json`, `emails.csv`, `preview.html` and one real `.eml` per recipient in `eml/` with every attachment embedded. It flags invalid or duplicate rows, unresolved `{{tags}}` and blank merge values. In `campaign.json`, `attachments` is a list of file paths relative to the JSON file, and `from` is optional (it defaults to `MAIL_FROM`). Try it with `npm run dry-run -- samples/recipients.csv samples/campaign.json`, which attaches a PDF and a CSV from `samples/attachments/`.
