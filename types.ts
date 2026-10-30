// AIT-TBC | types.ts | Ramesh Konda | 2026-10-28 | Shared TypeScript types for campaigns, recipients, sent emails and templates
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

export interface Recipient {
  id: string;
  email: string;
  name: string;
  [key: string]: string;
}

export interface Attachment {
  id: string;
  file: File;
  name: string;
  size: number;
  base64?: string;
}

export interface SentEmail {
  id: string;
  recipientEmail: string;
  personalizedSubject: string;
  personalizedBody: string;
  attachments: { name: string; base64: string }[];
  sentAt: number;
  status: 'sent' | 'dry-run' | 'failed';
  error?: string;
  previewUrl?: string; // dry runs only: download link for the .eml the server wrote
  core?: { status: 'attached' | 'dry-run' | 'failed'; documentName?: string; message?: string; error?: string }; // copy saved to the loan's documents in CORE

}

export interface SentCampaign {
  id: string;
  name: string;
  emails: SentEmail[];
  totalRecipients: number;
  createdAt: number;
}

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  recipients: Recipient[];
  attachments: Attachment[];
  status: 'draft' | 'sending' | 'completed';
  createdAt: number;
  headers: string[]; // Track available CSV columns for merge tags
  templateId: string | null; // null = plain-text email, no template
  bodyIsHtml: boolean;
}

export interface EmailTemplate {
  id: string;
  name: string;
  css: string;
  headerHtml: string;
  footerHtml: string;
  updatedAt?: number;
}

export type Step = 'info' | 'recipients' | 'content' | 'attachments' | 'review';
