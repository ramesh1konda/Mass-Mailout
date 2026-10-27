
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
}

export type Step = 'info' | 'recipients' | 'content' | 'attachments' | 'review';
