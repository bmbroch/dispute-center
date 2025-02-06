// Type definition for Gmail API errors
export interface GmailError {
  response?: {
    status: number;
    data?: {
      error: {
        message?: string;
        code?: string;
      };
    };
  };
  message?: string;
}

export interface GmailErrorResponse {
  response?: {
    status: number;
    data?: {
      error?: {
        message?: string;
        code?: number;
      };
    };
  };
  message?: string;
}

export function isGmailError(error: unknown): error is GmailErrorResponse {
  if (typeof error !== 'object' || error === null) return false;
  
  const err = error as Record<string, unknown>;
  if (!err.response && !err.message) return false;
  
  if (err.response) {
    const response = err.response as Record<string, unknown>;
    return typeof response.status === 'number';
  }
  
  return typeof err.message === 'string';
} 