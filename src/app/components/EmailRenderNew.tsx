import React, { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { EmailContent } from '@/types/email';

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
      let rawHtml = '';
      if (typeof content === 'object' && content !== null) {
        if (content.html) {
          rawHtml = decodeHtmlEntities(content.html);
        } else if (content.text) {
          rawHtml = `<div style="white-space: pre-wrap;">${content.text}</div>`;
        }
        if (content.error) {
          setError(content.error);
        }
      } else if (typeof content === 'string') {
        rawHtml = content;
      }

      if (!rawHtml) {
        setProcessedContent('');
        return;
      }

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
                height: 100%;
                overflow-y: auto;
                overflow-x: hidden;
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
              html {
                height: 100%;
                min-height: 100%;
                overflow: hidden;
              }
              /* This ensures scrollbars only appear when needed and look consistent */
              ::-webkit-scrollbar {
                width: 8px;
                height: 8px;
              }
              ::-webkit-scrollbar-thumb {
                background-color: rgba(0, 0, 0, 0.2);
                border-radius: 4px;
              }
              ::-webkit-scrollbar-track {
                background: transparent;
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

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !processedContent) return;

    // Initialize with a reasonable height
    iframe.style.height = '100%';
    iframe.srcdoc = processedContent;

    let resizeObserver: ResizeObserver | null = null;

    iframe.onload = () => {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      // Add scrolling styles to the iframe body
      if (iframe.contentWindow?.document.body) {
        // Make the body use auto overflow to only show scrollbars when needed
        iframe.contentWindow.document.body.style.minHeight = '100%';
        
        // Function to check if scrolling is needed and update accordingly
        const updateScrollState = () => {
          if (!iframe.contentWindow || !iframe.contentWindow.document.body) return;
          
          const contentHeight = iframe.contentWindow.document.body.scrollHeight || 0;
          const containerHeight = iframe.clientHeight;
          
          // Only allow scrolling if content exceeds container
          if (contentHeight <= containerHeight) {
            iframe.contentWindow.document.body.style.overflowY = 'hidden';
          } else {
            // When content is larger than container, show scrollbar
            iframe.contentWindow.document.body.style.overflowY = 'auto';
            
            // Ensure there's no horizontal scrollbar
            iframe.contentWindow.document.body.style.overflowX = 'hidden';
            
            // Apply some padding to account for scrollbar width and prevent content shift
            iframe.contentWindow.document.body.style.paddingRight = '8px';
          }
        };
        
        // Initial update
        updateScrollState();
        
        // Add resize event listener to handle dynamic content changes
        resizeObserver = new ResizeObserver(() => {
          updateScrollState();
        });
        
        resizeObserver.observe(iframe.contentWindow.document.body);
      }

      const links = iframeDoc.getElementsByTagName('a');
      Array.from(links).forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      });
    };

    // Cleanup function
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
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
    <div className={`relative ${className} h-full`}>
      {error && (
        <div className="mb-2 p-2 bg-red-50 text-red-700 text-sm rounded">
          {error}
        </div>
      )}

      <div className="relative bg-white rounded-lg h-full">
        <iframe
          ref={iframeRef}
          className="w-full border-0 h-full"
          sandbox="allow-same-origin"
          title="Email Content"
          srcDoc={processedContent}
          style={{ minHeight: '400px', height: '100%' }}
        />
      </div>
    </div>
  );
}
