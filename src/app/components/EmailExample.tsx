'use client';

import EmailCorrespondence from './EmailCorrespondence';

export default function EmailExample() {
  const messages = [
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
  ];

  return (
    <div className="max-w-2xl mx-auto bg-gray-50 p-6">
      <EmailCorrespondence messages={messages} />
    </div>
  );
} 