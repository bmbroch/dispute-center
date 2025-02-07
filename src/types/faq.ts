export interface FAQ {
  id: string;
  question: string;
  replyTemplate: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
  confidence: number;
  useCount: number;
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
  };
  matchedFAQ: FAQ;
  generatedReply: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
  createdAt: string;
  updatedAt: string;
}

export interface EmailSimulationResult {
  matches: Array<{
    faq: FAQ;
    confidence: number;
    suggestedReply: string;
  }>;
  requiresHumanResponse: boolean;
  reason?: string;
} 