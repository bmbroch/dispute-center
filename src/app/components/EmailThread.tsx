import { X, Bug } from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useState, useMemo } from 'react';

interface EmailMessage {
  subject: string;
  from: string;
  body: string;
  date: string;
  contentType?: string;
  snippet?: string;
  debug?: {
    bodyLength?: number;
    hadHtmlContent?: boolean;
    hadPlainText?: boolean;
    mimeType?: string;
    isFromUser?: boolean;
    hasUserQuote?: boolean;
    isReplyToUser?: boolean;
  };
}

interface EmailThreadProps {
  email: {
    subject: string;
    from: string;
    body: string;
    date: string;
    messages?: EmailMessage[];
  };
  onClose: () => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  }).format(date);
}

function parseEmailBody(body: string): string {
  // Check if content is HTML
  const isHTML = /<[a-z][\s\S]*>/i.test(body);
  
  if (isHTML) {
    // Sanitize HTML content
    const cleanHtml = DOMPurify.sanitize(body, {
      ALLOWED_TAGS: [
        'div', 'span', 'p', 'br', 'strong', 'em', 'blockquote', 
        'a', 'ul', 'ol', 'li', 'img', 'table', 'tr', 'td', 'th'
      ],
      ALLOWED_ATTR: ['href', 'class', 'style', 'target', 'src', 'alt', 'width', 'height'],
    });

    // Convert Gmail quote styles to a more readable format
    return cleanHtml
      // Style quoted text
      .replace(/class="gmail_quote"/g, 'style="margin-left: 1em; padding-left: 1em; border-left: 3px solid #e5e7eb; color: #6b7280;"')
      // Style attribution line
      .replace(/class="gmail_attr"/g, 'style="color: #6b7280; font-size: 0.875rem; margin: 0.5em 0;"')
      // Ensure images are responsive
      .replace(/<img([^>]*)>/g, '<img$1 style="max-width: 100%; height: auto;" loading="lazy">')
      // Add spacing between paragraphs
      .replace(/<div/g, '<div style="margin: 0.5em 0;"')
      // Style links
      .replace(/<a([^>]*)>/g, '<a$1 style="color: #2563eb; text-decoration: underline;">')
      // Clean up extra spacing
      .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
      .replace(/\n{3,}/g, '\n\n');
  }

  // If not HTML, convert plain text to HTML preserving newlines and adding some basic styling
  return marked(body, {
    breaks: true,
    gfm: true
  }).replace(/<p>/g, '<p style="margin: 0.5em 0;">');
}

function parseEmailAddress(from: string): { name: string; email: string } {
  // Handle various email formats:
  // "John Doe <john@example.com>"
  // "<john@example.com>"
  // "john@example.com"
  const match = from.match(/(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)/);
  if (!match) return { name: from, email: from };
  
  const [, name, email] = match;
  return {
    name: name?.trim() || email.split('@')[0],
    email: email.trim()
  };
}

export default function EmailThread({ email, onClose }: EmailThreadProps) {
  const [showDebug, setShowDebug] = useState(false);
  const sortedMessages = useMemo(() => {
    if (email.messages) {
      return [...email.messages].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
    }
    return [{
      subject: email.subject,
      from: email.from,
      body: email.body,
      date: email.date,
      contentType: 'text/plain'
    } as EmailMessage];
  }, [email]);

  const renderDebugInfo = (message: EmailMessage) => {
    if (!showDebug) return null;
    
    const debugData = {
      stage: 'Raw Email Data',
      subject: message.subject,
      from: message.from,
      date: message.date,
      contentType: message.contentType || 'text/plain',
      bodyLength: message.body?.length,
      bodyPreview: message.body?.substring(0, 100) + '...',
      snippet: message.snippet,
    };

    return (
      <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs font-mono">
        <div className="font-medium text-gray-700 mb-2">Debug Information:</div>
        <pre className="whitespace-pre-wrap break-all bg-white p-2 rounded border border-gray-200">
          {JSON.stringify(debugData, null, 2)}
        </pre>
      </div>
    );
  };

  const renderMessage = (message: EmailMessage, index: number) => {
    const isHtml = message.contentType?.toLowerCase().includes('html');
    const sanitizedBody = isHtml ? DOMPurify.sanitize(message.body, {
      USE_PROFILES: { html: true },
      ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'blockquote'],
      ALLOWED_ATTR: ['href', 'target']
    }) : message.body;

    return (
      <div key={index} className="mb-4 p-4 bg-white rounded-lg shadow">
        {/* ... rest of the render code ... */}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate pr-4">
              {email.subject || 'No Subject'}
            </h2>
            <p className="text-sm text-gray-500">
              {sortedMessages.length} message{sortedMessages.length !== 1 ? 's' : ''} in conversation
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="text-gray-500 hover:text-gray-700 transition-colors p-1 rounded hover:bg-gray-100"
              title="Toggle Debug Mode"
            >
              <Bug className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Email Thread */}
        <div className="flex-1 overflow-auto">
          <div className="divide-y divide-gray-100">
            {sortedMessages.map((message, index) => {
              const { name, email: emailAddress } = parseEmailAddress(message.from);
              const formattedBody = parseEmailBody(message.body);

              return (
                <div key={`${message.date}-${index}`} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <span className="text-blue-700 font-medium">
                        {name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
                        <span className="text-xs text-gray-500 truncate">&lt;{emailAddress}&gt;</span>
                      </div>
                      <div className="flex items-baseline gap-2 text-xs text-gray-500">
                        <span>{formatDate(message.date)}</span>
                        {message.subject && message.subject !== email.subject && (
                          <>
                            <span>•</span>
                            <span className="truncate">{message.subject}</span>
                          </>
                        )}
                        {message.contentType && (
                          <>
                            <span>•</span>
                            <span className="text-blue-500">{message.contentType}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div 
                    className="pl-11 text-sm text-gray-700 space-y-2 email-content"
                    dangerouslySetInnerHTML={{ __html: formattedBody }}
                  />
                  {renderDebugInfo(message)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t bg-gray-50 text-right sticky bottom-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
} 