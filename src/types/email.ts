import { GenericFAQ } from './faq';

export interface Email {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string | EmailContent;
  contentType?: 'text/plain' | 'text/html';
  receivedAt: string | number;
  sortTimestamp?: number;
  timestamp?: number;
  hasReply?: boolean;
  isReplied?: boolean;
  isNotRelevant?: boolean;
  thread?: Array<{
    id: string;
    sender: string;
    content: string | EmailContent;
    receivedAt: number;
    subject?: string;
  }>;
  analysis?: {
    suggestedQuestions?: string[];
    sentiment?: string;
    keyPoints?: string[];
    concepts?: string[];
    requiresHumanResponse?: boolean;
    reason?: string;
  };
  confidence?: number;
  aiAnalysis?: {
    questions?: Array<{
      question: string;
      category?: string;
      confidence?: number;
    }>;
    timestamp?: number;
  };
  matchedFAQ?: {
    id?: string;
    question: string;
    answer: string;
    confidence: number;
  };
  suggestedReply?: string;
  isGeneratingReply?: boolean;
  showFullContent?: boolean;
  category?: 'support' | 'general' | 'spam';
  status?: 'pending' | 'processed' | 'not_relevant' | 'answered';
  irrelevanceReason?: string;
  emailIds?: string[];
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string;
  contentType?: 'text/plain' | 'text/html';
  receivedAt: number;
}

export interface EmailContent {
  html: string | null;
  text: string | null;
  error?: string;
}

export interface BaseEmail {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  receivedAt: string | number;
  content: string | {
    html: string | null;
    text: string | null;
  };
}

export interface ExtendedEmail extends Email {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string | { html: string | null; text: string | null };
  receivedAt: string | number;
  sortTimestamp?: number;
  isRefreshing?: boolean;
  isGeneratingReply?: boolean;
  matchedFAQ?: {
    question: string;
    answer: string;
    confidence: number;
  };
  suggestedReply?: string;
  isReplied?: boolean;
  isNotRelevant?: boolean;
  status?: 'pending' | 'not_relevant' | 'processed' | 'answered';
  threadMessages?: ThreadMessage[];
  questions?: GenericFAQ[];
  irrelevanceReason?: string;
  gmailError?: string;
  showFullContent?: boolean;
  isNew?: boolean;
}
