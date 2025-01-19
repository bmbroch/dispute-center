"use client";

import React, { useState } from 'react';

interface EmailMessage {
  from: string;
  email: string;
  date: string;
  subject: string;
  body: string;
  to?: string;
}

export interface EmailCorrespondenceProps {
  customerEmail: string;
  disputeId: string;
}

// Example email templates for different customers
const EMAIL_TEMPLATES: Record<string, EmailMessage[]> = {
  'konatamkalyani22@gmail.com': [
    {
      from: "Ben Broch",
      email: "ben@interviewsidekick.com",
      subject: "Re: Dispute - Interview Sidekick",
      date: "1/3/2025",
      body: `Hey Kalyani!

Just checking in here, can you please consider contacting your bank? This would mean a lot and ensure that I can still help job seekers through the power of AI. I'm always around via email if folks need assistance :)

-Ben`
    },
    {
      from: "Ben Broch",
      email: "ben@interviewsidekick.com",
      subject: "Re: Dispute - Interview Sidekick",
      date: "1/6/2025",
      body: `Hey there!

It looks like you reported this payment as fraudulent. This indicates that you were not, in fact, the user who initiated the purchase. *The resume information that you submitted to our system seems consistent with your name, etc.*

*We will unfortunately be forced to proceed with supporting evidence that you falsely reported a fraudulent purchase.* Are you open to withdrawing this purchase? In return, we'd be happy to send you via venmo /paypal your money back. If so, let us know the email and we'll send the money back to you that way right away. This is the last time we'll reach out to you.

[image: image.png]`
    }
  ],
  'iamrazzaq920@gmail.com': [
    {
      from: "Ben Broch",
      email: "ben@interviewsidekick.com",
      subject: "Re: Dispute - Product Not Received",
      date: "2/1/2025",
      body: `Hi there,

I noticed you've opened a dispute for not receiving the product. Our records show that you have accessed the AI interview preparation system multiple times since your purchase. *We have logs of your usage and the resume you submitted for review.*

Would you be willing to withdraw this dispute? If you're having any issues with the system, I'm happy to help resolve them directly.

Best,
Ben`
    }
  ],
  'aswiniaturi@gmail.com': [
    {
      from: "Ben Broch",
      email: "ben@interviewsidekick.com",
      subject: "Re: Interview Sidekick Dispute",
      date: "1/25/2025",
      body: `Hello,

I see you've opened a dispute for our service. *Our logs show that you've successfully used the interview preparation system and received AI feedback on your responses.* 

If there's something specific you're unsatisfied with, I'd be happy to address it directly. We pride ourselves on providing value to job seekers, and I want to ensure you have a good experience.

Best regards,
Ben`
    }
  ],
  'anildara1998@gmail.com': [
    {
      from: "Ben Broch",
      email: "ben@interviewsidekick.com",
      subject: "Re: Dispute Resolution",
      date: "2/10/2025",
      body: `Hi there,

I noticed you've opened a dispute for our interview preparation service. *Our system logs show active usage of the platform from your account, including multiple mock interviews and resume reviews.*

I'd like to understand if there's a specific concern I can address. We're committed to helping with your job search, and I'm personally available to ensure you get the most value from our service.

Best,
Ben`
    }
  ]
};

export default function EmailCorrespondence({ customerEmail, disputeId }: EmailCorrespondenceProps) {
  const [emails, setEmails] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Get customer-specific emails or return empty array if none exist
  const messages = EMAIL_TEMPLATES[customerEmail] || [];

  const formatEmailContent = (content: string) => {
    // Split the content into paragraphs
    const paragraphs = content.split(/\n\n+/);
    
    return (
      <div className="email-content space-y-4 text-base leading-relaxed">
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
    );
  };

  if (messages.length === 0) {
    return (
      <div className="text-center text-gray-500 py-4">
        No email correspondence found for this customer.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Email Correspondence for {customerEmail}</h3>
      <div className="space-y-6">
        {messages.map((message, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{message.from}</span>
                  <span className="text-gray-500">&lt;{message.email}&gt;</span>
                </div>
                {message.to && (
                  <div className="text-gray-500">
                    to {message.to}
                  </div>
                )}
              </div>
              <div className="text-gray-500">{message.date}</div>
            </div>
            
            {formatEmailContent(message.body)}
          </div>
        ))}
        
        {messages.length > 1 && (
          <div className="flex justify-center py-2">
            <div className="text-sm text-gray-500">
              3 days between messages
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 