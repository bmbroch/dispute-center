"use client";

import React from 'react';

interface EmailMessage {
  from: string;
  email: string;
  date: string;
  subject: string;
  body: string;
  to?: string;
}

interface EmailCorrespondenceProps {
  messages: EmailMessage[];
}

export default function EmailCorrespondence({ messages }: EmailCorrespondenceProps) {
  const formatEmailContent = (content: string) => {
    // Split the content into paragraphs
    const paragraphs = content.split(/\n\n+/);
    
    return (
      <div className="email-content space-y-2 text-base leading-relaxed">
        {paragraphs.map((paragraph, paragraphIndex) => {
          // Split paragraph into lines
          const lines = paragraph.split('\n').filter(line => line.trim() !== '');
          
          return (
            <p key={paragraphIndex} className="mb-4">
              {lines.map((line, lineIndex) => {
                // Process bold text (now using double asterisks)
                const parts = line.split(/(\*\*[^*]+\*\*)/);
                const processedLine = parts.map((part, partIndex) => {
                  if (part.startsWith('**') && part.endsWith('**')) {
                    const boldText = part.slice(2, -2);
                    return <strong key={partIndex}>{boldText}</strong>;
                  }
                  return part;
                });

                return (
                  <React.Fragment key={lineIndex}>
                    {processedLine}
                    {lineIndex < lines.length - 1 && <br />}
                  </React.Fragment>
                );
              })}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="email-wrapper text-base leading-relaxed">
      {messages.map((message, index) => (
        <div key={index} className="email-content space-y-2">
          <div className="flex items-center justify-between text-gray-600 text-sm">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{message.from}</span>
                <span>&lt;{message.email}&gt;</span>
              </div>
              {message.to && (
                <div>
                  to {message.to}
                </div>
              )}
            </div>
            <div>{message.date}</div>
          </div>
          
          {formatEmailContent(message.body)}
        </div>
      ))}
      
      {messages.length > 1 && (
        <div className="flex justify-center py-2">
          <div className="inline-flex items-center gap-2 text-sm text-gray-500">
            3 days between messages
          </div>
        </div>
      )}
    </div>
  );
} 