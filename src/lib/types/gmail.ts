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

// Type guard for Gmail API errors
export function isGmailError(error: unknown): error is GmailError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as GmailError).response === 'object'
  );
} 