'use client';

import EmailCorrespondence from './EmailCorrespondence';

export default function EmailExample() {
  // Example customer email for demonstration
  const customerEmail = 'konatamkalyani22@gmail.com';
  const disputeId = 'example-dispute-id';

  return (
    <div className="max-w-2xl mx-auto bg-gray-50 p-6">
      <EmailCorrespondence 
        customerEmail={customerEmail}
        disputeId={disputeId}
        onEmailSent={() => {
          // Optional callback
          console.log('Email sent successfully');
        }}
      />
    </div>
  );
} 