import { GenericFAQ } from './faq';

export interface Email {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string | EmailContent;
  receivedAt: number;
  sortTimestamp: number;
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
  status?: 'pending' | 'processed' | 'not_relevant';
  irrelevanceReason?: string;
  emailIds?: string[];
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string;
  receivedAt: number;
}

export interface EmailContent {
  html: string | null;
  text: string | null;
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

export interface ExtendedEmail extends BaseEmail {
  sortTimestamp: number;
  isRefreshing?: boolean;
  isGeneratingReply?: boolean;
  status?: 'pending' | 'processed' | 'not_relevant';
  matchedFAQ?: {
    question: string;
    answer: string;
    confidence: number;
  };
  suggestedReply?: string;
  isReplied?: boolean;
  isNotRelevant?: boolean;
  questions?: GenericFAQ[];
  threadMessages?: ThreadMessage[];
  showFullContent?: boolean;
  irrelevanceReason?: string;
  irrelevanceCategory?: string;
  irrelevanceConfidence?: number;
  irrelevanceDetails?: string;
  gmailError?: {
    message: string;
    details?: any;
  };
  content: string | {
    html: string | null;
    text: string | null;
  };
}
