import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import DOMPurify from 'dompurify';

interface EmailContent {
  html: string | null;
  text: string | null;
  error?: string;
}

interface EmailRenderNewProps {
  content: string | EmailContent;
  maxHeight?: number;
  showDebugInfo?: boolean;
  className?: string;
  onRefresh?: () => void;
}

const decodeHtmlEntities = (html: string): string => {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = html;
  return textarea.value;
};

export default function EmailRenderNew({
  content,
  maxHeight = 200,
  showDebugInfo = false,
  className = '',
  onRefresh,
}: EmailRenderNewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processedContent, setProcessedContent] = useState<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    try {
      // Get the HTML content from the input
      let rawHtml = '';
      if (typeof content === 'object' && content !== null) {
        if (content.html) {
          // If content is from Gmail API, decode the HTML entities
          rawHtml = decodeHtmlEntities(content.html);
        }
        if (content.error) {
          setError(content.error);
        }
      } else if (typeof content === 'string') {
        rawHtml = content;
      }

      // If no HTML content, set empty content
      if (!rawHtml) {
        setProcessedContent('');
        return;
      }

      // Sanitize the HTML
      const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
        ADD_TAGS: [
          'html', 'head', 'meta', 'body', 'div', 'span', 'img',
          'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br',
          'b', 'i', 'u', 'em', 'strong', 'a', 'ul', 'ol', 'li',
          'center', 'style', 'link'
        ],
        ADD_ATTR: [
          'src', 'href', 'style', 'class', 'id', 'alt', 'title',
          'width', 'height', 'border', 'cellpadding', 'cellspacing',
          'align', 'valign', 'target', 'rel', 'bgcolor'
        ],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
        WHOLE_DOCUMENT: true,
        SANITIZE_DOM: true,
        ALLOW_DATA_ATTR: false
      });

      setProcessedContent(sanitizedHtml);
    } catch (err) {
      console.error('Error processing email content:', err);
      setError('Failed to process email content');
    }
  }, [content]);

  // Handle iframe load and content injection
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !processedContent) return;

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;

    // Write the content to the iframe
    iframeDoc.open();
    iframeDoc.write(processedContent);
    iframeDoc.close();

    // Add base styles to iframe
    const style = iframeDoc.createElement('style');
    style.textContent = `
      body {
        margin: 0;
        padding: 0;
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        background-color: #ffffff;
      }
      * {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif;
      }
      a {
        color: #1a73e8;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      @media (prefers-color-scheme: dark) {
        body {
          background-color: #202124;
          color: #e8eaed;
        }
        a {
          color: #8ab4f8;
        }
      }
    `;
    iframeDoc.head.appendChild(style);

    // Adjust iframe height to content
    const resizeIframe = () => {
      if (!iframe || !iframeDoc || !iframeDoc.body) return;
      const height = iframeDoc.body.scrollHeight;
      iframe.style.height = isExpanded ? `${height}px` : `${Math.min(height, maxHeight)}px`;
    };

    // Resize on load and when content changes
    iframe.onload = resizeIframe;
    const resizeObserver = new ResizeObserver(resizeIframe);
    resizeObserver.observe(iframeDoc.body);

    // Handle links in iframe
    const links = iframeDoc.getElementsByTagName('a');
    Array.from(links).forEach(link => {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [processedContent, isExpanded, maxHeight]);

  if (!processedContent) {
    return (
      <div className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500 mb-4">No email content available</p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-sm"
            title="Refresh email content"
          >
            <svg
              className="w-4 h-4 mr-2 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ transform: 'scaleX(-1)' }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh Email Content
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {error && (
        <div className="mb-2 p-2 bg-red-50 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      {processedContent.length > maxHeight && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mb-2 text-blue-600 hover:text-blue-800 text-sm font-medium focus:outline-none flex items-center gap-1"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-4 h-4" />
              Show Less
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              Show More
            </>
          )}
        </button>
      )}

      <div className="relative bg-white rounded-lg overflow-hidden">
        <div className="relative">
          <iframe
            ref={iframeRef}
            className="w-full border-0"
            sandbox="allow-same-origin"
            title="Email Content"
          />
          {!isExpanded && processedContent.length > maxHeight && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" />
          )}
        </div>
      </div>

      {showDebugInfo && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs font-mono">
          <div className="font-medium text-gray-700 mb-2">Debug Information:</div>
          <pre className="whitespace-pre-wrap break-all bg-white p-2 rounded border border-gray-200">
            {JSON.stringify({
              contentType: typeof content === 'object' ? 'EmailContent' : 'string',
              hasHtmlContent: Boolean(processedContent),
              renderedContentLength: processedContent.length,
              error: error,
            }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
