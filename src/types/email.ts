export interface Email {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  content: string;
  receivedAt: string;
  timestamp?: string;
  hasReply?: boolean;
  isReplied?: boolean;
  isNotRelevant?: boolean;
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