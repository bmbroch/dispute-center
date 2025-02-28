import React, { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

interface EmailContent {
  html: string | null;
  text: string | null;
  error?: string;
}

interface EmailRenderNewProps {
  content: string | EmailContent;
  className?: string;
  isLoading?: boolean;
  showDebugInfo?: boolean;
}

const decodeHtmlEntities = (html: string): string => {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = html;
  return textarea.value;
};

const EmailContentSkeleton = () => (
  <div className="animate-pulse space-y-3">
    <div className="h-4 bg-gray-100 rounded w-3/4"></div>
    <div className="h-4 bg-gray-100 rounded w-5/6"></div>
    <div className="h-4 bg-gray-100 rounded w-2/3"></div>
    <div className="h-4 bg-gray-100 rounded w-4/5"></div>
    <div className="h-4 bg-gray-100 rounded w-3/4"></div>
  </div>
);

export default function EmailRenderNew({
  content,
  className = '',
  isLoading = false,
  showDebugInfo = false,
}: EmailRenderNewProps) {
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [processedContent, setProcessedContent] = useState<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (typeof content === 'string') {
      setHtmlContent(content);
      setError(null);
    } else if (!content) {
      // Handle the case where content is undefined or null
      setError('No content available');
      setHtmlContent(null);
    } else {
      if (content.error) {
        setError(content.error);
        setHtmlContent(null);
      } else if (content.html) {
        setHtmlContent(content.html);
        setError(null);
      } else if (content.text) {
        setHtmlContent(content.text);
        setError(null);
      } else {
        setHtmlContent(null);
        setError('No content available');
      }
    }
  }, [content]);

  useEffect(() => {
    try {
      // Get the HTML content from the input
      let rawHtml = '';
      if (typeof content === 'object' && content !== null) {
        if (content.html) {
          // If content is from Gmail API, decode the HTML entities
          rawHtml = decodeHtmlEntities(content.html);
        } else if (content.text) {
          // Use text content if HTML is not available
          rawHtml = `<div style="white-space: pre-wrap;">${content.text}</div>`;
        }
        if (content.error) {
          setError(content.error);
        }
      } else if (typeof content === 'string') {
        rawHtml = content;
      }

      // If no content, set empty content but don't show error
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

      // Wrap the content in a basic HTML structure with default styles
      const wrappedHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body {
                margin: 0;
                padding: 8px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Ubuntu, sans-serif;
                font-size: 14px;
                line-height: 1.5;
                color: #000000;
                background-color: #ffffff;
              }
              * {
                max-width: 100%;
              }
              img {
                height: auto;
              }
              a {
                color: #1a73e8;
                text-decoration: none;
              }
              a:hover {
                text-decoration: underline;
              }
              blockquote {
                margin: 0 0 0 0.8ex;
                border-left: 1px solid #ccc;
                padding-left: 1ex;
              }
            </style>
          </head>
          <body>${sanitizedHtml}</body>
        </html>
      `;

      setProcessedContent(wrappedHtml);
    } catch (err) {
      console.error('Error processing email content:', err);
      setError('Failed to process email content');
    }
  }, [content]);

  // Force iframe refresh when content changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !processedContent) return;

    // Set fixed height
    iframe.style.height = '120px';

    // Use srcdoc to set content directly
    iframe.srcdoc = processedContent;

    // Handle links after load
    iframe.onload = () => {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      const links = iframeDoc.getElementsByTagName('a');
      Array.from(links).forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      });
    };
  }, [processedContent]);

  if (isLoading) {
    return (
      <div className={`bg-white rounded-lg p-4 ${className}`}>
        <EmailContentSkeleton />
      </div>
    );
  }

  if (!processedContent && !isLoading) {
    return (
      <div className={`bg-white rounded-lg p-4 ${className}`}>
        <EmailContentSkeleton />
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

      <div className="relative bg-white rounded-lg overflow-hidden">
        <iframe
          ref={iframeRef}
          className="w-full border-0"
          sandbox="allow-same-origin"
          title="Email Content"
          style={{ height: '120px' }}
          srcDoc={processedContent}
        />
      </div>
    </div>
  );
}
