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
      <div className="space-y-6">
        {/* Raw Content */}
        <div className="border-l-4 border-red-500 pl-4">
          <div className="text-xs text-red-600 font-mono mb-1">RAW EMAIL:</div>
          <pre className="whitespace-pre-wrap text-sm bg-red-50 p-2 rounded">
            {content}
          </pre>
        </div>
        
        {/* Formatted Content */}
        <div className="border-l-4 border-green-500 pl-4">
          <div className="text-xs text-green-600 font-mono mb-1">FORMATTED EMAIL:</div>
          <div className="email-content space-y-2 text-base leading-relaxed bg-green-50 p-2 rounded font-sans">
            {paragraphs.map((paragraph, paragraphIndex) => {
              const lines = paragraph.split('\n').filter(line => line.trim() !== '');
              
              return (
                <p key={paragraphIndex} className="mb-4">
                  {lines.map((line, lineIndex) => {
                    // Split on asterisk pairs
                    const parts = line.split(/(\*[^*]+\*)/g);
                    const processedLine = parts.map((part, partIndex) => {
                      if (part.startsWith('*') && part.endsWith('*')) {
                        const boldText = part.slice(1, -1);
                        return (
                          <strong 
                            key={partIndex} 
                            className="font-bold"
                            style={{ fontWeight: 700 }}
                          >
                            {boldText}
                          </strong>
                        );
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
        </div>
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