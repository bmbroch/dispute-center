import { GenericFAQ } from './faq';

export interface Email {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string | EmailContent;
  receivedAt: string;
  timestamp?: string;
  hasReply?: boolean;
  isReplied?: boolean;
  isNotRelevant?: boolean;
  thread?: Array<{
    id: string;
    sender: string;
    content: string | EmailContent;
    receivedAt: string;
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
    confidence?: number;
  };
  suggestedReply?: string;
  isGeneratingReply?: boolean;
  showFullContent?: boolean;
  category?: 'support' | 'general' | 'spam';
  status?: 'pending' | 'processed' | 'replied';
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
  content: string | EmailContent;
  receivedAt: string | number;
}

export interface ExtendedEmail extends BaseEmail {
  status?: 'pending' | 'processed' | 'replied' | 'removed_from_ready' | 'not_relevant';
  matchedFAQ?: {
    question: string;
    answer: string;
    confidence?: number;
  };
  questions?: GenericFAQ[];
  suggestedReply?: string;
  showFullContent?: boolean;
  isGeneratingReply?: boolean;
  isNotRelevant?: boolean;
  isReplied?: boolean;
  isMovingToReady?: boolean;
  irrelevanceReason?: string;
  irrelevanceCategory?: string;
  irrelevanceConfidence?: number;
  irrelevanceDetails?: string;
  threadMessages?: ThreadMessage[];
  gmailError?: {
    message: string;
    details?: any;
  };
  content: string | {
    html: string | null;
    text: string | null;
  };
  sortTimestamp?: number;
}
