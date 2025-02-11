import { Email } from './email';

export type { Email };

export interface PotentialFAQ {
  id: string;
  question: string;
  source: {
    emailId: string;
    subject: string;
    sender: string;
  };
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface GenericFAQ {
  question: string;
  answer?: string;
  category: string;
  emailIds?: string[];
  confidence: number;
  requiresCustomerSpecificInfo: boolean;
  similarPatterns?: string[];
}

export interface FAQ {
  id?: string;
  question: string;
  answer: string;
  category?: string;
  relatedEmailIds?: string[];
  updatedAt: string;
  createdAt: string;
  useCount: number;
  confidence: number;
  instructions?: string;
  replyTemplate?: string;
  emailIds?: string[];
  requiresCustomerSpecificInfo?: boolean;
}

export interface IrrelevanceAnalysis {
  reason: string;
  category: 'spam' | 'personal' | 'automated' | 'internal' | 'too_specific' | 'other';
  confidence: number;
  details: string;
}

export interface PendingAutoReply {
  id: string;
  originalEmail: {
    from: string;
    subject: string;
    body: string;
    receivedAt: string;
    threadId: string;
    hasImages: boolean;
    date: string;
  };
  matchedFAQ?: FAQ;
  generatedReply: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
  createdAt: string;
  updatedAt: string;
  requiresHumanResponse?: boolean;
  reason?: string;
}

export interface EmailSimulationResult {
  matches: Array<{
    faq?: FAQ;
    confidence: number;
    suggestedReply: string;
  }>;
  requiresHumanResponse: boolean;
  reason: string;
  analysis: {
    sentiment: string;
    keyPoints: string[];
    concepts?: string[];
  };
}

export interface EmailAnalysis {
  threadId: string;
  timestamp: string;
  analysis: {
    suggestedQuestions: GenericFAQ[];
    sentiment: string;
    keyPoints: string[];
    concepts?: string[];
    requiresHumanResponse?: boolean;
    reason?: string;
  };
  matchedFAQ?: FAQ;
  confidence?: number;
  generatedReply?: string;
}

export interface EmailAnalysisCache {
  [threadId: string]: EmailAnalysis;
} 