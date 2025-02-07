export interface ThreadSummary {
  subject: string;
  content: string;
  sentiment: string;
  key_points: string[];
}

export interface EmailData {
  threadId: string;
  subject: string;
  from: string;
  body: string;
  date: string;
  isCustomer?: boolean;
  confidence?: number;
  reason?: string;
  category?: string;
  hasUserReply?: boolean;
  messages?: EmailMessage[];
  contentType?: string;
  snippet?: string;
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

export interface ReplyMetrics {
  totalCustomerThreads: number;
  threadsWithReplies: number;
  responseRate: number;
}

export interface AnalysisResult {
  id: string;
  timestamp: number;
  totalEmails: number;
  totalEmailsAnalyzed: number;
  emails: EmailData[];
  supportEmails: EmailData[];
  tokenUsage: TokenUsage;
  aiInsights: AIInsights;
  responseRate?: number;
  replyMetrics?: ReplyMetrics;
}

export interface SavedEmailAnalysis extends AnalysisResult {
  responseRate: number;
  replyMetrics: ReplyMetrics;
}

export interface EmailMessage {
  subject: string;
  from: string;
  body: string;
  date: string;
  contentType?: string;
  snippet?: string;
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