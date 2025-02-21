import { gmail_v1 } from 'googleapis';

/**
 * Extracts the email body content from a Gmail message
 * @param message - The Gmail message object to extract content from
 * @returns Object containing the extracted content, content type, and any extraction errors
 */
export function extractEmailBody(message: gmail_v1.Schema$Message): {
  content: string | null;
  contentType?: 'text/plain' | 'text/html';
  error?: { message: string; details?: any }
} {
  try {
    if (!message.payload) {
      return {
        content: null,
        error: { message: 'No message payload found' }
      };
    }

    // Helper function to find content in message parts
    const findContent = (part: gmail_v1.Schema$MessagePart): { content: string | null; contentType?: 'text/plain' | 'text/html' } => {
      // Check if this part has a body with data
      if (part.body?.data) {
        const contentType = part.mimeType;
        const content = Buffer.from(part.body.data, 'base64').toString('utf-8');
        return { content, contentType: contentType as 'text/plain' | 'text/html' };
      }

      // If no body data but has parts, recursively search parts
      if (part.parts) {
        // First try to find HTML content
        let htmlPart = part.parts.find(p => p.mimeType === 'text/html');
        if (htmlPart?.body?.data) {
          return {
            content: Buffer.from(htmlPart.body.data, 'base64').toString('utf-8'),
            contentType: 'text/html'
          };
        }

        // If no HTML, try to find plain text
        let plainTextPart = part.parts.find(p => p.mimeType === 'text/plain');
        if (plainTextPart?.body?.data) {
          return {
            content: Buffer.from(plainTextPart.body.data, 'base64').toString('utf-8'),
            contentType: 'text/plain'
          };
        }

        // If still no content found, recursively search through all parts
        for (const subPart of part.parts) {
          const result = findContent(subPart);
          if (result.content) {
            return result;
          }
        }
      }

      return { content: null };
    };

    const result = findContent(message.payload);

    if (!result.content) {
      return {
        content: null,
        error: { message: 'No content found in message' }
      };
    }

    return result;
  } catch (error) {
    return {
      content: null,
      error: {
        message: 'Error extracting email body',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}
