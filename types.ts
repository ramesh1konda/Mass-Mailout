
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
  core?: { status: 'attached' | 'dry-run' | 'duplicate' | 'failed'; archiveId?: number | null; message?: string; error?: string }; // copy stored against the loan in CORE

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
