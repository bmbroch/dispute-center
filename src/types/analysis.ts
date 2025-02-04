export interface ThreadSummary {
  subject: string;
  content: string;
  sentiment: string;
  key_points: string[];
}

export interface EmailData {
  subject: string;
  from: string;
  body: string;
  date: string;
  summary: ThreadSummary | null;
  isSupport: boolean;
  confidence: number;
  reason: string;
  fullData?: {
    subject: string;
    from: string;
    body: string;
    date: string;
  };
}

export interface FAQ {
  question: string;
  typicalAnswer: string;
  frequency: number;
}

export interface TokenUsage {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

export interface CustomerSentiment {
  overall: string;
  details: string;
}

export interface AIInsights {
  keyPoints: Array<string>;
  keyCustomerPoints: Array<string>;
  commonQuestions: Array<FAQ>;
  suggestedActions: Array<string>;
  recommendedActions: Array<string>;
  customerSentiment: CustomerSentiment;
}

export interface SavedEmailAnalysis {
  id: string;
  timestamp: number;
  emails: Array<EmailData>;
  totalEmails: number;
  totalEmailsAnalyzed: number;
  supportEmails: Array<EmailData>;
  tokenUsage: TokenUsage;
  aiInsights: AIInsights;
} 