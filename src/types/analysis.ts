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
  threadId?: string;
  messages?: Array<{
    subject: string;
    from: string;
    body: string;
    date: string;
  }>;
  isCustomer?: boolean;
  confidence?: number;
  reason?: string;
  category?: string;
  priority?: number;
  hasUserReply?: boolean;
}

export interface FAQ {
  question: string;
  typicalAnswer: string;
  frequency: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CustomerSentiment {
  overall: string;
  details: string;
}

export interface CommonQuestion {
  question: string;
  typicalAnswer: string;
  frequency: number;
}

export interface AIInsights {
  keyPoints: string[];
  keyCustomerPoints: string[];
  commonQuestions: CommonQuestion[];
  customerSentiment: CustomerSentiment;
  recommendedActions: string[];
}

export interface SavedEmailAnalysis {
  id: string;
  timestamp: number;
  totalEmails: number;
  totalEmailsAnalyzed: number;
  supportEmails: any[];
  emails: EmailData[];
  tokenUsage: TokenUsage;
  aiInsights: AIInsights;
}

export interface AnalysisResult {
  id: string;
  timestamp: number;
  totalEmails: number;
  totalEmailsAnalyzed: number;
  emails: any[];
  supportEmails: any[];
  tokenUsage: TokenUsage;
  aiInsights: AIInsights;
}

export interface ModelOption {
  value: string;
  label: string;
  logo: string;
  description: string;
  speed: string;
  reliability: string;
}

export interface EmailCountOption {
  value: number;
  label: string;
  icon: string;
  description: string;
}

export interface ProcessingStatus {
  stage: 'idle' | 'fetching_emails' | 'filtering' | 'analyzing' | 'complete';
  progress: number;
  currentEmail?: number;
  totalEmails?: number;
}

export interface DebugLog {
  timestamp: string;
  stage: string;
  data: any;
} 