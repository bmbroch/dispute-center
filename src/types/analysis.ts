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
  emails: Array<any>; // You might want to define a more specific type for emails
  totalEmails: number;
  totalEmailsAnalyzed: number;
  supportEmails: Array<any>; // You might want to define a more specific type for support emails
  tokenUsage: TokenUsage;
  aiInsights: AIInsights;
} 